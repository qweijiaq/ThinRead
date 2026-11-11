import * as cheerio from 'cheerio'

import type { NewChapter } from '../db.js'
import { htmlToText, sanitizeChapterHtml } from '../html.js'

const REFERENCE_HEADING = String.raw`(?:参考文献|参考书目|引用文献|文献目录|书目|注释|尾注|脚注|索引|延伸阅读|推荐阅读|进一步阅读|References?|Bibliography|Notes?|Endnotes?|Footnotes?|Index|Further\s+Reading)`

const HEADING_PATTERN = new RegExp(
  String.raw`^(?:#{1,4}\s+.+|第\s*[0-9一二三四五六七八九十百千零两]+\s*[章回卷部篇节](?:\s+.*)?|[上下中]篇(?:\s+.*)?|序言|序|前言|引言|后记|尾声|结语|附录(?:\s+.*)?|${REFERENCE_HEADING}(?:$|[与和及、\s：:].*)|Chapter\s+[0-9ivxlcdm]+(?:\s+.*)?|Part\s+[0-9ivxlcdm]+(?:\s+.*)?)$`,
  'i',
)

const REFERENCE_HEADING_PATTERN = new RegExp(String.raw`^(?:${REFERENCE_HEADING})(?:$|[与和及、\s：:].*)`, 'i')

export interface ChapterSplitOptions {
  /** 跳过参考文献、注释、索引和延伸阅读；用于导入和重新解析。 */
  skipReferences?: boolean
}

export function isReferenceHeading(text: string): boolean {
  return REFERENCE_HEADING_PATTERN.test(text.replace(/^#{1,4}\s+/, '').replace(/\s+/g, ' ').trim())
}

export function isHeading(line: string): boolean {
  const text = line.trim()
  return text.length >= 2 && text.length <= 90 && HEADING_PATTERN.test(text)
}

export function cleanHeading(line: string): string {
  return line.trim().replace(/^#{1,4}\s+/, '').trim()
}

/** 把纯文本按 Markdown/章节标题切成可阅读的章节；没有标题时保留为一章。 */
export function splitTextIntoChapters(
  text: string,
  fallbackTitle: string,
  options: ChapterSplitOptions = {},
): NewChapter[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const chapters: NewChapter[] = []
  let title = fallbackTitle.trim() || '未命名'
  let body: string[] = []
  let skippingReferences = false

  const flush = (): void => {
    const content = body.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    if (content.length < 20) return
    chapters.push({ title, text: content, html: null })
  }

  for (const line of lines) {
    const heading = isHeading(line)
    if (heading && skippingReferences) {
      // 下一个标题出现时结束参考文献区；标题本身仍按正常章节处理。
      skippingReferences = false
    }
    if (heading && options.skipReferences && isReferenceHeading(cleanHeading(line))) {
      // 不 flush：参考文献通常夹在正文中间或章末，删掉它不应把同一章切成两章。
      skippingReferences = true
      continue
    }
    if (skippingReferences) continue
    if (heading) {
      const nextTitle = cleanHeading(line)
      if (body.join('\n').trim().length >= 20) {
        flush()
        body = []
        title = nextTitle
      } else if (nextTitle) {
        body = []
        title = nextTitle
      }
      continue
    }
    body.push(line)
  }
  flush()

  if (chapters.length === 0) {
    const content = text.trim()
    if (content) chapters.push({ title: fallbackTitle.trim() || '正文', text: content, html: null })
  }
  return chapters
}

function sectionHtml($: cheerio.CheerioAPI, nodes: unknown[]): { html: string; text: string } {
  const container = $('<div></div>')
  for (const node of nodes) container.append($(node as never).clone())
  const html = container.html() ?? ''
  return { html: sanitizeChapterHtml(html), text: htmlToText(html) }
}

function headingLevel(tag: string): number | null {
  const match = /^h([1-6])$/.exec(tag)
  return match ? Number(match[1]) : null
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * 从网页/HTML 正文中切章，同时保留每章的图片和结构。
 *
 * 打印页/整书页经常把所有章节包在一个 section 或 div 里，旧的「只看顶层标题」
 * 会整本变成一章；这里递归遍历，按出现次数最多的最高标题层级切章。
 */
export function chaptersFromHtml(
  html: string,
  fallbackTitle: string,
  options: ChapterSplitOptions = {},
): NewChapter[] {
  const $ = cheerio.load(`<div id="__reading-content">${html}</div>`)
  const root = $('#__reading-content')
  root.find('script, style, noscript, svg, canvas, form, iframe').remove()

  const headingNodes = root.find('h1, h2, h3, h4').toArray()
  const headingInfo = headingNodes
    .map((node) => {
      const level = headingLevel(String((node as { tagName?: string }).tagName ?? '').toLowerCase())
      const text = $(node).text().replace(/\s+/g, ' ').trim()
      return level === null ? null : { node, level, text }
    })
    .filter((item): item is { node: (typeof headingNodes)[number]; level: number; text: string } => Boolean(item))
    .filter((item) => item.text.length >= 2 && item.text.length <= 120)

  const fallback = fallbackTitle.trim() || '未命名'
  const fallbackKey = normalizeTitle(fallback)
  let splitLevel: number | null = null
  for (const level of [1, 2, 3]) {
    const count = headingInfo.filter(
      (item) =>
        item.level === level &&
        normalizeTitle(item.text) !== fallbackKey &&
        !(options.skipReferences && isReferenceHeading(item.text)),
    ).length
    if (count >= 2) {
      splitLevel = level
      break
    }
  }

  // 记录所有包含标题的容器，遍历时只下钻这些容器，保留普通段落/列表的 HTML 结构。
  const containers = new Set<unknown>()
  for (const item of headingInfo) {
    let parent = (item.node as { parent?: unknown }).parent
    while (parent && parent !== root) {
      containers.add(parent)
      parent = (parent as { parent?: unknown }).parent
    }
  }

  const chapters: NewChapter[] = []
  let title = fallback
  let nodes: unknown[] = []
  let skippingUntil: number | null = null

  const flush = (): void => {
    if (nodes.length === 0) return
    const section = sectionHtml($, nodes)
    const hasImage = /<img\b/i.test(section.html)
    if (section.text.trim().length >= 20 || hasImage) {
      chapters.push({ title, text: section.text, html: section.html })
    }
    nodes = []
  }

  const walk = (node: unknown): void => {
    const tag = String((node as { tagName?: string }).tagName ?? '').toLowerCase()
    const level = headingLevel(tag)
    if (level !== null) {
      const heading = $(node as never).text().replace(/\s+/g, ' ').trim()
      if (skippingUntil !== null) {
        // 仍在参考文献区：只有同级或更高级标题才能结束跳过。
        if (level > skippingUntil) return
        skippingUntil = null
      }
      if (options.skipReferences && isReferenceHeading(heading)) {
        // 不 flush：参考文献前后的内容仍属于同一章，删掉中间段即可。
        skippingUntil = level
        return
      }
      if (splitLevel !== null && level === splitLevel) {
        if (heading.length > 0 && heading.length <= 120 && normalizeTitle(heading) !== fallbackKey) {
          flush()
          title = heading
          return
        }
      }
      nodes.push(node)
      return
    }
    if (skippingUntil !== null) {
      // 跳过期间仍要下钻容器，才能找到结束参考文献区的下一个同级标题。
      if (containers.has(node)) {
        for (const child of (node as { children?: unknown[] }).children ?? []) walk(child)
      }
      return
    }
    if (containers.has(node)) {
      for (const child of (node as { children?: unknown[] }).children ?? []) walk(child)
      return
    }
    nodes.push(node)
  }

  for (const node of root.contents().toArray()) walk(node)
  flush()

  if (chapters.length === 0) {
    const text = htmlToText(root.html() ?? '')
    if (text.trim().length >= 20) {
      chapters.push({ title: fallback, text, html: sanitizeChapterHtml(root.html() ?? '') })
    }
  }
  return chapters
}
