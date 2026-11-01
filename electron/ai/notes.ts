import * as cheerio from 'cheerio'

import type {
  BookGenre,
  DivergenceType,
  GeneratedNote,
  GeneratePartial,
  GenerationMode,
  NoteDivergence,
  NoteReport,
  TokenUsage,
} from '../../shared/types.js'
import { generatedNoteListSchema } from '../../shared/schemas.js'
import { deriveTitle } from '../db.js'
import { genreRule } from './genre.js'
import { createLanguageModel } from './provider.js'
import { traceAiStep, tracedGenerateText } from './trace.js'
import type { ModelConfig } from './provider.js'

const MAX_CHAPTER_CHARS = 60_000
const MAX_SECTION_CHARS = 6_000
const MAX_OMITTED = 30
const CONCURRENCY = 4
const MAX_DIVERGENCES = 3
const NOTES_PROMPT_VERSION = 'notes-v5'
const EVIDENCE_SOURCE_CHARS = 12_000

function recordUsage(target: TokenUsage | undefined, usage: unknown): void {
  if (!target || !usage || typeof usage !== 'object') return
  const value = usage as { inputTokens?: unknown; outputTokens?: unknown; totalTokens?: unknown }
  target.inputTokens += Number(value.inputTokens) || 0
  target.outputTokens += Number(value.outputTokens) || 0
  target.totalTokens += Number(value.totalTokens) || 0
}

function requestTimeout(parent: AbortSignal, ms: number): AbortSignal {
  const anySignal = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any
  return anySignal ? anySignal([parent, AbortSignal.timeout(ms)]) : parent
}


interface Section {
  index: number
  title: string
  text: string
}

interface Chunk {
  sectionIndex: number
  title: string
  text: string
}

interface Omitted {
  text: string
  reason: string
}

interface CondenseOutput {
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
  usage?: TokenUsage
  lookupRelatedNotes?: (concepts: string[]) => RelatedContext[]
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
    const result = await generateChapterNotesInner(args, onPartial, signal)
    traceAiStep({
      step: 'chapter-notes',
      scope,
      model: result.report.model,
      promptVersion: result.report.promptVersion,
      durationMs: Date.now() - startedAt,
      inputTokens: result.report.usage?.inputTokens,
      outputTokens: result.report.usage?.outputTokens,
      totalTokens: result.report.usage?.totalTokens,
      ok: true,
    })
    return result
  } catch (error) {
    traceAiStep({
      step: 'chapter-notes',
      scope,
      model: args.config.model,
      durationMs: Date.now() - startedAt,
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
  if (!args.config.apiKey && args.config.provider !== 'ollama') {
    throw new Error('还没有配置 API Key，无法生成读书笔记。')
  }

  const startedAt = Date.now()
  const mode = args.mode ?? 'standard'
  const model = createLanguageModel(args.config)
  const usage: TokenUsage = args.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  args.usage = usage
  const sections = buildSections(args.chapterHtml, args.chapterText)
  if (sections.length === 0) throw new Error('这一章没有可读的正文。')
  const chunks = splitSections(sections)

  // 阶段一：各小节并行读薄；阶段顺序不变，只是同一阶段内并发
  const condensedParts: CondenseOutput[] = chunks.map(() => ({ compressed: '', omitted: [] }))
  let nextChunk = 0
  let condensedDone = 0
  const condenseWorker = async (): Promise<void> => {
    while (true) {
      const index = nextChunk++
      if (index >= chunks.length) return
      if (signal.aborted) throw new Error('生成已取消')
      const chunk = chunks[index]!
      try {
        condensedParts[index] = await condenseChunk(model, args, chunk, signal)
      } catch (error) {
        if (signal.aborted) throw error
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

  const merged = mergeCondensed(args, sections, chunks, condensedParts)
  if (!merged.main.trim()) throw new Error('读薄稿为空，请重试或换一个模型。')

  // 阶段一回查与阶段二提炼并行：审计和卡片都只依赖读薄稿。
  // 卡片完成后立刻开始延伸，让延伸与仍然在跑的回查并行。
  // 快速模式跳过回查和延伸，精读模式并行补一轮细节回查。
  onPartial({ progress: { phase: 'cards', done: 0, total: 1, cards: 0 } })
  const range = cardRange(countChars(merged.main), mode)
  const auditPromise =
    mode === 'fast'
      ? Promise.resolve([] as AuditMissing[])
      : auditFidelity(model, args, merged.main, signal)
  const detailAuditPromise =
    mode === 'deep'
      ? auditDetails(model, args, merged.main, signal)
      : Promise.resolve([] as AuditMissing[])
  let cards = await extractCards(model, args, merged.main, range, signal)
  if (cards.length > range.max) {
    cards = await refilterCards(model, args, cards, range.max, signal)
  }
  if (cards.length === 0) cards = fallbackCards(merged.main)
  onPartial({ progress: { phase: 'cards', done: 1, total: 1, cards: cards.length } })

  onPartial({ progress: { phase: 'expand', done: 0, total: cards.length, cards: cards.length } })
  const expandPromise =
    mode === 'fast'
      ? Promise.resolve(new Map<number, NoteDivergence[]>())
      : expandCards(model, args, cards, signal)
  const [audit, detailAudit, divergences] = await Promise.all([
    auditPromise,
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
    model: args.config.model,
    createdAt: new Date().toISOString(),
  }
  return { notes: validatedNotes(notes), report }
}

function validatedNotes(notes: GeneratedNote[]): GeneratedNote[] {
  const parsed = generatedNoteListSchema.safeParse(notes)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  throw new Error(`生成结果格式异常${issue ? `：${issue.path.join('.') || 'notes'} ${issue.message}` : ''}`)
}

function buildSections(chapterHtml: string, chapterText: string): Section[] {
  const sections: Section[] = []

  if (chapterHtml.trim()) {
    const $ = cheerio.load(chapterHtml)
    let title = ''
    let blocks: string[] = []
    const push = (): void => {
      const text = blocks.join('\n\n').trim()
      if (text.length >= 20) sections.push({ index: sections.length, title, text })
      blocks = []
    }

    $('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, figcaption').each((_, element) => {
      const node = $(element)
      const tag = String(
        (element as { tagName?: string; name?: string }).tagName ??
          (element as { name?: string }).name ??
          '',
      ).toLowerCase()
      const text = node.text().replace(/\s+/g, ' ').trim()
      if (/^h[1-6]$/.test(tag)) {
        if (text) {
          push()
          title = text
        }
        return
      }
      if ((tag === 'li' || tag === 'blockquote') && node.find('p').length > 0) return
      if (text.length >= 10) blocks.push(text)
    })
    push()
  }

  if (sections.length === 0) {
    let title = ''
    let blocks: string[] = []
    const push = (): void => {
      const text = blocks.join('\n\n').trim()
      if (text.length >= 20) sections.push({ index: sections.length, title, text })
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
      chunks.push({ sectionIndex: section.index, title: section.title, text: section.text })
      continue
    }
    const paragraphs = section.text.split(/\n{2,}/)
    let current: string[] = []
    let length = 0
    const flush = (): void => {
      if (current.length === 0) return
      chunks.push({
        sectionIndex: section.index,
        title: section.title,
        text: current.join('\n\n'),
      })
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

// ─── 阶段一：压缩重写 ─────────────────────────────────────────────────────

function condensePrompt(args: GenerateArgs, chunk: Chunk): string {
  const numbered = chunk.text
    .split(/\n{2,}/)
    .map((paragraph, index) => `[§${index + 1}] ${paragraph.trim()}`)
    .join('\n\n')
  const hint = genreRule(args.genre)

  return [
    `你在把一本书读薄，目标是写成一篇可以直接发博客的读薄稿。书名《${args.bookTitle}》，本章「${args.chapterTitle}」，小节「${chunk.title || '正文'}」。`,
    ...(hint ? [hint] : []),
    '',
    '请完成：',
    '1. 只保留作者的断言（观点、定义、机制、方法、数据结论、边界条件）；删掉铺垫、过渡、寒暄、重复强调、解释性从句和例子铺垫。',
    '2. 按断言重新组织，把分散的同一论点合并；不要按原文段落顺序复制，也不要保留原句，必须用自己的话重写。',
    '3. 写成博客：小标题 + 短段落；并列项改成列表；定义写成「术语：一句话」；例子压成半句或列表项。',
    '4. 每一句话都必须有信息量。删掉这句话后读者仍然能理解作者，就删掉它。',
    '5. 压缩幅度由你根据内容密度决定：论证密集可保留约 1/3，例子多可到 1/5，重复多可到 1/10；目标是不超过原文的一半，能更短就继续删。比例只是参考，断言优先。',
    '6. 不要写「作者认为」「本章」「接下来」这类元话；不要加入原文没有的观点；不要在正文里保留（源：§n）或段落编号。',
    '7. 删除的内容放进 omitted，给出原文片段和原因。',
    '',
    '示例：',
    '原文：要理解这个问题，需要先看 X 的历史；X 由内到外至少有三层：A、B、C。',
    '读薄稿：',
    '## X 的三层结构',
    '- A：……',
    '- B：……',
    '- C：……',
    '',
    '只输出一个 JSON 对象：{"compressed":"Markdown 读薄稿","omitted":[{"text":"...","reason":"..."}]}。不要输出 Markdown 代码块或额外解释。',
    '',
    '原文：',
    numbered,
  ].join('\n')
}

async function condenseChunk(
  model: ReturnType<typeof createLanguageModel>,
  args: GenerateArgs,
  chunk: Chunk,
  signal: AbortSignal,
): Promise<CondenseOutput> {
  const prompt = condensePrompt(args, chunk)
  const target = Math.max(120, Math.round(chunk.text.length / 3))
  let last: CondenseOutput | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) throw new Error('生成已取消')
    const response = await tracedGenerateText({ step: 'condense', model: args.config.model, promptVersion: NOTES_PROMPT_VERSION }, {
      model,
      prompt:
        attempt === 0
          ? prompt
          : `${prompt}\n\n上一次的读薄稿仍然太厚，或者没有按 JSON 返回。请改成博客可直接发布的版本：只保留断言，删掉所有铺垫、解释性从句和重复，把并列项改成列表，目标不超过原文的 1/3（约 ${target} 字）。不要加入原文没有的观点，不要保留段落编号。`,
      temperature: 0.3,
      maxRetries: 1,
      abortSignal: requestTimeout(signal, 180_000),
    })
    recordUsage(args.usage, response.usage)
    const parsed = normalizeCondense(response.text, chunk.title)
    if (!parsed.compressed) continue
    last = parsed
    const tooLong =
      chunk.text.length >= 300 && countChars(parsed.compressed) > chunk.text.length * 0.6
    if (tooLong && attempt === 0) continue
    return parsed
  }

  return last ?? { compressed: chunk.text, omitted: [] }
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

async function auditFidelity(
  model: ReturnType<typeof createLanguageModel>,
  args: GenerateArgs,
  condensed: string,
  signal: AbortSignal,
): Promise<AuditMissing[]> {
  if (signal.aborted) throw new Error('生成已取消')
  // 回查只用于发现明显遗漏；截取前 24k 字能覆盖大多数章节，避免整章重复上送。
  const original = args.chapterText.slice(0, 24_000)
  const prompt = [
    '下面是一本书的一章原文，以及一份要求“保留作者全部断言”的读薄稿。',
    '请逐条断言回查：读薄稿有没有漏掉作者的主张、论证链、关键例子或边界条件？被有意压缩的重复内容和铺垫不算缺失，表达差异也不算。',
    '只输出 JSON 对象：{"missing":[{"section":"...","point":"..."}]}。没有缺失就返回 {"missing":[]}。不要输出 Markdown 代码块。',
    '',
    '原文：',
    original,
    '',
    '读薄稿：',
    condensed,
  ].join('\n')

  try {
    const response = await tracedGenerateText({ step: 'audit-fidelity', model: args.config.model, promptVersion: NOTES_PROMPT_VERSION }, {
      model,
      prompt,
      temperature: 0.2,
      maxRetries: 1,
      abortSignal: requestTimeout(signal, 180_000),
    })
    recordUsage(args.usage, response.usage)
    return normalizeAudit(parseJsonFromText(response.text)).slice(0, 12)
  } catch (error) {
    if (signal.aborted) throw error
    return []
  }
}

async function auditDetails(
  model: ReturnType<typeof createLanguageModel>,
  args: GenerateArgs,
  condensed: string,
  signal: AbortSignal,
): Promise<AuditMissing[]> {
  if (signal.aborted) throw new Error('生成已取消')
  const hint = genreRule(args.genre)
  const prompt = [
    '下面是一本书的一章原文与读薄稿。请只做第二轮细节回查，找标准回查容易漏掉的内容：',
    '定义之间的细微区别、限定条件、作者举出的反例、人物/事件的因果、以及被压缩后失去的语境。',
    hint,
    '不要重复泛泛的主旨，不要把重复内容或纯铺垫算作缺失；没有就返回空数组。',
    '只输出 JSON 对象：{"missing":[{"section":"...","point":"..."}]}。不要输出 Markdown 代码块。',
    '',
    '原文：',
    args.chapterText.slice(0, 28_000),
    '',
    '读薄稿：',
    condensed,
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const response = await tracedGenerateText({ step: 'audit-details', model: args.config.model, promptVersion: NOTES_PROMPT_VERSION }, {
      model,
      prompt,
      temperature: 0.25,
      maxRetries: 1,
      abortSignal: requestTimeout(signal, 180_000),
    })
    recordUsage(args.usage, response.usage)
    return normalizeAudit(parseJsonFromText(response.text)).slice(0, 8)
  } catch (error) {
    if (signal.aborted) throw error
    return []
  }
}

function buildAuditBlock(missing: AuditMissing[]): string {
  const items = missing
    .filter((item) => item.point.trim())
    .map((item) => `- ${item.point.trim()}${item.section.trim() ? `（${item.section.trim()}）` : ''}`)
    .join('\n')
  return items ? `## 补遗（断言回查）\n\n${items}` : ''
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

function cardRange(chars: number, mode: GenerationMode = 'standard'): { min: number; max: number } {
  if (chars <= 1000) return { min: 5, max: mode === 'fast' ? 7 : 8 }
  if (chars <= 3000) return { min: 8, max: mode === 'fast' ? 12 : 15 }
  return { min: 15, max: mode === 'fast' ? 18 : 25 }
}

async function extractCards(
  model: ReturnType<typeof createLanguageModel>,
  args: GenerateArgs,
  compressed: string,
  range: { min: number; max: number },
  signal: AbortSignal,
): Promise<Card[]> {
  const hint = genreRule(args.genre)
  const prompt = [
    `书名《${args.bookTitle}》，本章「${args.chapterTitle}」。下面是本章的读薄稿：`,
    ...(hint ? [hint] : []),
    compressed.slice(0, 26_000),
    '',
    '请只从这份读薄稿里提炼知识点卡片；下面的原文只用于填写 evidence，不要从原文新增卡片。',
    `卡片数量：根据读薄稿字数，只保留 ${range.min}-${range.max} 张（读薄稿约 ${countChars(compressed)} 字）。`,
    '什么样才算知识点：用一句话测试——不知道它，会影响对全文的理解吗？会，才收；不会但有意思，留在读薄稿里；原文的每个案例细节不是知识点，是索引。',
    '本章原文（只用于 evidence 逐字引用）：',
    args.chapterText.slice(0, EVIDENCE_SOURCE_CHARS),
    '',
    '每张卡片必须填满：',
    '1. point：一句话知识点（用作者的语言或自己的话，选更准确的）。',
    '2. role：它在全文中的作用——支撑什么结论、处于论证链的哪一环。',
    '3. evidence：从上面原文中逐字复制一句能支撑 point 的话，必须与原文一致；可省略首尾标点，不要改写，不要只写段落号；找不到就留空。',
    '4. section：所属小节。',
    '5. concepts：术语数组。',
    '6. importance：1-5。',
    '如果候选超过上限，合并重复、删掉次要的；不要为了凑数保留案例细节。',
    '只输出 JSON 对象：{"cards":[...]}。不要输出 Markdown 代码块或额外解释。',
  ].join('\n')

  try {
    const response = await tracedGenerateText({ step: 'extract-cards', model: args.config.model, promptVersion: NOTES_PROMPT_VERSION }, {
      model,
      prompt,
      temperature: 0.2,
      maxRetries: 1,
      abortSignal: requestTimeout(signal, 180_000),
    })
    recordUsage(args.usage, response.usage)
    return normalizeCards(parseJsonFromText(response.text), args.chapterText).slice(0, range.max)
  } catch (error) {
    if (signal.aborted) throw error
    return []
  }
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

  try {
    const response = await tracedGenerateText({ step: 'refilter-cards', model: args.config.model, promptVersion: NOTES_PROMPT_VERSION }, {
      model,
      prompt,
      temperature: 0.15,
      maxRetries: 1,
      abortSignal: requestTimeout(signal, 180_000),
    })
    recordUsage(args.usage, response.usage)
    const filtered = normalizeCards(parseJsonFromText(response.text), args.chapterText).slice(0, max)
    if (filtered.length > 0) return filtered
  } catch (error) {
    if (signal.aborted) throw error
  }

  return [...cards].sort((a, b) => b.importance - a.importance).slice(0, max)
}

function normalizeCards(raw: unknown, chapterText: string): Card[] {
  const obj = isRecord(raw) ? raw : {}
  const list = listOfValues(pickField(obj, ['cards', 'points', 'knowledgePoints', 'knowledge_points', '知识点']))
  const cards: Card[] = []
  for (const item of list) {
    const card = cardFromValue(item, chapterText)
    if (card) cards.push(card)
  }
  return cards
}

function cardFromValue(value: unknown, chapterText: string): Card | null {
  if (typeof value === 'string') {
    const point = stripBullet(value)
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
  const point = textOfValue(
    pickField(value, ['point', 'claim', 'content', 'knowledge', 'statement', 'idea', 'text']),
  )
  if (!point) return null
  const evidence = textOfValue(pickField(value, ['evidence', 'quote', 'source', '依据', 'citation'])).slice(0, 400)
  const importanceValue = Number(pickField(value, ['importance', 'weight', 'score', 'priority']) ?? 3)
  return {
    point,
    role: textOfValue(pickField(value, ['role', 'function', '作用', 'position'])),
    evidence,
    evidenceVerified: evidence ? verifyQuote(evidence, chapterText) : false,
    section: textOfValue(pickField(value, ['section', 'chapter', '小节'])),
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
    if (!first) continue
    cards.push({
      point: first.slice(0, 120),
      role: '',
      evidence: heading,
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

  try {
    const response = await tracedGenerateText({ step: 'expand-cards', model: args.config.model, promptVersion: NOTES_PROMPT_VERSION }, {
      model,
      prompt,
      temperature: 0.5,
      maxRetries: 1,
      abortSignal: requestTimeout(signal, 180_000),
    })
    recordUsage(args.usage, response.usage)
    return normalizeDivergences(parseJsonFromText(response.text), items)
  } catch (error) {
    if (signal.aborted) throw error
    return new Map()
  }
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

  const response = await tracedGenerateText({ step: 'expand-point', model: args.config.model, promptVersion: NOTES_PROMPT_VERSION }, {
    model,
    prompt,
    temperature: 0.6,
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
      quote: card.evidence || null,
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

async function demoGeneration(
  args: GenerateArgs,
  onPartial: (partial: GeneratePartial) => void,
  signal: AbortSignal,
): Promise<GenerateResult> {
  const startedAt = Date.now()
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
  if (haystack.includes(needle)) return true
  return haystack.includes(needle.slice(0, 24))
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
