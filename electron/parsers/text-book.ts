import * as cheerio from 'cheerio'

import type { NewChapter } from '../db.js'
import { htmlToText } from '../html.js'

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

/** 从网页正文 HTML 中提取文本章节：先把标题变成 Markdown 标记，再复用纯文本切分。 */
export function chaptersFromHtml(html: string, fallbackTitle: string): NewChapter[] {
  const $ = cheerio.load(html)
  $('script, style, noscript, svg, canvas, form, iframe').remove()
  $('h1, h2, h3').each((_, element) => {
    const node = $(element)
    const text = node.text().replace(/\s+/g, ' ').trim()
    if (!text || text.length > 90) return
    node.replaceWith(`\n\n## ${text}\n\n`)
  })
  const text = htmlToText($('body').html() ?? $.html())
  return splitTextIntoChapters(text, fallbackTitle)
}
