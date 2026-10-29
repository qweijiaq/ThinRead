import * as cheerio from 'cheerio'
import { generateObject } from 'ai'
import { z } from 'zod'

import type { ReaderStyle, RemovedPart } from '../../shared/types.js'
import { htmlToText, normalizeForMatch, restoreDataImages, sanitizeChapterHtml, extractDataImages } from '../html.js'
import { normalizeReaderStyle } from '../reader-style.js'
import { createLanguageModel } from './provider.js'
import type { ModelConfig } from './provider.js'

const MAX_PROMPT_CHARS = 60_000
const MAX_CONTEXT_CHARS = 20_000

const styleSchema = z.object({
  fontFamily: z.enum(['serif', 'sans']).optional(),
  fontSize: z.number().optional(),
  lineHeight: z.number().optional(),
  paragraphSpacing: z.number().optional(),
  indent: z.boolean().optional(),
})

const formatSchema = z.object({
  html: z.string(),
  removed: z
    .array(
      z.object({
        reason: z.string().max(80),
        text: z.string().max(400),
      }),
    )
    .max(50),
  style: styleSchema.optional(),
  note: z.string().max(300),
})

export interface FormatArgs {
  chapterTitle: string
  html: string
  originalText: string
  currentHtml: string | null
  currentRemoved: RemovedPart[]
  instruction?: string
  style: ReaderStyle
  config: ModelConfig
}

export interface FormatOutput {
  html: string
  removed: RemovedPart[]
  style: ReaderStyle
  note: string
}

export async function formatChapter(args: FormatArgs): Promise<FormatOutput> {
  if (args.config.provider === 'demo') {
    throw new Error('演示模式不支持 AI 排版，请先在设置里配置真实模型。')
  }
  if (!args.config.apiKey && args.config.provider !== 'ollama') {
    throw new Error('还没有配置 API Key，无法使用 AI 排版。')
  }
  if (!args.html) throw new Error('这一章没有可排版的正文。')

  const prepared = extractDataImages(args.html)
  if (prepared.html.length > MAX_PROMPT_CHARS) {
    throw new Error('这一章太长，暂时无法整体排版。可以先在「整理」里拆分章节，或换一章再试。')
  }

  const model = createLanguageModel(args.config)
  const prompt = buildPrompt(args, prepared.html)
  const response = await generateObject({
    model,
    schema: formatSchema,
    prompt,
    temperature: 0.15,
    abortSignal: AbortSignal.timeout(90_000),
  })

  const sanitized = sanitizeChapterHtml(response.object.html)
  if (!sanitized.trim()) throw new Error('AI 返回了空内容，已保留原文。')
  const withImages = restoreDataImages(sanitized, prepared.images)
  const removed = verifyRemovals(response.object.removed, args.originalText)
  verifyIntegrity(args.originalText, withImages, removed)

  return {
    html: withImages,
    removed,
    style: normalizeReaderStyle({ ...args.style, ...(response.object.style ?? {}) }),
    note: response.object.note.trim() || '已整理这一章。',
  }
}

function buildPrompt(args: FormatArgs, preparedHtml: string): string {
  const parts: string[] = [
    `你在为读书笔记应用整理一本书的正文排版。本章「${args.chapterTitle}」。`,
    `当前阅读样式（可调整）：${JSON.stringify(args.style)}`,
    '',
    '原文 HTML：',
    preparedHtml,
  ]

  if (args.currentHtml) {
    const $ = cheerio.load(args.currentHtml)
    $('img').remove()
    const context = ($('body').html() ?? '').slice(0, MAX_CONTEXT_CHARS)
    if (context.trim()) {
      parts.push('', '当前已经排版过的版本（只作参考，可以在此基础上调整）：', context)
    }
  }

  if (args.currentRemoved.length > 0) {
    parts.push('', `当前已经移除的内容：${JSON.stringify(args.currentRemoved.map((item) => item.text))}`)
  }

  if (args.instruction?.trim()) {
    parts.push('', `用户这次的指令：${args.instruction.trim()}`)
  }

  parts.push(
    '',
    '规则：',
    '1. 保留全部正文文字，不改写、不总结、不补充；只调整语义标签，并删除真正的无关内容。',
    '2. 用 h2/h3 表示标题，p 表示段落，blockquote 表示引用，ul/ol/li 表示列表。',
    '3. 删除广告、公众号/书单推广、页脚页码、水印、重复标题、乱码、空的图片占位和与正文无关的推荐。',
    '4. 每删除一处，必须在 removed 中给出逐字原文片段和原因；不要删除正文。',
    '5. 原文里的 <img data-img-id="n"> 是图片占位，保留时原样输出，不要改 id，也不要新增图片。',
    '6. 图片和图注使用 <figure><img data-img-id="n" alt="…"><figcaption>图1-4 …</figcaption></figure>；需要居中的段落用 class="center" 或 class="caption"，不要输出 style 属性。',
    '7. 如果用户给了指令，按指令调整结构或 style，但不要为了满足指令删正文。',
    '8. 只返回一个 JSON 对象，字段为 html、removed、style、note。style 可选，字段：fontFamily(serif|sans)、fontSize(14-24)、lineHeight(1.4-2.6)、paragraphSpacing(0.2-2)、indent(boolean)。不要输出 Markdown 代码块或额外解释。',
  )

  return parts.join('\n')
}

function verifyRemovals(
  removed: Array<{ reason: string; text: string }>,
  originalText: string,
): RemovedPart[] {
  const original = normalizeForMatch(originalText)
  const seen = new Set<string>()
  const result: RemovedPart[] = []

  for (const item of removed) {
    const text = item.text.trim()
    if (!text) continue
    const normalized = normalizeForMatch(text)
    if (normalized.length < 4 || seen.has(normalized)) continue
    seen.add(normalized)
    result.push({
      reason: item.reason.trim() || '无关内容',
      text,
      verified: original.includes(normalized),
    })
  }

  return result
}

function verifyIntegrity(originalText: string, newHtml: string, removed: RemovedPart[]): void {
  const original = normalizeForMatch(originalText)
  const updated = normalizeForMatch(htmlToText(newHtml))
  const verifiedRemoved = removed
    .filter((item) => item.verified)
    .map((item) => normalizeForMatch(item.text))

  const removedLength = verifiedRemoved.reduce((sum, text) => sum + text.length, 0)
  const expected = Math.max(0, original.length - Math.min(removedLength, original.length))

  if (updated.length < expected * 0.82) {
    throw new Error('AI 删除或改写了过多正文，这次结果没有应用，原文保持不变。')
  }
  if (updated.length > original.length * 1.15 + 40) {
    throw new Error('AI 增加了原文之外的内容，这次结果没有应用，原文保持不变。')
  }

  const paragraphs = originalText
    .split(/\n{2,}/)
    .map((paragraph) => normalizeForMatch(paragraph))
    .filter((paragraph) => paragraph.length >= 20)
  if (paragraphs.length === 0) return

  const missing = paragraphs.filter(
    (paragraph) =>
      !updated.includes(paragraph) &&
      !verifiedRemoved.some((snippet) => paragraph.includes(snippet) || snippet.includes(paragraph)),
  )

  if (missing.length > 3 && missing.length / paragraphs.length > 0.1) {
    throw new Error('AI 漏掉了部分正文（或没有在移除清单里说明），这次结果没有应用。')
  }
}
