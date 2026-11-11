import { createHash } from 'node:crypto'

import * as cheerio from 'cheerio'

import type { ModelConfig } from './ai/provider.js'
import { createLanguageModel, nonThinkingProviderOptions } from './ai/provider.js'
import { tracedGenerateText } from './ai/trace.js'
import { getChapter } from './db.js'

export interface UnderstandImageResult {
  html: string
  understood: number
  skipped: number
}

function dataUrlParts(value: string): { mediaType: string; base64: string } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(value.trim())
  if (!match) return null
  return { mediaType: match[1]!.toLowerCase(), base64: match[2]! }
}

function imageKey(src: string): string {
  return createHash('sha256').update(src).digest('hex').slice(0, 16)
}

function nearbyText(image: cheerio.Cheerio<any>): string {
  const caption = image.closest('figure').find('figcaption').first().text().trim()
  const before = image
    .closest('figure')
    .prevAll('p, blockquote, li')
    .first()
    .text()
    .trim()
  return [caption, before].filter(Boolean).join('\n').slice(0, 800)
}

async function describeImage(args: {
  config: ModelConfig
  demo: boolean
  image: string
  alt: string
  caption: string
  context: string
  chapterTitle: string
  bookTitle: string
  signal?: AbortSignal
}): Promise<string> {
  if (args.demo) {
    throw new Error('演示模式不支持图片理解，请先在设置里配置真实视觉模型。')
  }
  const parts = dataUrlParts(args.image)
  if (!parts) throw new Error('这张图片不是可发送的本地图片。')
  const model = createLanguageModel(args.config)
  const prompt = [
    `书名《${args.bookTitle}》，章节「${args.chapterTitle}」。`,
    args.caption ? `图注：${args.caption}` : '',
    args.alt ? `alt：${args.alt}` : '',
    args.context ? `图片附近正文：${args.context}` : '',
    '请理解这张图片，用简体中文写 2–6 句可以直接放进正文的说明。',
    '如果是图表，先给结论，再说明坐标、趋势或关键数据；如果是流程图，说明步骤和关系；如果是照片或插图，只描述与正文有关的内容。',
    '只写你能从图片中确认的信息，不要编造，不要输出标题、Markdown 列表或“这张图显示了”这类套话。',
  ]
    .filter(Boolean)
    .join('\n\n')
  const providerOptions = nonThinkingProviderOptions(args.config)
  const response = await tracedGenerateText(
    {
      step: 'image-understanding',
      scope: args.chapterTitle,
      provider: args.config.provider,
      model: args.config.model,
      promptVersion: 'image-understanding-v1',
      timeoutMs: 120_000,
    },
    {
      model,
      system: '你是读书笔记应用的图片理解助手，负责把书里的图表和插图解释成可以直接阅读的正文。',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', image: parts.base64, mediaType: parts.mediaType },
          ],
        },
      ],
      temperature: 0.2,
      maxOutputTokens: 800,
      ...(providerOptions ? { providerOptions } : {}),
      maxRetries: 1,
      abortSignal: args.signal,
    },
  )
  const text = response.text.replace(/^```[\s\S]*?\n|```$/g, '').trim()
  if (!text) throw new Error('模型没有返回图片说明。')
  return text.slice(0, 2_000)
}

/** 把一段图片说明插到对应图片后面；已经理解过的图片会跳过。 */
export function insertImageUnderstanding(
  source: string,
  imageSrc: string,
  text: string,
): UnderstandImageResult {
  const $ = cheerio.load(`<div id="__image_understanding_root">${source}</div>`)
  const root = $('#__image_understanding_root')
  const target = root
    .find('img')
    .filter((_, element) => ($(element).attr('src') ?? '') === imageSrc)
    .first()
  if (target.length === 0) throw new Error('找不到这张图片，可能已经被重新排版。')
  if (target.attr('data-image-understood') === '1') {
    return { html: source, understood: 0, skipped: 1 }
  }
  const anchor = target.closest('figure').length > 0 ? target.closest('figure') : target
  const block = $('<aside class="image-understanding"></aside>')
  block.attr('data-image-understanding', imageKey(imageSrc))
  block.append($('<div class="image-understanding-label"></div>').text('图片理解'))
  for (const paragraph of text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)) {
    block.append($('<p></p>').text(paragraph))
  }
  target.attr('data-image-understood', '1')
  anchor.after(block)
  return { html: root.html() ?? source, understood: 1, skipped: 0 }
}

/** 理解章节里的一张图片，并把说明作为正文块插到图片后面。 */
export async function understandImageInChapter(args: {
  chapterId: string
  imageSrc: string
  config: ModelConfig
  demo: boolean
  bookTitle: string
  signal?: AbortSignal
}): Promise<UnderstandImageResult> {
  const chapter = getChapter(args.chapterId)
  const source = chapter.formattedHtml ?? chapter.html ?? ''
  if (!source.trim()) throw new Error('这一章没有可理解的图片。')
  const $ = cheerio.load(`<div id="__image_understanding_root">${source}</div>`)
  const root = $('#__image_understanding_root')
  const target = root
    .find('img')
    .filter((_, element) => ($(element).attr('src') ?? '') === args.imageSrc)
    .first()
  if (target.length === 0) throw new Error('找不到这张图片，可能已经被重新排版。')
  if (target.attr('data-image-understood') === '1') {
    return { html: source, understood: 0, skipped: 1 }
  }
  const src = target.attr('src') ?? ''
  const alt = target.attr('alt') ?? ''
  const caption = target.closest('figure').find('figcaption').first().text().trim()
  const context = nearbyText(target)
  const text = await describeImage({
    config: args.config,
    demo: args.demo,
    image: src,
    alt,
    caption,
    context,
    chapterTitle: chapter.title,
    bookTitle: args.bookTitle,
    signal: args.signal,
  })
  return insertImageUnderstanding(source, args.imageSrc, text)
}
