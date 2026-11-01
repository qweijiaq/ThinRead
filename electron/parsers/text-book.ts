import * as cheerio from 'cheerio'

import type { NewChapter } from '../db.js'
import { htmlToText, sanitizeChapterHtml } from '../html.js'

const HEADING_PATTERN =
  /^(?:#{1,4}\s+.+|第\s*[0-9一二三四五六七八九十百千零两]+\s*[章回卷部篇节](?:\s+.*)?|[上下中]篇(?:\s+.*)?|序言|序|前言|引言|后记|尾声|结语|附录(?:\s+.*)?|Chapter\s+[0-9ivxlcdm]+(?:\s+.*)?|Part\s+[0-9ivxlcdm]+(?:\s+.*)?)$/i

function isHeading(line: string): boolean {
  const text = line.trim()
  return text.length >= 2 && text.length <= 90 && HEADING_PATTERN.test(text)
}

function cleanHeading(line: string): string {
  return line.trim().replace(/^#{1,4}\s+/, '').trim()
}

/** 把纯文本按 Markdown/章节标题切成可阅读的章节；没有标题时保留为一章。 */
export function splitTextIntoChapters(text: string, fallbackTitle: string): NewChapter[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const chapters: NewChapter[] = []
  let title = fallbackTitle.trim() || '未命名'
  let body: string[] = []

  const flush = (): void => {
    const content = body.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    if (content.length < 20) return
    chapters.push({ title, text: content, html: null })
  }

  for (const line of lines) {
    if (isHeading(line)) {
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

/** 从网页/HTML 正文中切章，同时保留每章的图片和结构。 */
export function chaptersFromHtml(html: string, fallbackTitle: string): NewChapter[] {
  const $ = cheerio.load(`<div id="__reading-content">${html}</div>`)
  const root = $('#__reading-content')
  root.find('script, style, noscript, svg, canvas, form, iframe').remove()

  const chapters: NewChapter[] = []
  let title = fallbackTitle.trim() || '未命名'
  let nodes: unknown[] = []

  const flush = (): void => {
    if (nodes.length === 0) return
    const section = sectionHtml($, nodes)
    const hasImage = /<img\b/i.test(section.html)
    if (section.text.trim().length >= 20 || hasImage) {
      chapters.push({ title, text: section.text, html: section.html })
    }
    nodes = []
  }

  for (const node of root.contents().toArray()) {
    const tag = String((node as { tagName?: string }).tagName ?? '').toLowerCase()
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      const heading = $(node).text().replace(/\s+/g, ' ').trim()
      if (!heading || heading.length > 90) {
        nodes.push(node)
        continue
      }
      const current = nodes.length > 0 ? sectionHtml($, nodes) : null
      if (current && (current.text.trim().length >= 20 || /<img\b/i.test(current.html))) flush()
      else nodes = []
      title = heading
      continue
    }
    nodes.push(node)
  }
  flush()

  if (chapters.length === 0) {
    const text = htmlToText(root.html() ?? '')
    if (text.trim().length >= 20) {
      chapters.push({ title: fallbackTitle.trim() || '正文', text, html: sanitizeChapterHtml(root.html() ?? '') })
    }
  }
  return chapters
}
