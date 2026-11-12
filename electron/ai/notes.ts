
import type { ModelMessage } from 'ai'

import * as cheerio from 'cheerio'

import type {
  BookGenre,
  DegradedStep,
  DivergenceType,
  GeneratedNote,
  GeneratePartial,
  GenerationMode,
  GenerationStage,
  NoteDivergence,
  NoteReport,
  NotesLanguage,
  TokenUsage,
  VisionMode,
} from '../../shared/types.js'
import { generatedNoteListSchema } from '../../shared/schemas.js'
import { deriveTitle } from '../db.js'
import { genreRule } from './genre.js'
import { createLanguageModel, nonThinkingProviderOptions } from './provider.js'
import { traceAiStep, tracedGenerateText } from './trace.js'
import { backoffDelay, sleep } from './retry.js'
import type { ModelConfig } from './provider.js'
import {
  imagePromptBlock,
  imageSignature,
  isDecorativeImage,
  isVisionError,
  prepareNoteImages,
  type NoteImage,
} from './note-images.js'
import { NOTES_SYSTEM, condensePrompt, detectSourceLanguage, languageDirective, looksLikeList } from './notes-prompts.js'
export { detectSourceLanguage, languageDirective, looksLikeList, condensePrompt }
import {
  chunkCacheKey,
  notesCacheKey,
  NOTES_PROMPT_VERSION,
  readNotesCache,
  readNotesCheckpoint,
  writeNotesCache,
  writeNotesCheckpoint,
} from './notes-cache.js'
export {
  chunkCacheKey,
  notesCacheKey,
  NOTES_PROMPT_VERSION,
  readNotesCache,
  readNotesCheckpoint,
  writeNotesCache,
  writeNotesCheckpoint,
}

const MAX_CHAPTER_CHARS = 60_000
const MAX_SECTION_CHARS = 6_000
const MAX_OMITTED = 30
const CONCURRENCY = 4
const MAX_DIVERGENCES = 3
const EVIDENCE_SOURCE_CHARS = 12_000

function recordUsage(target: TokenUsage | undefined, usage: unknown): void {
  if (!target || !usage || typeof usage !== 'object') return
  const value = usage as { inputTokens?: unknown; outputTokens?: unknown; totalTokens?: unknown }
  target.inputTokens += Number(value.inputTokens) || 0
  target.outputTokens += Number(value.outputTokens) || 0
  target.totalTokens += Number(value.totalTokens) || 0
}

/**
 * 把「固定说明 + 章节原文」做成可缓存前缀：
 * - Anthropic 显式标 cache_control；
 * - OpenAI-compatible 端点会按相同前缀自动命中缓存；
 * - 不启用缓存时退回单条 prompt，避免 Anthropic 只写不读还多付 25%。
 */
function imageParts(images: NoteImage[] | undefined, args: GenerateArgs) {
  if (args.visionDisabled) return []
  return (images ?? [])
    .filter((image) => Boolean(image.data && image.mediaType))
    .map((image) => ({
      type: 'image' as const,
      image: image.data!,
      mediaType: image.mediaType!,
    }))
}

function chapterRequest(
  args: GenerateArgs,
  task: string,
  cache: boolean,
  contextChars: number,
): { prompt: string } | { system: string; messages: ModelMessage[] } {
  const context = [
    `书名《${args.bookTitle}》，本章「${args.chapterTitle}」。`,
    ...(args.chapterImages && args.chapterImages.length > 0
      ? [imagePromptBlock(args.chapterImages)]
      : []),
    '原文片段：',
    args.chapterText.slice(0, contextChars),
  ].join('\n')
  const images = imageParts(args.chapterImages, args)
  if (!cache) {
    if (images.length === 0) return { prompt: [NOTES_SYSTEM, context, task].join('\n\n') }
    return {
      system: NOTES_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: [context, task].join('\n\n') }, ...images],
        },
      ] as ModelMessage[],
    }
  }
  return {
    system: NOTES_SYSTEM,
    messages: [
      {
        role: 'user',
        content: images.length > 0 ? [{ type: 'text', text: context }, ...images] : context,
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      },
      { role: 'user', content: task },
    ] as ModelMessage[],
  }
}

function requestTimeout(parent: AbortSignal, ms: number): AbortSignal {
  const anySignal = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any
  return anySignal ? anySignal([parent, AbortSignal.timeout(ms)]) : parent
}

/** 失败步骤的短暂退避；不拖慢正常生成，只在高并发或服务商抖动时多给一次机会。 */
function retryDelay(attempt: number): Promise<void> {
  return sleep(backoffDelay(attempt))
}

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /超时|timed?\s*out|timeout|aborted due to timeout/i.test(message)
}

function splitParagraphs(text: string): string[] {
  const groups: string[] = []
  let current: string[] = []
  let inFence = false
  const flush = (): void => {
    const paragraph = current.join('\n').trim()
    if (paragraph) groups.push(paragraph)
    current = []
  }
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence
    if (!inFence && line.trim() === '') flush()
    else current.push(line)
  }
  flush()
  return groups
}

/** 把失败的大块按段落拆成两半，避免一个超长请求反复失败拖垮整章。 */
function splitTextForRetry(text: string): [string, string] | null {
  const paragraphs = splitParagraphs(text)
  if (paragraphs.length < 2) return null
  const total = text.length
  let acc = 0
  let splitAt = 0
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < paragraphs.length - 1; index++) {
    acc += paragraphs[index]!.length + 2
    const distance = Math.abs(acc - total / 2)
    if (distance < best) {
      best = distance
      splitAt = index
    }
  }
  const first = paragraphs.slice(0, splitAt + 1).join('\n\n').trim()
  const second = paragraphs.slice(splitAt + 1).join('\n\n').trim()
  if (first.length < 80 || second.length < 80) return null
  return [first, second]
}

function splitChunkForRetry(chunk: Chunk): [Chunk, Chunk] | null {
  const halves = splitTextForRetry(chunk.text)
  return halves
    ? [
        { ...chunk, text: halves[0] },
        { ...chunk, text: halves[1] },
      ]
    : null
}


interface Section {
  index: number
  title: string
  text: string
  images: NoteImage[]
}

export interface Chunk {
  sectionIndex: number
  title: string
  text: string
  images: NoteImage[]
}

interface Omitted {
  text: string
  reason: string
}

export interface CondenseOutput {
  compressed: string
  omitted: Omitted[]
}

export interface Card {
  point: string
  role: string
  evidence: string
  evidenceVerified: boolean
  section: string
  concepts: string[]
  importance: number
  divergences: NoteDivergence[]
}

interface AuditMissing {
  section: string
  point: string
}

export interface RelatedContext {
  bookTitle: string
  chapterTitle: string
  title: string
  content: string
}

export interface GenerateArgs {
  bookTitle: string
  chapterTitle: string
  chapterText: string
  chapterHtml: string
  config: ModelConfig
  demo: boolean
  genre?: BookGenre
  mode?: GenerationMode
  /** 外文书籍的输出语言；默认简体中文。 */
  notesLanguage?: NotesLanguage
  /** 图片理解模式；默认 auto。 */
  visionMode?: VisionMode
  /** 章节 HTML 里图片内容的签名，用于缓存失效。 */
  imageSignature?: string
  /** 本次准备的章节图片；由 generateChapterNotesInner 填充。 */
  chapterImages?: NoteImage[]
  /** 视觉输入失败后自动降级，避免整章重新生成。 */
  visionDisabled?: boolean
  usage?: TokenUsage
  lookupRelatedNotes?: (concepts: string[]) => RelatedContext[]
  /** 仅评测用：拿到模型原始响应，便于定位解析失败。 */
  debugRaw?: (step: string, text: string) => void
  /** 笔记缓存目录；不传则不缓存。 */
  cacheDir?: string
  /** 忽略缓存，强制重新调用模型。 */
  fresh?: boolean
  /**
   * 内部使用：某个生成步骤失败时记录，让降级结果和完整结果可区分。
   * 不参与持久化，由 generateChapterNotesInner 注入。
   */
  onStageError?: (stage: GenerationStage, error: unknown, total?: number, failed?: number) => void
}

export interface GenerateResult {
  notes: GeneratedNote[]
  report: NoteReport
}

export async function generateChapterNotes(
  args: GenerateArgs,
  onPartial: (partial: GeneratePartial) => void,
  signal: AbortSignal,
): Promise<GenerateResult> {
  const startedAt = Date.now()
  const scope = `${args.bookTitle} / ${args.chapterTitle}`
  try {
    args.imageSignature ??= chapterImageSignature(args.chapterHtml)
    const cached = await readNotesCache(args, signal)
    if (cached) {
      onPartial({ progress: { phase: 'cards', done: 1, total: 1, cards: cached.report.cards } })
      traceAiStep({
        step: 'chapter-notes',
        scope,
        model: cached.report.model,
        promptVersion: cached.report.promptVersion,
        durationMs: Date.now() - startedAt,
        cached: true,
        cachedTokens: cached.report.cachedTokens ?? cached.report.usage?.totalTokens ?? 0,
        ok: true,
      })
      return cached
    }
    const result = await generateChapterNotesInner(args, onPartial, signal)
    // 子步骤（condense / cards / audit）已经记录了 token；这里只留一条汇总行，避免双计。
    traceAiStep({
      step: 'chapter-notes',
      scope,
      model: result.report.model,
      promptVersion: result.report.promptVersion,
      durationMs: Date.now() - startedAt,
      aggregate: true,
      ok: true,
    })
    return result
  } catch (error) {
    traceAiStep({
      step: 'chapter-notes',
      scope,
      model: args.config.model,
      durationMs: Date.now() - startedAt,
      aggregate: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function generateChapterNotesInner(
  args: GenerateArgs,
  onPartial: (partial: GeneratePartial) => void,
  signal: AbortSignal,
): Promise<GenerateResult> {
  if (args.demo) return demoGeneration(args, onPartial, signal)
  if (!args.config.apiKey && args.config.provider !== 'ollama' && args.config.provider !== 'lmstudio') {
    throw new Error('还没有配置 API Key，无法生成读书笔记。')
  }

  const startedAt = Date.now()
  const mode = args.mode ?? 'standard'
  const model = createLanguageModel(args.config)
  const usage: TokenUsage = args.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  args.usage = usage
  const rawSections = buildSections(args.chapterHtml, args.chapterText)
  if (rawSections.length === 0) throw new Error('这一章没有可读的正文。')
  const sections = await prepareSectionsImages(rawSections, args, signal)
  const chunks = splitSections(sections)
  const checkpoint = await readNotesCheckpoint(args)
  let checkpointWrite: Promise<void> = Promise.resolve()
  const persistCheckpoint = (): void => {
    checkpointWrite = checkpointWrite
      .then(() => writeNotesCheckpoint(args, checkpoint))
      .catch(() => undefined)
  }

  // 记录失败步骤：只要 reduced 里有内容，这次结果就是降级的，不能当成完整生成展示。
  const degraded: DegradedStep[] = []
  const recordStageError = (stage: GenerationStage, error: unknown, total?: number, failed = 1): void => {
    const message = error instanceof Error ? error.message : String(error)
    const existing = degraded.find((item) => item.stage === stage)
    if (existing) {
      existing.failed += failed
      if (!existing.message) existing.message = message.slice(0, 300)
    } else {
      degraded.push({ stage, failed, total, message: message.slice(0, 300) })
    }
  }
  args.onStageError = (stage, error, total, failed) => recordStageError(stage, error, total, failed)

  // 阶段一：各小节并行读薄；阶段顺序不变，只是同一阶段内并发
  const condensedParts: CondenseOutput[] = chunks.map(() => ({ compressed: '', omitted: [] }))
  let nextChunk = 0
  let condensedDone = 0
  let condenseFailed = 0
  let firstCondenseError: unknown = null
  const condenseWorker = async (): Promise<void> => {
    while (true) {
      const index = nextChunk++
      if (index >= chunks.length) return
      if (signal.aborted) throw new Error('生成已取消')
      const chunk = chunks[index]!
      const chunkKey = chunkCacheKey(chunk)
      const cachedChunk = checkpoint.get(chunkKey)
      if (cachedChunk?.compressed) {
        condensedParts[index] = cachedChunk
        condensedDone++
        onPartial({
          progress: { phase: 'condense', done: condensedDone, total: chunks.length, cards: 0 },
        })
        continue
      }
      let lastError: unknown = null
      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal.aborted) throw new Error('生成已取消')
        try {
          const result = await condenseChunk(model, args, chunk, signal)
          condensedParts[index] = result
          checkpoint.set(chunkKey, result)
          persistCheckpoint()
          lastError = null
          break
        } catch (error) {
          if (signal.aborted) throw error
          lastError = error
          // 超时通常说明请求本身太大；继续原样重试大概率还是超时，直接拆块。
          if (isTimeoutError(error)) break
          if (attempt < 2) await retryDelay(attempt)
        }
      }
      if (lastError) {
        // 整块失败时再拆成两半各试一次；比直接把原文当成读薄稿更接近目标。
        const halves = splitChunkForRetry(chunk)
        if (halves) {
          const recovered: CondenseOutput[] = []
          try {
            for (const half of halves) {
              recovered.push(await condenseChunk(model, args, half, signal))
            }
            const recoveredOutput: CondenseOutput = {
              compressed: recovered.map((item) => item.compressed).join('\n\n'),
              omitted: recovered.flatMap((item) => item.omitted),
            }
            condensedParts[index] = recoveredOutput
            checkpoint.set(chunkKey, recoveredOutput)
            persistCheckpoint()
            lastError = null
          } catch (error) {
            if (signal.aborted) throw error
            lastError = error
          }
        }
      }
      if (lastError) {
        condenseFailed++
        firstCondenseError ??= lastError
        condensedParts[index] = { compressed: chunk.text, omitted: [] }
      }
      condensedDone++
      onPartial({
        progress: { phase: 'condense', done: condensedDone, total: chunks.length, cards: 0 },
      })
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, condenseWorker),
  )
  await checkpointWrite

  // 全部小节都失败时，继续写库只会把原文伪装成“读薄稿”，用户还以为成功了。
  if (condenseFailed >= chunks.length) {
    const reason = firstCondenseError instanceof Error ? firstCondenseError.message : String(firstCondenseError ?? '未知错误')
    throw new Error(`读薄失败，没有写入任何笔记：${reason.slice(0, 300)}`)
  }
  if (condenseFailed > 0) {
    recordStageError('condense', firstCondenseError, chunks.length, condenseFailed)
  }

  const merged = mergeCondensed(args, sections, chunks, condensedParts)
  if (!merged.main.trim()) throw new Error('读薄稿为空，请重试或换一个模型。')

  // 阶段一回查与阶段二提炼并行：审计和卡片都只依赖读薄稿。
  // 卡片完成后立刻开始延伸，让延伸与仍然在跑的回查并行。
  // 快速模式跳过回查和延伸，精读模式并行补一轮细节回查。
  onPartial({ progress: { phase: 'cards', done: 0, total: 1, cards: 0 } })
  const range = cardRange(countChars(merged.main), mode)
  // 回查要重发整章原文，成本最高。短章或压缩率低（几乎没删东西）时省略，质量损失很小。
  const sourceChars = countChars(args.chapterText)
  const compressionRatio = countChars(merged.main) / Math.max(1, sourceChars)
  const auditNeeded = mode !== 'fast' && sourceChars >= 2_500 && compressionRatio < 0.72
  const cacheContext = mode === 'deep'
  const extraction = await extractCardsWithAudit(model, args, merged.main, range, auditNeeded, cacheContext, signal)
  let cards = extraction.cards.filter((card) => card.point.trim().length > 0)
  const audit = extraction.missing
  const detailAuditPromise =
    mode === 'deep'
      ? auditDetails(model, args, merged.main, cacheContext, signal)
      : Promise.resolve([] as AuditMissing[])
  if (cards.length > range.max) {
    cards = await refilterCards(model, args, cards, range.max, signal)
  }
  if (cards.length === 0) {
    args.onStageError?.('extract-cards', new Error('模型没有返回可解析的卡片，已使用本地兜底。'))
    cards = fallbackCards(merged.main)
  }
  onPartial({ progress: { phase: 'cards', done: 1, total: 1, cards: cards.length } })

  onPartial({ progress: { phase: 'expand', done: 0, total: cards.length, cards: cards.length } })
  const expandPromise =
    mode !== 'fast' && cards.length >= 4
      ? expandCards(model, args, cards, signal)
      : Promise.resolve(new Map<number, NoteDivergence[]>())
  const [detailAudit, divergences] = await Promise.all([
    detailAuditPromise,
    expandPromise,
  ])
  if (detailAudit.length > 0) {
    const seen = new Set(audit.map((item) => normalizeForMatch(item.point)))
    for (const item of detailAudit) {
      const key = normalizeForMatch(item.point)
      if (!key || seen.has(key)) continue
      seen.add(key)
      audit.push(item)
    }
  }

  const auditBlock = buildAuditBlock(audit)
  const condensedDoc = buildCondensedDoc(merged.main, auditBlock)

  divergences.forEach((items, index) => {
    const card = cards[index]
    if (card) card.divergences = items
  })
  onPartial({
    progress: {
      phase: 'expand',
      done: cards.reduce((sum, card) => sum + (card.divergences.length > 0 ? 1 : 0), 0),
      total: cards.length,
      cards: cards.length,
    },
  })

  const notes = buildNotes(condensedDoc, cards)
  const originalChars = countChars(args.chapterText)
  const condensedChars = countChars(merged.main)
  const report: NoteReport = {
    originalChars,
    condensedChars,
    ratio: condensedChars > 0 ? originalChars / condensedChars : 0,
    sections: sections.length,
    cards: cards.length,
    divergences: cards.reduce((sum, card) => sum + card.divergences.length, 0),
    fidelityMissing: audit.length,
    omitted: merged.omitted.length,
    omittedItems: merged.omitted.slice(0, MAX_OMITTED),
    durationMs: Date.now() - startedAt,
    mode,
    usage: { ...usage },
    promptVersion: NOTES_PROMPT_VERSION,
    images: args.chapterImages?.length ?? 0,
    visionUsed: Boolean(
      !args.visionDisabled && args.chapterImages?.some((image) => Boolean(image.data)),
    ),
    ...(degraded.length > 0 ? { degraded } : {}),
    model: args.config.model,
    createdAt: new Date().toISOString(),
  }
  const result = { notes: validatedNotes(notes), report }
  if (!report.degraded?.length) await writeNotesCache(args, result, cards)
  return result
}

function validatedNotes(notes: GeneratedNote[]): GeneratedNote[] {
  const parsed = generatedNoteListSchema.safeParse(notes)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  throw new Error(`生成结果格式异常${issue ? `：${issue.path.join('.') || 'notes'} ${issue.message}` : ''}`)
}

function chapterImageSignature(html: string): string {
  const tags = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((match) => match[0] ?? '')
    .filter((tag) => /src\s*=\s*["']data:image\//i.test(tag))
  return imageSignature(tags.join('\n'))
}

async function prepareSectionsImages(
  sections: Section[],
  args: GenerateArgs,
  signal: AbortSignal,
): Promise<Section[]> {
  if (args.demo) return sections
  let remaining = 8
  const result: Section[] = []
  for (const section of sections) {
    const selected = section.images.slice(0, 3)
    const prepared = await prepareNoteImages(
      selected,
      args.config,
      args.visionMode,
      signal,
      remaining,
    )
    remaining -= prepared.filter((image) => Boolean(image.data)).length
    result.push({ ...section, images: prepared })
  }
  args.chapterImages = result.flatMap((section) => section.images).slice(0, 8)
  return result
}

function buildSections(chapterHtml: string, chapterText: string): Section[] {
  const sections: Section[] = []

  if (chapterHtml.trim()) {
    const $ = cheerio.load(chapterHtml)
    let title = ''
    let blocks: string[] = []
    let images: NoteImage[] = []
    let imageSeq = 0
    const push = (): void => {
      const body = blocks.join('\n\n').trim()
      const imageText = images
        .map((image, index) => `[图${index + 1}] ${image.caption || image.alt || '插图'}`)
        .join('\n')
      const text = [body, body.length >= 20 ? '' : imageText].filter(Boolean).join('\n\n').trim()
      if (text.length >= 20 || images.length > 0) {
        sections.push({ index: sections.length, title, text, images })
      }
      blocks = []
      images = []
    }

    $('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, figcaption, img').each((_, element) => {
      const node = $(element)
      const tag = String(
        (element as { tagName?: string; name?: string }).tagName ??
          (element as { name?: string }).name ??
          '',
      ).toLowerCase()
      if (tag === 'img') {
        const dataUrl = node.attr('src')?.trim() ?? ''
        if (!dataUrl.startsWith('data:image/')) return
        const alt = node.attr('alt')?.trim() ?? ''
        const caption =
          node.closest('figure').find('figcaption').first().text().replace(/\s+/g, ' ').trim() ||
          node.attr('title')?.trim() ||
          ''
        if (isDecorativeImage(alt, caption)) return
        images.push({
          id: `img-${++imageSeq}`,
          alt,
          caption,
          context: blocks[blocks.length - 1]?.slice(-180) ?? title,
          dataUrl,
          signature: imageSignature(dataUrl),
        })
        return
      }
      const text = node.text().replace(/\s+/g, ' ').trim()
      if (/^h[1-6]$/.test(tag)) {
        if (text) {
          push()
          title = text
        }
        return
      }
      if ((tag === 'li' || tag === 'blockquote') && node.find('p').length > 0) return
      if (text.length >= 10) {
        // 用代码围栏标出 pre，避免模型把代码当普通段落复述。
        blocks.push(tag === 'pre' ? `\`\`\`\n${node.text().trim()}\n\`\`\`` : text)
      }
    })
    push()
  }

  if (sections.length === 0) {
    let title = ''
    let blocks: string[] = []
    const push = (): void => {
      const text = blocks.join('\n\n').trim()
      if (text.length >= 20) sections.push({ index: sections.length, title, text, images: [] })
      blocks = []
    }
    chapterText
      .slice(0, MAX_CHAPTER_CHARS)
      .split(/\n{2,}/)
      .map((text) => text.replace(/\s+/g, ' ').trim())
      .filter((text) => text.length >= 10)
      .forEach((text) => {
        if (/^(第.{1,6}[章节]|[0-9]+[.、])/.test(text) && text.length <= 60) {
          push()
          title = text
          return
        }
        blocks.push(text)
      })
    push()
  }

  return sections
}

function splitSections(sections: Section[]): Chunk[] {
  const chunks: Chunk[] = []
  for (const section of sections) {
    if (section.text.length <= MAX_SECTION_CHARS) {
      chunks.push({
        sectionIndex: section.index,
        title: section.title,
        text: section.text,
        images: section.images,
      })
      continue
    }
    const paragraphs = splitParagraphs(section.text)
    let current: string[] = []
    let length = 0
    let imagesAssigned = false
    const flush = (): void => {
      if (current.length === 0) return
      chunks.push({
        sectionIndex: section.index,
        title: section.title,
        text: current.join('\n\n'),
        images: imagesAssigned ? [] : section.images,
      })
      imagesAssigned = true
      current = []
      length = 0
    }
    for (const paragraph of paragraphs) {
      if (current.length > 0 && length + paragraph.length > MAX_SECTION_CHARS) flush()
      current.push(paragraph)
      length += paragraph.length
    }
    flush()
  }
  return chunks
}

async function condenseChunk(
  model: ReturnType<typeof createLanguageModel>,
  args: GenerateArgs,
  chunk: Chunk,
  signal: AbortSignal,
): Promise<CondenseOutput> {
  const prompt = condensePrompt(args, chunk)
  const target = Math.max(160, Math.round(chunk.text.length * 0.55))
  const providerOptions = nonThinkingProviderOptions(args.config)
  let last: CondenseOutput | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) throw new Error('生成已取消')
    const requestPrompt =
      attempt === 0
        ? prompt
        : `${prompt}\n\n上一次的读薄稿不合格：可能仍然太厚，可能写成了要点清单，也可能没有按 JSON 返回。请改成连贯的散文段落：保留论证链和必要上下文，删掉重复与铺垫，不要使用任何列表符号或编号，目标约 ${target} 字。阅读体验优先于极限压缩。不要加入原文没有的观点，不要保留段落编号。`
    const images = imageParts(chunk.images, args)
    const request =
      images.length > 0
        ? {
            system: NOTES_SYSTEM,
            messages: [
              {
                role: 'user',
                content: [{ type: 'text', text: requestPrompt }, ...images],
              },
            ] as ModelMessage[],
          }
        : { prompt: requestPrompt }
    let response: Awaited<ReturnType<typeof tracedGenerateText>>
    try {
      response = await tracedGenerateText({ step: 'condense', provider: args.config.provider, model: args.config.model, promptVersion: NOTES_PROMPT_VERSION, timeoutMs: 120_000 }, {
        model,
        ...request,
        temperature: 0.4,
        maxOutputTokens: Math.min(16_000, Math.max(4_000, Math.ceil(target * 2.2))),
        ...(providerOptions ? { providerOptions } : {}),
        maxRetries: 1,
        abortSignal: requestTimeout(signal, 180_000),
      })
    } catch (error) {
      if (images.length > 0 && !args.visionDisabled && isVisionError(error)) {
        args.visionDisabled = true
        continue
      }
      throw error
    }
    recordUsage(args.usage, response.usage)
    const parsed = normalizeCondense(response.text, chunk.title)
    if (!parsed.compressed) continue
    last = parsed
    const tooLong =
      chunk.text.length >= 300 && countChars(parsed.compressed) > chunk.text.length * 0.6
    const listy = looksLikeList(parsed.compressed)
    if ((tooLong || listy) && attempt === 0) continue
    return parsed
  }

  if (last?.compressed) return last
  // 两次都没拿到可用的读薄稿时，宁可让这一节失败（由调用方统计并按降级处理），
  // 也不要把原文直接当成“读薄稿”写进报告。
  throw new Error('模型没有返回可用的读薄稿，请重试或换一个模型。')
}

function normalizeCondense(text: string, title: string): CondenseOutput {
  let raw: unknown
  try {
    raw = parseJsonFromText(text)
  } catch {
    const fallback = cleanCompressed(text, title)
    return { compressed: fallback, omitted: [] }
  }

  if (typeof raw === 'string') {
    return { compressed: cleanCompressed(raw, title), omitted: [] }
  }
  const obj = isRecord(raw) ? raw : {}
  const compressed = cleanCompressed(
    textOfValue(pickField(obj, ['compressed', 'condensed', 'rewrite', '读薄稿', '读薄版', 'text'])),
    title,
  )
  const omitted = listOfValues(pickField(obj, ['omitted', 'removed', 'deleted', '未采纳', '删减']))
    .map((item): Omitted | null => {
      if (typeof item === 'string') {
        const value = stripBullet(item)
        return value ? { text: value, reason: '铺垫或次要材料' } : null
      }
      if (!isRecord(item)) return null
      const value = textOfValue(pickField(item, ['text', 'quote', 'content', '原文']))
      if (!value) return null
      return {
        text: value.slice(0, 160),
        reason: textOfValue(pickField(item, ['reason', 'why', '原因'])) || '铺垫或次要材料',
      }
    })
    .filter((item): item is Omitted => Boolean(item))
    .slice(0, MAX_OMITTED)

  return { compressed, omitted }
}

function cleanCompressed(text: string, title: string): string {
  let value = text.replace(/```(?:markdown|md)?/gi, '').replace(/```/g, '').trim()
  const lines = value.split('\n')
  const first = lines[0]?.trim() ?? ''
  if (first.startsWith('#') && (!title || normalizeForMatch(first).includes(normalizeForMatch(title)))) {
    value = lines.slice(1).join('\n').trim()
  }
  return value
}

function mergeCondensed(
  args: GenerateArgs,
  sections: Section[],
  chunks: Chunk[],
  parts: CondenseOutput[],
): { main: string; omitted: Omitted[] } {
  const bySection = new Map<number, string[]>()
  const omitted: Omitted[] = []
  chunks.forEach((chunk, index) => {
    const part = parts[index]
    if (!part) return
    omitted.push(...part.omitted)
    const text = part.compressed.trim()
    if (!text) return
    const list = bySection.get(chunk.sectionIndex) ?? []
    list.push(text)
    bySection.set(chunk.sectionIndex, list)
  })

  const blocks: string[] = []
  for (const section of sections) {
    const texts = bySection.get(section.index)
    if (!texts || texts.length === 0) continue
    const heading = section.title ? `## ${section.title}` : `## ${args.chapterTitle}`
    const body = texts
      .map((text) => cleanCompressed(text, section.title))
      .filter(Boolean)
      .join('\n\n')
    if (body) blocks.push(`${heading}\n\n${body}`)
  }

  const seen = new Set<string>()
  const uniqueOmitted = omitted.filter((item) => {
    const key = normalizeForMatch(item.text)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { main: blocks.join('\n\n').trim(), omitted: uniqueOmitted.slice(0, MAX_OMITTED) }
}

// ─── 阶段一回查与补遗 ─────────────────────────────────────────────────────

async function auditDetails(
  model: ReturnType<typeof createLanguageModel>,
  args: GenerateArgs,
  condensed: string,
  cacheContext: boolean,
  signal: AbortSignal,
): Promise<AuditMissing[]> {
  if (signal.aborted) throw new Error('生成已取消')
  const hint = genreRule(args.genre)
  const task = [
    '下面是本章的读薄稿。请只做第二轮细节回查，找标准回查容易漏掉的内容：',
    '定义之间的细微区别、限定条件、作者举出的反例、人物/事件的因果、以及被压缩后失去的语境。',
    languageDirective(args),
    hint,
    '结合上面的原文片段回查；不要重复泛泛的主旨，不要把重复内容或纯铺垫算作缺失；没有就返回空数组。',
    '只输出 JSON 对象：{"missing":[{"section":"...","point":"..."}]}。不要输出 Markdown 代码块。',
    '',
    '读薄稿：',
    condensed,
  ]
    .filter(Boolean)
    .join('\n')
  const providerOptions = nonThinkingProviderOptions(args.config)

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) throw new Error('生成已取消')
    const request = chapterRequest(args, task, cacheContext, 24_000)
    try {
      const response = await tracedGenerateText({ step: 'audit-details', provider: args.config.provider, model: args.config.model, promptVersion: NOTES_PROMPT_VERSION, timeoutMs: 120_000 }, {
        model,
        ...request,
        temperature: 0.25,
        maxOutputTokens: 2_400,
        ...(providerOptions ? { providerOptions } : {}),
        maxRetries: 2,
        abortSignal: requestTimeout(signal, 180_000),
      })
      recordUsage(args.usage, response.usage)
      return normalizeAudit(parseJsonFromText(response.text)).slice(0, 8)
    } catch (error) {
      if (signal.aborted) throw error
      if (!args.visionDisabled && args.chapterImages?.some((image) => image.data) && isVisionError(error)) {
        args.visionDisabled = true
        continue
      }
      lastError = error
    }
    if (attempt === 0) await retryDelay(0)
  }
  args.onStageError?.('audit-details', lastError ?? new Error('细节回查失败'))
  return []
}

function buildAuditBlock(missing: AuditMissing[]): string {
  // 补遗也写成一段话，避免整篇读薄稿最后突然变成要点列表。
  const points = missing
    .filter((item) => item.point.trim())
    .slice(0, 8)
    .map((item) => item.point.trim().replace(/[。；;]+$/, ''))
  return points.length > 0 ? `此外，回查原文时还有几点值得补充：${points.join('；')}。` : ''
}

function normalizeAudit(raw: unknown): AuditMissing[] {
  const obj = isRecord(raw) ? raw : {}
  const list = listOfValues(pickField(obj, ['missing', 'gaps', '遗漏', '补遗']))
  return list
    .map((item): AuditMissing | null => {
      if (typeof item === 'string') {
        const point = stripBullet(item)
        return point ? { section: '', point } : null
      }
      if (!isRecord(item)) return null
      const point = textOfValue(pickField(item, ['point', 'claim', 'content', 'text', '观点']))
      if (!point) return null
      return {
        section: textOfValue(pickField(item, ['section', 'chapter', '小节'])),
        point,
      }
    })
    .filter((item): item is AuditMissing => Boolean(item))
}

function buildCondensedDoc(main: string, auditBlock: string): string {
  // 未采纳内容只进报告，让读薄稿本身保持可发布
  return [main, auditBlock].filter(Boolean).join('\n\n')
}

// ─── 阶段二：从读薄稿提炼卡片 ─────────────────────────────────────────────

/**
 * 卡片数量按读薄稿篇幅自适应，不再用固定的 25 张硬上限。
 * 每 1000 字大约 3–6 张；长章可以继续增加，只保留 80 张作为防止模型失控的安全边界。
 * fast 档上限更保守，避免为了速度把长章压成卡片墙。
 */
function cardRange(chars: number, mode: GenerationMode = 'standard'): { min: number; max: number } {
  const thousands = Math.max(1, Math.ceil(chars / 1000))
  const min = Math.min(40, Math.max(4, thousands * 3))
  const cap = mode === 'fast' ? 40 : 80
  const max = Math.min(cap, Math.max(min + 4, thousands * 6))
  return { min, max }
}

async function extractCardsWithAudit(
  model: ReturnType<typeof createLanguageModel>,
  args: GenerateArgs,
  compressed: string,
  range: { min: number; max: number },
  includeAudit: boolean,
  cacheContext: boolean,
  signal: AbortSignal,
): Promise<{ cards: Card[]; missing: AuditMissing[] }> {
  const hint = genreRule(args.genre)
  const providerOptions = nonThinkingProviderOptions(args.config)
  const buildPrompt = (text: string, retry: boolean): string =>
    [
      `书名《${args.bookTitle}》，本章「${args.chapterTitle}」。下面是本章的读薄稿与原文片段：`,
      languageDirective(args),
      ...(hint ? [hint] : []),
      ...(args.chapterImages && args.chapterImages.length > 0
        ? ['章节图片会作为视觉输入附加；图注和 alt 已在原文片段中给出。只使用看得清、能确认的信息。']
        : []),
      '读薄稿：',
      text.slice(0, 26_000),
      '',
      '任务一：从读薄稿里提炼知识点卡片，原文片段只用于填写 evidence，不要从原文新增卡片。',
      `卡片数量：按「不知道它是否影响全文理解」筛选，通常 ${range.min}-${range.max} 张（读薄稿约 ${countChars(text)} 字）；如果确实有更多独立知识点，可以超过这个范围，最多 ${range.max} 张，但不要为了凑数保留案例细节。`,
      '什么样才算知识点：用一句话测试——不知道它，会影响对全文的理解吗？会，才收；不会但有意思，留在读薄稿里；原文的每个案例细节不是知识点，是索引。',
      '每张卡片必须填满：',
      '1. point：一句话知识点（用作者的语言或自己的话，选更准确的）；外文原文时用简体中文。',
      '2. role：它在全文中的作用——支撑什么结论、处于论证链的哪一环；外文原文时用简体中文。',
      '3. evidence：从上面原文片段中逐字复制一句能支撑 point 的话，必须与原文一致；可省略首尾标点，不要改写，找不到就留空。',
      '4. section：所属小节。',
      '5. concepts：术语数组。',
      '6. importance：1-5。',
      '7. 遇到代码、图表、流程图时，可以提炼它们明确说明的机制、对比或结论；代码不要逐行抄写，讲清作用即可。',
      '8. evidence 必须逐字来自上面提供的原文文本或图注；不要编造图里的文字、数字或标签。',
      '如果候选超过上限，合并重复、删掉次要的；不要为了凑数保留案例细节。',
      ...(includeAudit
        ? [
            '',
            '任务二：只针对上面提供的原文片段做断言回查。读薄稿有没有漏掉作者的主张、论证链、关键例子、图表/代码所支持的机制或边界条件？被有意压缩的重复内容和铺垫不算缺失，表达差异也不算。',
            '只输出 JSON 对象：{"cards":[...],"missing":[{"section":"...","point":"..."}]}。没有缺失就返回空数组。不要输出 Markdown 代码块。',
          ]
        : ['只输出 JSON 对象：{"cards":[...]}。不要输出 Markdown 代码块或额外解释。']),
      ...(retry
        ? [
            '',
            '重要：上一次没有返回可解析的卡片 JSON。这一次请直接输出 JSON，不要思考过程、不要 Markdown 代码块、不要解释；即使信息不完整也要返回至少 3 张卡片。',
          ]
        : []),
    ].join('\n')

  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal.aborted) throw new Error('生成已取消')
    const request = chapterRequest(
      args,
      buildPrompt(compressed, attempt > 0),
      cacheContext,
      cacheContext ? 24_000 : EVIDENCE_SOURCE_CHARS,
    )
    try {
      const response = await tracedGenerateText(
        {
          step: includeAudit ? 'extract-cards-audit' : 'extract-cards',
          provider: args.config.provider,
          model: args.config.model,
          promptVersion: NOTES_PROMPT_VERSION,
          timeoutMs: includeAudit ? 150_000 : 120_000,
        },
        {
          model,
          ...request,
          temperature: 0.2,
          // 思考模型会把 reasoning token 也算进输出；重试时放宽上限，避免 JSON 被截断。
          maxOutputTokens: attempt === 0 ? 8_000 : 12_000,
          ...(providerOptions ? { providerOptions } : {}),
          maxRetries: 2,
          abortSignal: requestTimeout(signal, includeAudit ? 240_000 : 180_000),
        },
      )
      recordUsage(args.usage, response.usage)
      args.debugRaw?.('extract-cards', response.text)
      const parsed = parseJsonFromText(response.text)
      const object =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as { cards?: unknown; missing?: unknown })
          : null
      const cards = normalizeCards(object?.cards ?? parsed, args.chapterText).slice(0, range.max)
      if (cards.length > 0) {
        return {
          cards,
          missing: includeAudit ? normalizeAudit(object?.missing).slice(0, 12) : [],
        }
      }
      lastError = new Error('模型没有返回可解析的卡片')
    } catch (error) {
      if (signal.aborted) throw error
      if (!args.visionDisabled && args.chapterImages?.some((image) => image.data) && isVisionError(error)) {
        args.visionDisabled = true
        continue
      }
      lastError = error
      // 超时多半是整章读薄稿太大；直接拆成两半，不再原样重试。
      if (isTimeoutError(error)) break
    }
    if (attempt < 2) await retryDelay(attempt)
  }

  // 整章读薄稿太大时，最后再拆成两半分别提炼，合并去重；避免直接退回本地兜底卡片。
  const halves = splitTextForRetry(compressed)
  if (halves) {
    const splitCards: Card[] = []
    const splitMissing: AuditMissing[] = []
    let splitFailed = false
    for (const half of halves) {
      if (signal.aborted) throw new Error('生成已取消')
      try {
        const request = chapterRequest(
          args,
          buildPrompt(half, true),
          cacheContext,
          cacheContext ? 24_000 : EVIDENCE_SOURCE_CHARS,
        )
        const response = await tracedGenerateText(
          {
            step: 'extract-cards-split',
            provider: args.config.provider,
            model: args.config.model,
            promptVersion: NOTES_PROMPT_VERSION,
            timeoutMs: 120_000,
          },
          {
            model,
            ...request,
            temperature: 0.2,
            maxOutputTokens: 10_000,
            ...(providerOptions ? { providerOptions } : {}),
            maxRetries: 1,
            abortSignal: requestTimeout(signal, 150_000),
          },
        )
        recordUsage(args.usage, response.usage)
        const parsed = parseJsonFromText(response.text)
        const object =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as { cards?: unknown; missing?: unknown })
            : null
        splitCards.push(...normalizeCards(object?.cards ?? parsed, args.chapterText))
        if (includeAudit) splitMissing.push(...normalizeAudit(object?.missing))
      } catch (error) {
        if (signal.aborted) throw error
        if (!args.visionDisabled && args.chapterImages?.some((image) => image.data) && isVisionError(error)) {
          args.visionDisabled = true
          continue
        }
        lastError = error
        splitFailed = true
      }
    }
    const cards = dedupeCards(splitCards).slice(0, range.max)
    if (cards.length > 0) {
      if (splitFailed) {
        args.onStageError?.('extract-cards', lastError ?? new Error('部分卡片提炼失败'), 2, 1)
      }
      return { cards, missing: dedupeAudit(splitMissing).slice(0, 12) }
    }
  }

  args.onStageError?.('extract-cards', lastError ?? new Error('卡片提炼失败'))
  return { cards: [], missing: [] }
}

async function refilterCards(
  model: ReturnType<typeof createLanguageModel>,
  args: GenerateArgs,
  cards: Card[],
  max: number,
  signal: AbortSignal,
): Promise<Card[]> {
  const list = cards.map((card) => ({
    point: card.point,
    role: card.role,
    evidence: card.evidence,
    section: card.section,
    importance: card.importance,
  }))
  const prompt = [
    `下面是从本章读薄稿提炼出的 ${cards.length} 张卡片，超过了上限 ${max} 张。`,
    JSON.stringify(list),
    '',
    `请合并重复、删掉次要的，只保留不超过 ${max} 张最影响全文理解的卡片。`,
    '每张保留 point、role、evidence、section、concepts、importance。',
    '只输出 JSON 对象：{"cards":[...]}。不要输出 Markdown 代码块。',
  ].join('\n')

  const providerOptions = nonThinkingProviderOptions(args.config)
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) throw new Error('生成已取消')
    try {
      const response = await tracedGenerateText({ step: 'refilter-cards', provider: args.config.provider, model: args.config.model, promptVersion: NOTES_PROMPT_VERSION, timeoutMs: 120_000 }, {
        model,
        prompt,
        temperature: 0.15,
        maxOutputTokens: 6_000,
        ...(providerOptions ? { providerOptions } : {}),
        maxRetries: 2,
        abortSignal: requestTimeout(signal, 180_000),
      })
      recordUsage(args.usage, response.usage)
      const filtered = normalizeCards(parseJsonFromText(response.text), args.chapterText).slice(0, max)
      if (filtered.length > 0) return filtered
      lastError = new Error('模型没有返回可解析的卡片')
    } catch (error) {
      if (signal.aborted) throw error
      lastError = error
    }
    if (attempt === 0) await retryDelay(0)
  }
  args.onStageError?.('refilter-cards', lastError ?? new Error('卡片筛选失败'))

  return [...cards].sort((a, b) => b.importance - a.importance).slice(0, max)
}

export function normalizeCards(raw: unknown, chapterText: string): Card[] {
  const obj = isRecord(raw) ? raw : {}
  const list = Array.isArray(raw)
    ? raw
    : listOfValues(pickField(obj, ['cards', 'points', 'knowledgePoints', 'knowledge_points', '知识点']))
  const cards: Card[] = []
  for (const item of list) {
    const card = cardFromValue(item, chapterText)
    if (card) cards.push(card)
  }
  return cards
}

function dedupeCards(cards: Card[]): Card[] {
  const seen = new Set<string>()
  const result: Card[] = []
  for (const card of cards) {
    const key = normalizeForMatch(card.point)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(card)
  }
  return result
}

function dedupeAudit(items: AuditMissing[]): AuditMissing[] {
  const seen = new Set<string>()
  const result: AuditMissing[] = []
  for (const item of items) {
    const key = normalizeForMatch(item.point)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function cardFromValue(value: unknown, chapterText: string): Card | null {
  if (typeof value === 'string') {
    const point = cleanPoint(value)
    return point
      ? {
          point,
          role: '',
          evidence: '',
          evidenceVerified: false,
          section: '',
          concepts: [],
          importance: 3,
          divergences: [],
        }
      : null
  }
  if (!isRecord(value)) return null
  const point = cleanPoint(
    textOfValue(pickField(value, ['point', 'claim', 'content', 'knowledge', 'statement', 'idea', 'text'])),
  )
  if (!point) return null
  const section = textOfValue(pickField(value, ['section', 'chapter', '小节']))
  if (section && cleanPoint(section) === point) return null
  const rawEvidence = textOfValue(pickField(value, ['evidence', 'quote', 'source', '依据', 'citation'])).slice(0, 400)
  const matched = rawEvidence ? bestEvidence(rawEvidence, chapterText) : ''
  const evidence = matched || findSupportingSentence(point, chapterText)
  const importanceValue = Number(pickField(value, ['importance', 'weight', 'score', 'priority']) ?? 3)
  return {
    point,
    role: textOfValue(pickField(value, ['role', 'function', '作用', 'position'])),
    evidence,
    evidenceVerified: evidence ? verifyQuote(evidence, chapterText) : false,
    section,
    concepts: coerceStrings(pickField(value, ['concepts', 'keywords', 'terms', '概念']), 6),
    importance: Number.isFinite(importanceValue)
      ? Math.min(5, Math.max(1, Math.round(importanceValue)))
      : 3,
    divergences: [],
  }
}

function fallbackCards(compressed: string): Card[] {
  const blocks = compressed.split(/\n(?=## )/)
  const cards: Card[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const heading = lines[0]?.replace(/^##\s*/, '').trim() ?? ''
    const body = lines.slice(1).join(' ').trim()
    const first = (body.split(/(?<=[。！？!?])/)[0] ?? body).trim()
    const point = cleanPoint(first)
    if (!point) continue
    cards.push({
      point: point.slice(0, 120),
      role: '',
      evidence: '',
      evidenceVerified: false,
      section: heading,
      concepts: [],
      importance: 3,
      divergences: [],
    })
    if (cards.length >= 5) break
  }
  return cards
}

// ─── 阶段三：卡片的有限延伸 ───────────────────────────────────────────────

async function expandCards(
  model: ReturnType<typeof createLanguageModel>,
  args: GenerateArgs,
  cards: Card[],
  signal: AbortSignal,
): Promise<Map<number, NoteDivergence[]>> {
  if (cards.length === 0) return new Map()
  const items = cards.map((card, index) => ({
    index,
    point: card.point,
    role: card.role,
    evidence: card.evidence.slice(0, 160),
    related: (args.lookupRelatedNotes?.(card.concepts) ?? []).slice(0, 4),
  }))
  const prompt = [
    `书名《${args.bookTitle}》，本章「${args.chapterTitle}」。下面是本章的卡片，以及读者其他书里的相关笔记（related）：`,
    JSON.stringify(items),
    '',
    '请只对这些卡片做有限延伸，不要回到原文扩散。每张卡最多 3 条，类型只能是：',
    'boundary：这个结论在什么条件下会失效；',
    'crossbook：和已读过的哪本书、哪个观点构成呼应或矛盾，必须写出书名或笔记标题，只能使用 related 里的内容，没有 related 就不要写 crossbook；',
    'transfer：这个机制能解释读者生活或工作中的什么具体现象，必须落到具体场景。',
    '不要空话，不要写“这对很多领域都有启发”；text 不要以边界/跨书/触类这些类型词开头，类型放在 type 字段；延伸内容和作者原话分开，不要混进 point。',
    '只输出 JSON 数组：[{"index":0,"divergences":[{"type":"boundary","text":"..."}]}]。不要输出 Markdown 代码块。',
  ].join('\n')

  const providerOptions = nonThinkingProviderOptions(args.config)
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) throw new Error('生成已取消')
    try {
      const response = await tracedGenerateText({ step: 'expand-cards', provider: args.config.provider, model: args.config.model, promptVersion: NOTES_PROMPT_VERSION, timeoutMs: 120_000 }, {
        model,
        prompt,
        temperature: 0.5,
        maxOutputTokens: 8_000,
        ...(providerOptions ? { providerOptions } : {}),
        maxRetries: 2,
        abortSignal: requestTimeout(signal, 180_000),
      })
      recordUsage(args.usage, response.usage)
      return normalizeDivergences(parseJsonFromText(response.text), items)
    } catch (error) {
      if (signal.aborted) throw error
      lastError = error
    }
    if (attempt === 0) await retryDelay(0)
  }
  args.onStageError?.('expand-cards', lastError ?? new Error('卡片延伸失败'))
  return new Map()
}

/** 单张卡片按需延伸。 */
export async function expandPoint(args: {
  bookTitle: string
  chapterTitle: string
  point: string
  quote: string
  section: string
  config: ModelConfig
  relatedNotes?: RelatedContext[]
}): Promise<NoteDivergence[]> {
  if (args.config.provider === 'demo') return demoDivergences(args.point, args.relatedNotes ?? [])
  const model = createLanguageModel(args.config)
  const related = (args.relatedNotes ?? []).slice(0, 4)
  const prompt = [
    `书名《${args.bookTitle}》，本章「${args.chapterTitle}」，小节「${args.section || '正文'}」。`,
    `知识点：${args.point}`,
    args.quote ? `原文依据：${args.quote}` : '',
    related.length ? `读者其他书里的相关笔记：${JSON.stringify(related)}` : '读者其他书里没有相关笔记。',
    '',
    '请对这个知识点做有限延伸，最多 3 条，类型只能是 boundary（边界）、crossbook（跨书）、transfer（触类）。',
    'crossbook 必须写出书名或笔记标题，只能使用上面提供的相关笔记；没有相关笔记就不要写 crossbook。',
    'transfer 必须落到具体生活/工作场景；不要空话；text 不要以类型词开头；不要改写作者原话。',
    '只输出 JSON 数组：[{"type":"boundary","text":"..."}]。不要输出 Markdown 代码块。',
  ]
    .filter(Boolean)
    .join('\n')

  const providerOptions = nonThinkingProviderOptions(args.config)
  const response = await tracedGenerateText({ step: 'expand-point', provider: args.config.provider, model: args.config.model, promptVersion: NOTES_PROMPT_VERSION, timeoutMs: 90_000 }, {
    model,
    prompt,
    temperature: 0.6,
    maxOutputTokens: 2_000,
    ...(providerOptions ? { providerOptions } : {}),
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(60_000),
  })
  const parsed = parseJsonFromText(response.text)
  if (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every((item) => isRecord(item) && !('divergences' in item))
  ) {
    return validateDivergences(
      parsed
        .map((item) => normalizeDivergence(item))
        .filter((item): item is NoteDivergence => Boolean(item)),
      related,
    )
  }
  const map = normalizeDivergences(parsed, [
    { index: 0, point: args.point, role: '', evidence: args.quote, related },
  ])
  return map.get(0) ?? []
}

function normalizeDivergences(
  raw: unknown,
  items: Array<{ index: number; point: string; role: string; evidence: string; related: RelatedContext[] }>,
): Map<number, NoteDivergence[]> {
  const result = new Map<number, NoteDivergence[]>()
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw)
      ? listOfValues(pickField(raw, ['divergences', 'items', '延伸']))
      : []

  list.forEach((entry, fallbackIndex) => {
    if (isRecord(entry)) {
      const indexValue = Number(pickField(entry, ['index', 'id', 'i']))
      const index = Number.isFinite(indexValue) ? indexValue : fallbackIndex
      const item = items.find((candidate) => candidate.index === index)
      if (!item) return
      const rawDivergences = listOfValues(pickField(entry, ['divergences', 'items', '延伸']))
      const normalized = rawDivergences
        .map((value) => normalizeDivergence(value))
        .filter((value): value is NoteDivergence => Boolean(value))
      const validated = validateDivergences(normalized, item.related)
      if (validated.length > 0) result.set(index, validated)
    }
  })

  return result
}

function normalizeDivergence(value: unknown): NoteDivergence | null {
  if (!isRecord(value)) return null
  const rawText = textOfValue(pickField(value, ['text', 'content', 'value', '延伸']))
  if (!rawText) return null
  const typeRaw = textOfValue(pickField(value, ['type', 'kind', '类型'])).toLowerCase()
  const type = inferDivergenceType(typeRaw, rawText)
  const text = rawText.replace(/^(边界|跨书|触类|boundary|crossbook|transfer)\s*[:：]\s*/i, '').trim()
  return text ? { type, text } : null
}

function inferDivergenceType(raw: string, text: string): DivergenceType {
  if (raw.includes('cross') || raw.includes('跨书') || raw.includes('书')) return 'crossbook'
  if (raw.includes('transfer') || raw.includes('触类') || raw.includes('应用') || raw.includes('场景')) {
    return 'transfer'
  }
  if (raw.includes('boundary') || raw.includes('边界') || raw.includes('条件')) return 'boundary'
  if (/《.+?》|另一本书|跨书/.test(text)) return 'crossbook'
  if (/生活|工作|场景/.test(text)) return 'transfer'
  return 'boundary'
}

function validateDivergences(
  divergences: NoteDivergence[],
  related: RelatedContext[],
): NoteDivergence[] {
  const result: NoteDivergence[] = []
  for (const divergence of divergences) {
    if (result.length >= MAX_DIVERGENCES) break
    if (!divergence.text.trim()) continue
    if (divergence.type === 'crossbook') {
      if (related.length === 0) continue
      const mentions = related.some((item) => {
        const book = normalizeForMatch(item.bookTitle)
        const title = normalizeForMatch(item.title)
        const text = normalizeForMatch(divergence.text)
        return (book.length > 1 && text.includes(book)) || (title.length > 1 && text.includes(title))
      })
      if (!mentions) continue
    }
    result.push(divergence)
  }
  return result
}

// ─── 组装笔记与报告 ───────────────────────────────────────────────────────

function buildNotes(condensed: string, cards: Card[]): GeneratedNote[] {
  const notes: GeneratedNote[] = []
  const concepts = topConcepts(cards)

  notes.push({
    kind: 'condensed',
    title: '本章读薄稿',
    content: condensed,
    quote: null,
    quoteVerified: false,
    tags: concepts,
    section: null,
    importance: null,
    role: null,
    divergences: [],
  })

  for (const card of cards) {
    notes.push({
      kind: 'point',
      title: deriveTitle('point', card.point),
      content: card.point,
      quote: card.evidenceVerified ? card.evidence : null,
      quoteVerified: card.evidenceVerified,
      tags: card.concepts,
      section: card.section || null,
      importance: card.importance,
      role: card.role || null,
      divergences: card.divergences,
    })
  }

  return notes
}

function topConcepts(cards: Card[]): string[] {
  const counts = new Map<string, number>()
  for (const card of cards) {
    for (const concept of card.concepts) {
      const text = concept.trim()
      if (!text) continue
      counts.set(text, (counts.get(text) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([concept]) => concept)
}

// ─── 演示模式 ─────────────────────────────────────────────────────────────

/**
 * 示例书的手写演示结果。
 *
 * 通用演示模式只能按句子截断，看起来像“摘要”；示例书是用户看到的第一份结果，
 * 这里给出一份真正的改写稿和可核对的卡片，避免第一印象被截断稿误导。
 */
function demoSample(args: GenerateArgs): { main: string; cards: Card[] } | null {
  const text = args.chapterText
  const first = text.includes('觉察—复位')
  const second = text.includes('把手机放到另一个房间')
  if (!first && !second) return null

  if (!second) {
    return {
      main: [
        '## 注意力不是锁死，而是复位',
        '',
        '专注不是一种持续紧绷的状态，而是一连串「发现走神—把注意力带回来」的动作。',
        '',
        '真正稀缺的不是意志力，而是觉察的速度。越早发现自己飘走，复位消耗的注意力越少；等到刷了二十分钟手机才反应过来，复位就要动用更多情绪。',
        '',
        '所以，可以训练的不是「永不走神」，而是更快地发现自己正在走神。',
      ].join('\n'),
      cards: [
        {
          point: '专注是一连串复位，而不是持续锁死。',
          role: '重新定义专注，支撑后文的觉察训练。',
          evidence: '但真实的专注更像一次次的复位。',
          evidenceVerified: true,
          section: '注意力不是锁死，而是复位',
          concepts: ['专注', '复位'],
          importance: 5,
          divergences: [],
        },
        {
          point: '意志力用于复位，而不是对抗分心。',
          role: '把意志力从「硬扛」转向「回来」。',
          evidence: '意志力不是用来对抗分心的，而是用来完成复位的。',
          evidenceVerified: true,
          section: '注意力不是锁死，而是复位',
          concepts: ['意志力', '分心'],
          importance: 4,
          divergences: [],
        },
        {
          point: '真正可训练的是觉察速度。',
          role: '给出可以练习的具体目标。',
          evidence: '真正可以训练的是觉察的速度。',
          evidenceVerified: true,
          section: '注意力不是锁死，而是复位',
          concepts: ['觉察', '训练'],
          importance: 4,
          divergences: [],
        },
      ],
    }
  }

  return {
    main: [
      '## 环境比决心可靠',
      '',
      '如果觉察本身要消耗注意力，最划算的做法就是减少需要觉察的机会。',
      '',
      '把手机放到另一个房间，比在桌边反复说「不要看」更可靠；提前打开第二天要用的资料，比早上再找更可靠。环境设计把一次决定变成默认设置，不必每天重新抵抗。',
      '',
      '但环境只能减少摩擦，不能替你决定方向。',
    ].join('\n'),
    cards: [
      {
        point: '减少需要觉察的机会，比反复下决心更划算。',
        role: '把「抵抗诱惑」换成「提前设计」。',
        evidence: '把手机放到另一个房间，比在桌边反复对自己说「不要看」更可靠；',
        evidenceVerified: true,
        section: '环境比决心可靠',
        concepts: ['环境设计', '诱惑'],
        importance: 5,
        divergences: [],
      },
      {
        point: '环境设计把意志用在一次决定上，而不是每次抵抗。',
        role: '解释环境设计为什么更省注意力。',
        evidence: '这不是否认意志的作用，而是把意志用在设计环境上，而不是用在每一次抵抗诱惑上。',
        evidenceVerified: true,
        section: '环境比决心可靠',
        concepts: ['意志', '环境设计'],
        importance: 4,
        divergences: [],
      },
      {
        point: '环境只能减少摩擦，不能替你决定方向。',
        role: '给环境设计划出边界。',
        evidence: '环境设计也有边界。',
        evidenceVerified: true,
        section: '环境比决心可靠',
        concepts: ['边界', '方向'],
        importance: 3,
        divergences: [],
      },
    ],
  }
}

async function demoGeneration(
  args: GenerateArgs,
  onPartial: (partial: GeneratePartial) => void,
  signal: AbortSignal,
): Promise<GenerateResult> {
  const startedAt = Date.now()
  const sample = demoSample(args)
  if (sample) {
    const condensed = buildCondensedDoc(sample.main, '')
    const cards = sample.cards
    onPartial({ progress: { phase: 'condense', done: 1, total: 1, cards: 0 } })
    onPartial({ progress: { phase: 'cards', done: 1, total: 1, cards: cards.length } })
    await new Promise((resolve) => setTimeout(resolve, 80))
    if (signal.aborted) throw new Error('生成已取消')
    const notes = buildNotes(condensed, cards)
    const originalChars = countChars(args.chapterText)
    const condensedChars = countChars(sample.main)
    const report: NoteReport = {
      originalChars,
      condensedChars,
      ratio: condensedChars > 0 ? originalChars / condensedChars : 0,
      sections: 1,
      cards: cards.length,
      divergences: 0,
      fidelityMissing: 0,
      omitted: 0,
      omittedItems: [],
      durationMs: Date.now() - startedAt,
      model: 'demo',
      createdAt: new Date().toISOString(),
    }
    return { notes: validatedNotes(notes), report }
  }
  const sections = buildSections(args.chapterHtml, args.chapterText)
  const compressedBlocks: string[] = []
  const omitted: Omitted[] = []

  for (const section of sections) {
    const sentences = section.text.split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean)
    const keep = Math.max(1, Math.ceil(sentences.length / 2))
    compressedBlocks.push(`## ${section.title || args.chapterTitle}\n\n${sentences.slice(0, keep).join('')}`)
    if (sentences.length > keep) {
      omitted.push({
        text: sentences.slice(keep).join('').slice(0, 80),
        reason: '演示模式：重复或次要材料',
      })
    }
  }

  const main = compressedBlocks.join('\n\n')
  const audit: AuditMissing[] = []
  const condensed = buildCondensedDoc(main, '')
  const range = cardRange(countChars(main))

  const cards: Card[] = sections.slice(0, Math.min(range.max, 4)).map((section) => {
    const first = (section.text.split(/(?<=[。！？!?])/)[0] ?? section.text).trim()
    return {
      point: first.slice(0, 100),
      role: '演示模式：支撑本章的核心判断',
      evidence: first.slice(0, 160),
      evidenceVerified: true,
      section: section.title,
      concepts: extractKeywords(args.chapterText).slice(0, 3),
      importance: 3,
      divergences: [],
    }
  })
  if (cards[0]) cards[0].divergences = demoDivergences(cards[0].point, [])
  if (cards[1]) cards[1].divergences = demoDivergences(cards[1].point, [])

  onPartial({ progress: { phase: 'condense', done: sections.length, total: sections.length, cards: 0 } })
  onPartial({ progress: { phase: 'cards', done: 1, total: 1, cards: cards.length } })
  await new Promise((resolve) => setTimeout(resolve, 80))
  if (signal.aborted) throw new Error('生成已取消')

  const notes = buildNotes(condensed, cards)
  const originalChars = countChars(args.chapterText)
  const condensedChars = countChars(main)
  const report: NoteReport = {
    originalChars,
    condensedChars,
    ratio: condensedChars > 0 ? originalChars / condensedChars : 0,
    sections: sections.length,
    cards: cards.length,
    divergences: cards.reduce((sum, card) => sum + card.divergences.length, 0),
    fidelityMissing: audit.length,
    omitted: omitted.length,
    omittedItems: omitted.slice(0, MAX_OMITTED),
    durationMs: Date.now() - startedAt,
    model: 'demo',
    createdAt: new Date().toISOString(),
  }
  return { notes: validatedNotes(notes), report }
}

function demoDivergences(point: string, related: RelatedContext[]): NoteDivergence[] {
  const divergences: NoteDivergence[] = [
    {
      type: 'boundary',
      text: `演示边界：这条结论在什么条件下会失效？正式模型会结合卡片「${point.slice(0, 24)}…」给出具体条件。`,
    },
    {
      type: 'transfer',
      text: '演示触类：把它放进一次具体的阅读或工作场景，观察自己会不会做出不同选择。',
    },
  ]
  if (related[0]) {
    divergences.push({
      type: 'crossbook',
      text: `演示跨书：和《${related[0].bookTitle}》里的「${related[0].title}」构成呼应。`,
    })
  }
  return divergences.slice(0, MAX_DIVERGENCES)
}

// ─── 归一化与工具 ─────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function pickField(obj: Record<string, unknown>, names: string[]): unknown {
  const normalized = new Map<string, unknown>()
  for (const [key, value] of Object.entries(obj)) {
    normalized.set(key.toLowerCase().replace(/[_\s-]/g, ''), value)
  }
  for (const name of names) {
    const value = normalized.get(name.toLowerCase().replace(/[_\s-]/g, ''))
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function textOfValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(textOfValue).filter(Boolean).join('\n')
  if (isRecord(value)) {
    for (const key of ['text', 'content', 'value', 'point', 'claim', 'name', 'concept', 'term']) {
      const text = textOfValue(value[key])
      if (text) return text
    }
  }
  return ''
}

function stripBullet(value: string): string {
  return value.replace(/^[-*•\d.、\s]+/, '').trim()
}

export function cleanPoint(value: string): string {
  // 模型有时把整段列表塞进 point：跳过标题行，取第一条真正的主张。
  for (const line of value.split(/\n+/)) {
    if (/^#{1,6}\s/.test(line)) continue
    const cleaned = stripBullet(line).replace(/\*\*/g, '').trim()
    if (cleaned) return cleaned
  }
  return ''
}

/** 找出原文里与模型引文最接近的整句；找不到就返回空，绝不保留改写过的“假引用”。 */
/** 当模型引文是改写时，用知识点本身去找原文里最接近的整句；找不到就不给引用。 */
export function findSupportingSentence(point: string, chapterText: string): string {
  const needle = normalizeForMatch(point)
  if (needle.length < 8) return ''
  const grams = new Set<string>()
  for (let index = 0; index < needle.length - 1; index++) grams.add(needle.slice(index, index + 2))
  if (grams.size === 0) return ''
  const sentences = chapterText
    .split(/(?<=[。！？!?])|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8 && sentence.length <= 260)
  let best = ''
  let bestScore = 0
  for (const sentence of sentences) {
    const hay = normalizeForMatch(sentence)
    const hayGrams = new Set<string>()
    for (let index = 0; index < hay.length - 1; index++) hayGrams.add(hay.slice(index, index + 2))
    let hits = 0
    for (const gram of grams) if (hayGrams.has(gram)) hits++
    const score = hits / Math.sqrt(grams.size * Math.max(1, hayGrams.size))
    if (hits >= 4 && score > bestScore) {
      bestScore = score
      best = sentence
    }
  }
  return bestScore >= 0.25 ? best : ''
}

export function bestEvidence(quote: string, chapterText: string): string {
  const trimmed = quote.trim().replace(/^[“”"'‘’「」『』]+|[“”"'‘’「」『』]+$/g, '').trim()
  if (!trimmed) return ''
  if (verifyQuote(trimmed, chapterText)) return trimmed
  const needle = normalizeForMatch(trimmed)
  if (needle.length < 6) return ''
  const sentences = chapterText
    .split(/(?<=[。！？!?])|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8 && sentence.length <= 260)
  const grams = new Set<string>()
  for (let index = 0; index < needle.length - 1; index++) grams.add(needle.slice(index, index + 2))
  let best = ''
  let bestScore = 0
  for (const sentence of sentences) {
    const hay = normalizeForMatch(sentence)
    let hits = 0
    for (const gram of grams) if (hay.includes(gram)) hits++
    const score = grams.size > 0 ? hits / grams.size : 0
    if (score > bestScore) {
      bestScore = score
      best = sentence
    }
  }
  return bestScore >= 0.72 ? best : ''
}

function listOfValues(value: unknown): unknown[] {
  if (isRecord(value) && ('point' in value || 'claim' in value || 'content' in value || 'text' in value)) {
    return [value]
  }
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    return value
      .split(/\n|[；;]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  if (isRecord(value)) return Object.values(value)
  return []
}

function coerceStrings(value: unknown, limit: number): string[] {
  const result: string[] = []
  for (const item of listOfValues(value)) {
    const text = stripBullet(textOfValue(item))
    if (text) result.push(text)
    if (result.length >= limit) break
  }
  return result
}

function parseJsonFromText(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
  const candidates: string[] = []
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(cleaned.slice(firstBrace, lastBrace + 1))
  const firstBracket = cleaned.indexOf('[')
  const lastBracket = cleaned.lastIndexOf(']')
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(cleaned.slice(firstBracket, lastBracket + 1))
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown
    } catch {
      // 尝试下一个候选片段。
    }
  }
  throw new Error('模型返回的内容不是有效 JSON。')
}

function countChars(value: string): number {
  return value.replace(/\s+/g, ' ').trim().length
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[“”"'‘’「」『』（）()【】\[\]…—–\-·、，,。.；;：:！!？?《》<>]/g, '')
}

/** 引用必须能在本章正文里找到，找不到就不给“已校验”标记。 */
export function verifyQuote(quote: string, chapterText: string): boolean {
  const needle = normalizeForMatch(quote)
  if (needle.length < 6) return false
  const haystack = normalizeForMatch(chapterText)
  // 必须整段命中；只匹配前 24 字会把“前半句真、后半句编”的引用误判为已校验。
  return haystack.includes(needle)
}

const STOPWORDS = new Set([
  '一个', '我们', '他们', '自己', '这个', '那个', '因为', '所以', '但是', '如果', '就是', '不是', '可以',
  '没有', '什么', '这样', '那样', '已经', '还是', '或者', '而且', '然后', '以及', '对于', '关于',
  '作者', '读者', '这一章', '本章', '最后', '许多', '并不', '而是', '真正',
])

function extractKeywords(text: string): string[] {
  const counts = new Map<string, number>()
  for (const match of text.matchAll(/[一-鿿]{2,4}/g)) {
    const word = match[0]
    if (STOPWORDS.has(word)) continue
    if (word.includes('章') || /^第.{1,3}[节页]/.test(word)) continue
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  const ranked = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word)
  return ranked.length > 0 ? ranked : ['演示模式']
}
