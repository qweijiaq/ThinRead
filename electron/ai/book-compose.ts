import { createHash } from 'node:crypto'
import { readFile, mkdir, rename, writeFile, readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

import type {
  BookComposeOptions,
  BookComposeProgress,
  BookComposeResult,
  BookGenre,
  GenerationMode,
  TokenUsage,
} from '../../shared/types.js'
import { genreRule } from './genre.js'
import { createLanguageModel, nonThinkingProviderOptions, type ModelConfig } from './provider.js'
import { tracedGenerateText } from './trace.js'

const COMPOSE_PROMPT_VERSION = 'compose-v5'
const COMPOSE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const COMPOSE_CACHE_MAX_FILES = 200

const BATCH_CHARS = 12_000
const SINGLE_PASS_CHARS = 24_000
const REQUEST_TIMEOUT_MS = 180_000

/** 大稿不再整篇重写终审：超过这个长度时只补标题/导语/结尾，保留已经整理好的章节正文。 */
function finalEditorChars(mode: GenerationMode | undefined): number {
  return mode === 'deep' ? 60_000 : mode === 'fast' ? 24_000 : 40_000
}

function composeConcurrency(mode: GenerationMode | undefined): number {
  return mode === 'deep' ? 2 : mode === 'fast' ? 4 : 3
}

export interface ComposeSource {
  title: string
  content: string
  cards: string[]
}

export interface ComposeArgs {
  bookTitle: string
  author: string
  sources: ComposeSource[]
  options: BookComposeOptions
  genre?: BookGenre
  mode?: GenerationMode
  usage?: TokenUsage
  config: ModelConfig
  demo: boolean
  signal: AbortSignal
  /** 成稿缓存目录；不传则不缓存。 */
  cacheDir?: string
  onProgress: (progress: BookComposeProgress) => void
}

const DE_AI_RULES = [
  '这是一篇给真人读的博客长文，不是报告。',
  '禁止使用这些句式和词：首先/其次/再次/最后、综上所述、总的来说、值得注意的是、不难发现、在当今社会、让我们一起、本文旨在、深刻认识到、赋能、底层逻辑。',
  '不要每节末尾都做总结，不要连续三段用同样的句式，不要堆三连排比。',
  '句子长短交替，允许短句和具体细节；多用动词和名词，少用抽象形容词。',
  '不要把每段都写成“观点 + 解释 + 例子”的模板；该停就停。',
  '保留作者原话里的锋利判断和具体例子，不要把它们磨平。',
  '只使用给定材料，不补充书外事实，不编造引文。',
].join('\n')

const VOICE_RULES: Record<BookComposeOptions['voice'], string> = {
  calm: '语气克制、准确，像一位编辑在讲清楚一本书，不煽动、不卖弄。',
  personal: '用第一人称读者视角，可以写“我读到这里才意识到”，但不要变成个人日记，重点仍是书。',
  sharp: '允许明确判断和不同意见，指出作者论证的强弱和边界，但要尊重原意。',
}

function recordUsage(target: TokenUsage | undefined, usage: unknown): void {
  if (!target || !usage || typeof usage !== 'object') return
  const value = usage as { inputTokens?: unknown; outputTokens?: unknown; totalTokens?: unknown }
  target.inputTokens += Number(value.inputTokens) || 0
  target.outputTokens += Number(value.outputTokens) || 0
  target.totalTokens += Number(value.totalTokens) || 0
}

function composeCacheKey(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

async function readComposeCache<T>(dir: string | undefined, key: string): Promise<T | null> {
  if (!dir) return null
  try {
    const file = path.join(dir, 'compose', `${key}.json`)
    const entry = JSON.parse(await readFile(file, 'utf8')) as { createdAt?: string; value?: T }
    if (!entry.createdAt || Date.now() - Date.parse(entry.createdAt) > COMPOSE_CACHE_TTL_MS) return null
    return (entry.value ?? null) as T | null
  } catch {
    return null
  }
}

async function writeComposeCache(dir: string | undefined, key: string, value: unknown): Promise<void> {
  if (!dir) return
  try {
    const folder = path.join(dir, 'compose')
    await mkdir(folder, { recursive: true })
    const file = path.join(folder, `${key}.json`)
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify({ createdAt: new Date().toISOString(), value }), 'utf8')
    await rename(temp, file)
    void pruneComposeCache(folder)
  } catch {
    // 缓存失败不影响生成。
  }
}

async function pruneComposeCache(folder: string): Promise<void> {
  try {
    const names = (await readdir(folder)).filter((name) => name.endsWith('.json'))
    if (names.length <= COMPOSE_CACHE_MAX_FILES) return
    const rows = await Promise.all(
      names.map(async (name) => {
        const file = path.join(folder, name)
        try {
          return { file, mtime: (await stat(file)).mtimeMs }
        } catch {
          return { file, mtime: 0 }
        }
      }),
    )
    rows.sort((a, b) => a.mtime - b.mtime)
    for (const row of rows.slice(0, rows.length - COMPOSE_CACHE_MAX_FILES)) {
      await unlink(row.file).catch(() => undefined)
    }
  } catch {
    // 清理失败不影响生成。
  }
}

function outputTarget(sourceChars: number, length: BookComposeOptions['length']): number {
  const ratio = length === 'tight' ? 0.55 : 0.82
  return Math.max(1_500, Math.round(sourceChars * ratio))
}

function lengthRule(length: BookComposeOptions['length'], sourceChars: number): string {
  const target = outputTarget(sourceChars, length)
  return length === 'tight'
    ? `篇幅收紧：目标全文约 ${target.toLocaleString()} 字（约为输入读薄稿的 55%），最多不超过 ${Math.round(target * 1.1).toLocaleString()} 字。在不丢关键论点的前提下，删掉重复、解释性铺垫和过多例子。`
    : `篇幅完整：目标全文约 ${target.toLocaleString()} 字（约为输入读薄稿的 82%），保留主要论证、必要例子和限定条件，只合并重复。`
}

export async function composeBook(args: ComposeArgs): Promise<BookComposeResult> {
  const startedAt = Date.now()
  const sources = args.sources.filter((source) => source.content.trim().length > 0)
  if (sources.length === 0) throw new Error('这本书还没有读薄稿。先给章节生成笔记，再来合并。')

  const sourceChars = sources.reduce((sum, source) => sum + source.content.length, 0)
  args.onProgress({
    stage: 'collect',
    done: sources.length,
    total: sources.length,
    message: `收齐 ${sources.length} 章读薄稿，共 ${sourceChars.toLocaleString()} 字`,
  })

  if (args.demo) {
    const result = demoCompose(args, sources, sourceChars, startedAt)
    return result
  }
  if (!args.config.apiKey && args.config.provider !== 'ollama' && args.config.provider !== 'lmstudio') {
    throw new Error('还没有配置 API Key，无法合并整本书。')
  }

  const model = createLanguageModel(args.config)
  const usage: TokenUsage = args.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  args.usage = usage
  let draft = ''
  const editorChars = finalEditorChars(args.mode)
  const fastTrack = args.mode === 'fast' && sourceChars <= editorChars
  if (sourceChars <= SINGLE_PASS_CHARS || fastTrack) {
    // 小书或快速档不拆批：直接让终审在一次请求里完成合并和压缩，省掉多轮调用。
    draft = sourceDraft(sources)
    args.onProgress({
      stage: 'rewrite',
      done: 1,
      total: 1,
      message: fastTrack ? '快速档跳过中间改写，直接终审' : '读薄稿规模适合单次终审，跳过分组改写',
    })
  } else {
    const batches = splitBatches(sources)
    const sections: string[] = new Array(batches.length).fill('')
    const workers = Math.min(composeConcurrency(args.mode), batches.length)
    let nextBatch = 0
    let rewritten = 0
    args.onProgress({
      stage: 'rewrite',
      done: 0,
      total: batches.length,
      message: `正在整理 ${batches.length} 组章节（${workers} 组并发）`,
    })
    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextBatch++
        if (index >= batches.length) return
        if (args.signal.aborted) throw new Error('合并已取消')
        const batch = batches[index]!
        try {
          sections[index] = await rewriteBatch(model, args, batch)
        } catch (error) {
          if (args.signal.aborted) throw error
          // 单批失败时退回到原始读薄稿，保证整本还能成稿。
          sections[index] = fallbackSection(batch)
        }
        rewritten++
        args.onProgress({
          stage: 'rewrite',
          done: rewritten,
          total: batches.length,
          message: `正在整理第 ${rewritten}/${batches.length} 组章节`,
        })
      }
    }
    await Promise.all(Array.from({ length: workers }, worker))
    draft = sections.filter(Boolean).join('\n\n').trim()
  }
  if (!draft) throw new Error('没有可合并的正文，请重试或换一个模型。')

  const useFinalEditor = draft.length <= editorChars
  args.onProgress({
    stage: 'polish',
    done: 0,
    total: 1,
    message: useFinalEditor
      ? '正在终审全文、统一语气并补过渡'
      : '正文已整理好，正在补标题、导语和结尾',
  })
  let title = ''
  let markdown = ''
  const finalTarget = outputTarget(sourceChars, args.options.length)
  try {
    if (useFinalEditor) {
      const final = await finalEdit(model, args, draft, finalTarget)
      title = final.title
      markdown = final.markdown
    } else {
      const framed = await frameLongBook(model, args, draft)
      title = framed.title
      markdown = framed.markdown
    }
  } catch (error) {
    if (args.signal.aborted) throw error
    // 最后一次润色失败时仍然交付已整理好的分段稿，不把整次生成作废。
    title = fallbackTitle(args.bookTitle)
    markdown = `# ${title}\n\n${draft}`
  }

  args.onProgress({ stage: 'assemble', done: 1, total: 1, message: '正在组装成稿' })
  markdown = normalizeArticle(markdown)
  if (!markdown.trim()) throw new Error('合并结果为空，请重试或换一个模型。')

  return {
    title,
    markdown,
    sourceChapters: sources.length,
    sourceChars,
    outputChars: markdown.length,
    durationMs: Date.now() - startedAt,
    usage: { ...usage },
    promptVersion: COMPOSE_PROMPT_VERSION,
    model: args.config.model,
    createdAt: new Date().toISOString(),
    options: args.options,
  }
}

function sourceDraft(sources: ComposeSource[]): string {
  return sources
    .map((source) => `## ${source.title}\n\n${source.content.trim()}`)
    .join('\n\n')
}

function splitBatches(sources: ComposeSource[]): ComposeSource[][] {
  const batches: ComposeSource[][] = []
  let current: ComposeSource[] = []
  let size = 0
  for (const source of sources) {
    if (current.length > 0 && size + source.content.length > BATCH_CHARS) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(source)
    size += source.content.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function sourceBlock(batch: ComposeSource[]): string {
  return batch
    .map((source) => {
      const cards = source.cards.length > 0 ? `\n核心卡片：${source.cards.join('；')}` : ''
      return `## 原章节：${source.title}${cards}\n\n${source.content}`
    })
    .join('\n\n')
}

async function rewriteBatch(
  model: ReturnType<typeof createLanguageModel>,
  args: ComposeArgs,
  batch: ComposeSource[],
): Promise<string> {
  const batchChars = batch.reduce((sum, source) => sum + source.content.length, 0)
  const lengthRatio =
    args.mode === 'fast' ? 0.52 : args.options.length === 'tight' ? 0.68 : 0.9
  const target = Math.max(1_000, Math.round(batchChars * lengthRatio))
  const maxTarget = Math.round(target * 1.15)
  const genreHint = genreRule(args.genre)
  const cacheKey = composeCacheKey({
    v: COMPOSE_PROMPT_VERSION,
    kind: 'batch',
    model: args.config.model,
    mode: args.mode ?? 'standard',
    book: args.bookTitle,
    genre: args.genre ?? null,
    options: args.options,
    batch: batch.map((source) => ({ title: source.title, content: source.content, cards: source.cards })),
  })
  const cachedSection = await readComposeCache<string>(args.cacheDir, cacheKey)
  if (cachedSection) return cachedSection
  const basePrompt = [
    `书名：《${args.bookTitle}》${args.author ? `，作者：${args.author}` : ''}`,
    ...(genreHint ? [genreHint] : []),
    `这一组包含 ${batch.length} 章，读薄稿约 ${batchChars.toLocaleString()} 字。把下面的读薄稿整理成整本书正文中的一段。`,
    '',
    sourceBlock(batch),
    '',
    '要求：',
    `1. 输出控制在约 ${target.toLocaleString()} 字，最多不超过 ${maxTarget.toLocaleString()} 字；合并重复，删掉解释性铺垫和过多例子。`,
    '2. 保留关键论点、定义、必要例子、条件和反例，不要把每句话都保留下来。',
    '3. 用 ## 或 ### 做小标题，小标题要具体，不要写“本章”“第一部分”。',
    '4. 补上章节之间的过渡，但不要写“接下来我们来看”。',
    '5. 不要输出书名大标题，也不要写导语；只输出这一段正文。',
    '6. 不要提“这一章”“作者认为”“书中指出”这类元话，除非确实需要区分作者立场。',
    DE_AI_RULES,
  ].join('\n')

  const controller = linkedController(args.signal, REQUEST_TIMEOUT_MS)
  const providerOptions = nonThinkingProviderOptions(args.config)
  try {
    let prompt = basePrompt
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await tracedGenerateText(
        {
          step: 'compose-batch',
          provider: args.config.provider,
          model: args.config.model,
          promptVersion: COMPOSE_PROMPT_VERSION,
          timeoutMs: REQUEST_TIMEOUT_MS,
        },
        {
          model,
          system: '你是中文非虚构图书的资深编辑，擅长把笔记整理成自然、有判断、能直接发布的博客长文。',
          prompt,
          temperature: 0.45,
          maxOutputTokens: Math.min(32_000, Math.max(1_200, Math.ceil(maxTarget * 2))),
          maxRetries: 1,
          ...(providerOptions ? { providerOptions } : {}),
          abortSignal: controller.signal,
        },
      )
      recordUsage(args.usage, response.usage)
      const section = cleanSection(response.text)
      if (section.length <= maxTarget || attempt === 1) {
        await writeComposeCache(args.cacheDir, cacheKey, section)
        return section
      }
      prompt = `${basePrompt}\n\n上一次输出了 ${section.length.toLocaleString()} 字，仍然太长。请再压一轮：保留全部关键判断和必要例子，删除重复、铺垫、解释性从句和次要案例，把正文控制在 ${target.toLocaleString()} 字以内。`
    }
    return ''
  } finally {
    controller.dispose()
  }
}


async function finalEdit(
  model: ReturnType<typeof createLanguageModel>,
  args: ComposeArgs,
  draft: string,
  targetChars: number,
): Promise<{ title: string; markdown: string }> {
  const sourceChars = args.sources.reduce((sum, source) => sum + source.content.length, 0)
  const genreHint = genreRule(args.genre)
  const cacheKey = composeCacheKey({
    v: COMPOSE_PROMPT_VERSION,
    kind: 'final',
    model: args.config.model,
    mode: args.mode ?? 'standard',
    book: args.bookTitle,
    author: args.author,
    genre: args.genre ?? null,
    options: args.options,
    targetChars,
    draft,
  })
  const cached = await readComposeCache<{ title: string; markdown: string }>(args.cacheDir, cacheKey)
  if (cached) return cached
  const prompt = [
    `书名：《${args.bookTitle}》${args.author ? `，作者：${args.author}` : ''}`,
    ...(genreHint ? [genreHint] : []),
    `成稿偏好：${lengthRule(args.options.length, sourceChars)}`,
    `语气：${VOICE_RULES[args.options.voice]}`,
    '',
    '下面是已经按章节整理过的草稿。请做最后一轮编辑，把它变成一篇完整的、可以直接发博客的读书长文。',
    '',
    draft,
    '',
    '输出格式：',
    '- 第一行是一级标题：具体、有判断，可以带书名，但不要写成“《书名》读书笔记”这种流水账。',
    '- 第二行是一句引用式副标题（> 开头），不超过 40 字。',
    '- 然后 2–4 段导语，直接进入这本书要解决的问题，不要写“本文将”。',
    `- 正文按主题重组，可以合并、改名、调整顺序；保留关键论点，但删掉重复、解释性铺垫和过多例子，目标全文约 ${targetChars.toLocaleString()} 字，最多不超过 ${Math.round(targetChars * 1.1).toLocaleString()} 字。`,
    '- 结尾 2–3 段，落到一个具体判断或仍未解决的问题，不要空泛升华。',
    '- 只输出 Markdown，不要代码块，不要解释你的编辑过程。',
    DE_AI_RULES,
  ].join('\n')

  const controller = linkedController(args.signal, REQUEST_TIMEOUT_MS)
  const providerOptions = nonThinkingProviderOptions(args.config)
  try {
    const response = await tracedGenerateText(
      {
        step: 'compose-final',
        provider: args.config.provider,
        model: args.config.model,
        promptVersion: COMPOSE_PROMPT_VERSION,
        timeoutMs: REQUEST_TIMEOUT_MS,
      },
      {
        model,
        system: '你是这本书的终审编辑。你的工作是让文章像一个真正读过书的人写的，而不是模型生成的摘要。',
        prompt,
        temperature: 0.5,
        maxOutputTokens: Math.min(64_000, Math.max(1_500, Math.ceil(targetChars * 1.8))),
        maxRetries: 1,
        ...(providerOptions ? { providerOptions } : {}),
        abortSignal: controller.signal,
      },
    )
    recordUsage(args.usage, response.usage)
    let markdown = cleanArticle(response.text)
    const title = extractTitle(markdown, args.bookTitle)
    if (!/^#\s+/m.test(markdown)) markdown = `# ${title}\n\n${markdown}`
    const result = { title, markdown }
    await writeComposeCache(args.cacheDir, cacheKey, result)
    return result
  } finally {
    controller.dispose()
  }
}

async function frameLongBook(
  model: ReturnType<typeof createLanguageModel>,
  args: ComposeArgs,
  draft: string,
): Promise<{ title: string; markdown: string }> {
  const outline = args.sources
    .map((source) => `- ${source.title}：${source.content.replace(/\s+/g, ' ').slice(0, 160)}`)
    .join('\n')
  const genreHint = genreRule(args.genre)
  const cacheKey = composeCacheKey({
    v: COMPOSE_PROMPT_VERSION,
    kind: 'frame',
    model: args.config.model,
    mode: args.mode ?? 'standard',
    book: args.bookTitle,
    author: args.author,
    genre: args.genre ?? null,
    options: args.options,
    outline,
    draft,
  })
  const cached = await readComposeCache<{ title: string; markdown: string }>(args.cacheDir, cacheKey)
  if (cached) return cached
  const prompt = [
    `书名：《${args.bookTitle}》${args.author ? `，作者：${args.author}` : ''}`,
    ...(genreHint ? [genreHint] : []),
    '这本书的读薄稿很长，正文已经分章整理好。现在只需要写标题、副标题、导语和结尾。',
    `成稿偏好：${lengthRule(args.options.length, args.sources.reduce((sum, source) => sum + source.content.length, 0))}`,
    `语气：${VOICE_RULES[args.options.voice]}`,
    '',
    '章节提纲：',
    outline,
    '',
    '输出格式（严格遵守）：',
    '# 标题',
    '> 副标题',
    '导语 2–4 段',
    '<<<END>>>',
    '结尾 2–3 段',
    '',
    '不要复述章节内容，不要输出正文。',
    DE_AI_RULES,
  ].join('\n')

  const controller = linkedController(args.signal, REQUEST_TIMEOUT_MS)
  const providerOptions = nonThinkingProviderOptions(args.config)
  try {
    const response = await tracedGenerateText(
      {
        step: 'compose-frame',
        provider: args.config.provider,
        model: args.config.model,
        promptVersion: COMPOSE_PROMPT_VERSION,
        timeoutMs: REQUEST_TIMEOUT_MS,
      },
      {
        model,
        system: '你是这本书的终审编辑。你只为长文写开头和结尾，正文由章节编辑完成。',
        prompt,
        temperature: 0.5,
        maxOutputTokens: 6_000,
        maxRetries: 1,
        ...(providerOptions ? { providerOptions } : {}),
        abortSignal: controller.signal,
      },
    )
    recordUsage(args.usage, response.usage)
    const raw = cleanArticle(response.text)
    const [head, tail = ''] = raw.split('<<<END>>>')
    const title = extractTitle(head ?? '', args.bookTitle)
    const result = {
      title,
      markdown: `${(head ?? '').trim()}\n\n${draft}\n\n${tail.trim()}`.trim(),
    }
    await writeComposeCache(args.cacheDir, cacheKey, result)
    return result
  } finally {
    controller.dispose()
  }
}

function cleanSection(raw: string): string {
  let text = raw.trim()
  text = text.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/i, '').trim()
  text = text.replace(/^#\s+.*\n+/, '')
  return text.trim()
}

function cleanArticle(raw: string): string {
  let text = raw.trim()
  text = text.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/i, '').trim()
  return text
}

function normalizeArticle(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

function extractTitle(markdown: string, bookTitle: string): string {
  const first = markdown.split('\n').find((line) => line.trim().startsWith('# '))
  const title = first?.replace(/^#\s+/, '').trim()
  return title || fallbackTitle(bookTitle)
}

function fallbackTitle(bookTitle: string): string {
  return `《${bookTitle}》读书笔记：把一本书读成一条线`
}

function fallbackSection(batch: ComposeSource[]): string {
  return batch.map((source) => `## ${source.title}\n\n${source.content.trim()}`).join('\n\n')
}

function demoCompose(
  args: ComposeArgs,
  sources: ComposeSource[],
  sourceChars: number,
  startedAt: number,
): BookComposeResult {
  const title = fallbackTitle(args.bookTitle)
  const sections = sources
    .map((source) => {
      const body = source.content.trim().replace(/\n{3,}/g, '\n\n')
      return `## ${source.title}\n\n${body}`
    })
    .join('\n\n')
  const markdown = [
    `# ${title}`,
    `> 把《${args.bookTitle}》的每一章读薄，再拼回一条完整的线索`,
    `这是《${args.bookTitle}》的整本读薄稿。下面按章节保留作者的关键论点，去掉重复的铺垫，方便一口气读完。`,
    sections,
    '## 最后',
    '这本书的观点已经按章节连起来了。读第二遍时，可以回到任意一章，看它在整本书里支撑什么结论。',
  ].join('\n\n')
  args.onProgress({ stage: 'rewrite', done: sources.length, total: sources.length, message: '演示模式：直接整理读薄稿' })
  args.onProgress({ stage: 'polish', done: 1, total: 1, message: '演示模式：完成排版' })
  args.onProgress({ stage: 'assemble', done: 1, total: 1, message: '正在组装成稿' })
  return {
    title,
    markdown,
    sourceChapters: sources.length,
    sourceChars,
    outputChars: markdown.length,
    durationMs: Date.now() - startedAt,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    promptVersion: 'compose-v4-demo',
    model: args.config.model,
    createdAt: new Date().toISOString(),
    options: args.options,
  }
}

/** 把外部取消和单次请求超时接到同一个 controller 上，避免请求无限挂住。 */
function linkedController(parent: AbortSignal, timeoutMs: number): {
  signal: AbortSignal
  dispose(): void
} {
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  if (parent.aborted) controller.abort()
  else parent.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      parent.removeEventListener('abort', onAbort)
    },
  }
}
