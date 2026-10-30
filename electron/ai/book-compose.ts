import { generateText } from 'ai'

import type {
  BookComposeOptions,
  BookComposeProgress,
  BookComposeResult,
} from '../../shared/types.js'
import type { ModelConfig } from './provider.js'
import { createLanguageModel } from './provider.js'

const BATCH_CHARS = 7_000
const FINAL_EDITOR_CHARS = 30_000
const CONCURRENCY = 2
const REQUEST_TIMEOUT_MS = 180_000

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
  config: ModelConfig
  demo: boolean
  signal: AbortSignal
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

function lengthRule(length: BookComposeOptions['length']): string {
  return length === 'tight'
    ? '篇幅收紧：在不丢关键论点和例子的前提下，压到草稿的 70% 左右，删掉解释性的废话。'
    : '篇幅完整：保留草稿里的主要论证、例子和限定条件，只合并重复，不为了短而删除信息。'
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
  if (!args.config.apiKey && args.config.provider !== 'ollama') {
    throw new Error('还没有配置 API Key，无法合并整本书。')
  }

  const model = createLanguageModel(args.config)
  const batches = splitBatches(sources)
  const sections: string[] = new Array(batches.length).fill('')
  let nextBatch = 0
  let rewritten = 0
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
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker))

  let draft = sections.filter(Boolean).join('\n\n').trim()
  if (!draft) throw new Error('没有可合并的正文，请重试或换一个模型。')

  args.onProgress({ stage: 'polish', done: 0, total: 1, message: '正在统一语气、补过渡、去 AI 味' })
  let title = ''
  let markdown = ''
  try {
    if (draft.length <= FINAL_EDITOR_CHARS) {
      const final = await finalEdit(model, args, draft)
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
    model: args.config.model,
    createdAt: new Date().toISOString(),
    options: args.options,
  }
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
  const prompt = [
    `书名：《${args.bookTitle}》${args.author ? `，作者：${args.author}` : ''}`,
    `这一组包含 ${batch.length} 章。把下面的读薄稿整理成整本书正文中的一段。`,
    '',
    sourceBlock(batch),
    '',
    '要求：',
    '1. 保留全部关键论点、定义、例子、条件和反例；合并重复的句子。',
    '2. 用 ## 或 ### 做小标题，小标题要具体，不要写“本章”“第一部分”。',
    '3. 补上章节之间的过渡，但不要写“接下来我们来看”。',
    '4. 不要输出书名大标题，也不要写导语；只输出这一段正文。',
    '5. 不要提“这一章”“作者认为”“书中指出”这类元话，除非确实需要区分作者立场。',
    DE_AI_RULES,
  ].join('\n')

  const controller = linkedController(args.signal, REQUEST_TIMEOUT_MS)
  try {
    const response = await generateText({
      model,
      system: '你是中文非虚构图书的资深编辑，擅长把笔记整理成自然、有判断、能直接发布的博客长文。',
      prompt,
      temperature: 0.45,
      maxRetries: 1,
      abortSignal: controller.signal,
    })
    return cleanSection(response.text)
  } finally {
    controller.dispose()
  }
}

async function finalEdit(
  model: ReturnType<typeof createLanguageModel>,
  args: ComposeArgs,
  draft: string,
): Promise<{ title: string; markdown: string }> {
  const prompt = [
    `书名：《${args.bookTitle}》${args.author ? `，作者：${args.author}` : ''}`,
    `成稿偏好：${lengthRule(args.options.length)}`,
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
    '- 正文按主题重组，保留草稿里的小标题和全部关键论点；可以合并、改名、调整顺序。',
    '- 结尾 2–3 段，落到一个具体判断或仍未解决的问题，不要空泛升华。',
    '- 只输出 Markdown，不要代码块，不要解释你的编辑过程。',
    DE_AI_RULES,
  ].join('\n')

  const controller = linkedController(args.signal, REQUEST_TIMEOUT_MS)
  try {
    const response = await generateText({
      model,
      system: '你是这本书的终审编辑。你的工作是让文章像一个真正读过书的人写的，而不是模型生成的摘要。',
      prompt,
      temperature: 0.5,
      maxRetries: 1,
      abortSignal: controller.signal,
    })
    let markdown = cleanArticle(response.text)
    const title = extractTitle(markdown, args.bookTitle)
    if (!/^#\s+/m.test(markdown)) markdown = `# ${title}\n\n${markdown}`
    return { title, markdown }
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
  const prompt = [
    `书名：《${args.bookTitle}》${args.author ? `，作者：${args.author}` : ''}`,
    '这本书的读薄稿很长，正文已经分章整理好。现在只需要写标题、副标题、导语和结尾。',
    `成稿偏好：${lengthRule(args.options.length)}`,
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
  try {
    const response = await generateText({
      model,
      system: '你是这本书的终审编辑。你只为长文写开头和结尾，正文由章节编辑完成。',
      prompt,
      temperature: 0.5,
      maxRetries: 1,
      abortSignal: controller.signal,
    })
    const raw = cleanArticle(response.text)
    const [head, tail = ''] = raw.split('<<<END>>>')
    const title = extractTitle(head ?? '', args.bookTitle)
    return {
      title,
      markdown: `${(head ?? '').trim()}\n\n${draft}\n\n${tail.trim()}`.trim(),
    }
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
