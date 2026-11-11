import * as cheerio from 'cheerio'

import { htmlToText } from '../html.js'
import type { ModelConfig } from './provider.js'
import { createLanguageModel, nonThinkingProviderOptions } from './provider.js'
import { tracedGenerateText } from './trace.js'
import { detectSourceLanguage } from './notes-prompts.js'

const MAX_CHUNK_CHARS = 6_000
const MAX_BATCH_CHARS = 5_000
const MAX_BATCH_BLOCKS = 24
const REQUEST_TIMEOUT_MS = 120_000
const BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,td,th,dt,dd,caption'

export interface TranslateChapterArgs {
  bookTitle: string
  chapterTitle: string
  html: string
  text: string
  config: ModelConfig
  signal: AbortSignal
  onProgress?: (done: number, total: number) => void
}

export interface TranslationResult {
  html: string
  text: string
}

interface BlockText {
  element: unknown
  text: string
  codes: string[]
}

function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= MAX_CHUNK_CHARS) return [paragraph]
  const parts: string[] = []
  let rest = paragraph
  while (rest.length > MAX_CHUNK_CHARS) {
    const window = rest.slice(0, MAX_CHUNK_CHARS)
    const sentenceEnd = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('! '),
      window.lastIndexOf('? '),
      window.lastIndexOf('。'),
      window.lastIndexOf('！'),
      window.lastIndexOf('？'),
    )
    const cut = sentenceEnd > MAX_CHUNK_CHARS * 0.45 ? sentenceEnd + 1 : MAX_CHUNK_CHARS
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

/** 纯文本回退用：按段落切块，避免单次请求过大。 */
export function splitTranslationChunks(text: string): string[] {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const chunks: string[] = []
  let current: string[] = []
  let size = 0
  const flush = (): void => {
    if (current.length === 0) return
    chunks.push(current.join('\n\n'))
    current = []
    size = 0
  }
  for (const paragraph of paragraphs) {
    for (const part of splitLongParagraph(paragraph)) {
      if (current.length > 0 && size + part.length > MAX_CHUNK_CHARS) flush()
      current.push(part)
      size += part.length
    }
  }
  flush()
  return chunks
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderBlockText(text: string, codes: string[]): string {
  let html = escapeHtml(text)
  codes.forEach((code, index) => {
    html = html.replaceAll(`⟦C${index}⟧`, `<code>${escapeHtml(code)}</code>`)
  })
  return html
}

function parseJsonArray(text: string): string[] | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const attempts = [trimmed]
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start >= 0 && end > start) attempts.push(trimmed.slice(start, end + 1))
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown
      if (!Array.isArray(parsed)) continue
      if (!parsed.every((item) => typeof item === 'string')) continue
      return parsed
    } catch {
      // 继续尝试去掉代码块后的 JSON 数组。
    }
  }
  return null
}

function collectBlocks(html: string) {
  const $ = cheerio.load(`<div id="__translate_root">${html}</div>`)
  const root = $('#__translate_root')
  const blocks: BlockText[] = []
  root.find(BLOCK_SELECTOR).each((_, element) => {
    const node = $(element)
    // 只处理叶子块，避免 li > p、td > p 重复翻译。
    if (node.find(BLOCK_SELECTOR).length > 0) return
    if (node.find('img, svg, pre').length > 0) return
    const codes: string[] = []
    const clone = node.clone()
    clone.find('code').each((index, code) => {
      codes.push($(code).text())
      $(code).replaceWith(`⟦C${index}⟧`)
    })
    const text = clone.text().replace(/\s+/g, ' ').trim()
    if (text.length < 2) return
    blocks.push({ element, text, codes })
  })
  return { $, root, blocks }
}

function batchBlocks(blocks: BlockText[]): number[][] {
  const batches: number[][] = []
  let current: number[] = []
  let size = 0
  const flush = (): void => {
    if (current.length === 0) return
    batches.push(current)
    current = []
    size = 0
  }
  blocks.forEach((block, index) => {
    if (
      current.length > 0 &&
      (current.length >= MAX_BATCH_BLOCKS || size + block.text.length > MAX_BATCH_CHARS)
    ) {
      flush()
    }
    current.push(index)
    size += block.text.length
  })
  flush()
  return batches
}

async function translateTexts(
  model: ReturnType<typeof createLanguageModel>,
  args: TranslateChapterArgs,
  texts: string[],
): Promise<string[]> {
  if (texts.length === 0) return []
  const totalChars = texts.reduce((sum, text) => sum + text.length, 0)
  const prompt = [
    `你在翻译《${args.bookTitle}》的章节「${args.chapterTitle}」。`,
    '下面是一个 JSON 字符串数组。每个元素是一段正文、标题或表格单元格。',
    '请把每个元素完整翻译成简体中文，并保持数组顺序和数量完全一致。',
    '要求：',
    '1. 逐元素翻译，不要合并、拆分、总结或增删内容。',
    '2. 保留段落内的 ⟦C0⟧、⟦C1⟧ 这类代码占位符，原样输出，不要翻译或删除。',
    '3. 专有名词首次出现时可以写成「中文（原文）」。',
    '4. 只输出 JSON 数组，不要代码块或解释。',
    '',
    JSON.stringify(texts),
  ].join('\n')

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    if (args.signal.aborted) throw new Error('翻译已取消')
    const response = await tracedGenerateText(
      {
        step: 'chapter-translate',
        provider: args.config.provider,
        model: args.config.model,
        promptVersion: 'translate-html-v1',
        timeoutMs: REQUEST_TIMEOUT_MS,
      },
      {
        model,
        prompt:
          attempt === 0
            ? prompt
            : `${prompt}\n\n上一次没有返回合法的 JSON 数组。请严格返回 ${texts.length} 个字符串组成的 JSON 数组。`,
        temperature: 0.15,
        maxOutputTokens: Math.min(16_000, Math.max(2_000, Math.ceil(totalChars * 1.3))),
        ...(nonThinkingProviderOptions(args.config)
          ? { providerOptions: nonThinkingProviderOptions(args.config) }
          : {}),
        maxRetries: 1,
        abortSignal: args.signal,
      },
    )
    const parsed = parseJsonArray(response.text)
    if (parsed && parsed.length === texts.length) return parsed
    lastError = new Error('翻译返回的 JSON 数组长度不一致')
  }
  throw lastError instanceof Error ? lastError : new Error('翻译没有返回可用结果')
}

async function translatePlainText(
  model: ReturnType<typeof createLanguageModel>,
  args: TranslateChapterArgs,
): Promise<TranslationResult> {
  const chunks = splitTranslationChunks(args.text.slice(0, 240_000))
  const translated: string[] = []
  for (let index = 0; index < chunks.length; index++) {
    if (args.signal.aborted) throw new Error('翻译已取消')
    const [text] = await translateTexts(model, args, [chunks[index]!])
    translated.push(text ?? chunks[index]!)
    args.onProgress?.(index + 1, chunks.length)
  }
  const html = translated
    .flatMap((chunk) => chunk.split(/\n{2,}/))
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`)
    .join('')
  return { html, text: htmlToText(html) }
}

/** 翻译整章：保留标题、表格、列表和段落结构，只替换块内文字。 */
export async function translateChapter(args: TranslateChapterArgs): Promise<TranslationResult> {
  if (!args.text.trim()) throw new Error('这一章没有可翻译的正文。')
  if (!detectSourceLanguage(args.text).foreign) {
    throw new Error('这一章看起来已经是中文，不需要翻译。')
  }
  if (!args.config.apiKey && args.config.provider !== 'ollama' && args.config.provider !== 'lmstudio') {
    throw new Error('还没有配置 API Key，无法翻译原文。')
  }

  const model = createLanguageModel(args.config)
  const sourceHtml = args.html.trim() || args.text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p)}</p>`).join('')
  const { $, root, blocks } = collectBlocks(sourceHtml)
  if (blocks.length === 0) return translatePlainText(model, args)

  const batches = batchBlocks(blocks)
  let done = 0
  for (const batch of batches) {
    if (args.signal.aborted) throw new Error('翻译已取消')
    const texts = batch.map((index) => blocks[index]!.text)
    let translated: string[]
    try {
      translated = await translateTexts(model, args, texts)
    } catch {
      // 整批失败时逐段兜底，至少保住能翻译的部分和结构。
      translated = []
      for (const text of texts) {
        try {
          const [single] = await translateTexts(model, args, [text])
          translated.push(single ?? text)
        } catch {
          translated.push(text)
        }
      }
    }
    batch.forEach((blockIndex, offset) => {
      const block = blocks[blockIndex]!
      const text = translated[offset] ?? block.text
      $(block.element as never).html(renderBlockText(text, block.codes))
    })
    done += batch.length
    args.onProgress?.(done, blocks.length)
  }

  const html = root.html() ?? ''
  return { html, text: htmlToText(html) }
}
