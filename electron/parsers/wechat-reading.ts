import type { HighlightEntry } from './highlights.js'

const DEFAULT_TITLE = '微信读书笔记'

const TITLE_WITH_AUTHOR = /^《(.+?)》\s*(?:作者|author)\s*[:：]\s*(.+)$/i
const TITLE_BRACKETS = /^《(.+?)》$/
const TITLE_LINE = /^(?:书名|title)\s*[:：]\s*(.+)$/i
const AUTHOR_LINE = /^(?:作者|著者|author)\s*[:：]\s*(.+)$/i
const NOTE_LINE = /^(?:想法|笔记|点评|评论|批注|note|thoughts?)\s*[:：]\s*(.*)$/i
const HIGHLIGHT_PREFIX = /^(?:原文|划线|摘录|高亮|highlight|quote)\s*[:：]\s*/i
const MD_HEADING = /^#{1,6}\s+(.+)$/
const MARKER_HEADING = /^[◆◇]\s*(.+)$/
const BRACKET_HEADING = /^【(.+?)】$/
const CN_CHAPTER = /^第\s*[一二三四五六七八九十百千零两0-9０-９]+\s*[章节回部卷篇]/
const CN_SECTION = /^[一二三四五六七八九十]+、/
const SPECIAL_HEADING = /^(?:序言?|自序|前言|引言|导言|后记|尾声|结语|附录|致谢|译后记)(?:\s*[:：].*)?$/
const EN_CHAPTER = /^(?:chapter|part|section)\s+[\divxlc]/i
const UI_LINE = /^(?:微信读书(?:笔记|摘录)?|导出时间|阅读时间|阅读时长|阅读进度|笔记数|书评数)/
const DATE_ONLY = /^[\d\s年月日:：/\-.,，]+$/
const HTML_HINT = /<(?:!doctype|html|body|head|p|div|span|h[1-6]|br|section|article|li|blockquote|table|tr|td)\b/i

const BLOCK_END =
  /<\/(?:p|div|section|article|blockquote|li|ul|ol|h[1-6]|tr|td|th|table|header|footer|main|figure|figcaption)\s*>/gi

function decodeCodePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return ''
  return String.fromCodePoint(value)
}

/** 去掉标签但保留块级边界，让 HTML 导出和纯文本导出走同一套解析。 */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    // HTML 的标题标签没有固定文案，转成微信读书常用的 ◆ 标记后仍能识别为章节。
    .replace(
      /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi,
      (_match, content: string) => `\n◆ ${content.replace(/<[^>]+>/g, '').trim()}\n`,
    )
    .replace(BLOCK_END, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => decodeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => decodeCodePoint(Number.parseInt(dec, 10)))
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

function cleanTitle(value: string): string {
  return value.trim().replace(/^《(.+)》$/, '$1').trim()
}

function normalizeSpace(value: string): string {
  return value.replace(/[\s　]+/g, ' ').trim()
}

function headingText(line: string): string {
  const hash = line.match(MD_HEADING)
  if (hash) return (hash[1] ?? '').trim()
  const marker = line.match(MARKER_HEADING)
  if (marker) return (marker[1] ?? '').trim()
  const bracket = line.match(BRACKET_HEADING)
  if (bracket) return (bracket[1] ?? '').trim()
  if (CN_CHAPTER.test(line) || CN_SECTION.test(line) || EN_CHAPTER.test(line) || SPECIAL_HEADING.test(line)) {
    return line
  }
  return ''
}

/**
 * 微信读书没有官方导出 API，这里兼容「复制笔记」和 HTML 导出两种常见文本形态。
 * 书名、作者是全书共用元信息；章节标题写入 location，方便导入后回溯。
 */
export function parseWechatReadingNotes(input: string, fallbackTitle = DEFAULT_TITLE): HighlightEntry[] {
  const source = HTML_HINT.test(input) ? stripHtmlToText(input) : input
  const lines = source.replace(/^\ufeff/, '').replace(/\u200b/g, '').replace(/\r\n?/g, '\n').split('\n')

  const entries: HighlightEntry[] = []
  let title = ''
  let author = ''
  let section = ''
  let textLines: string[] = []
  let noteLines: string[] = []
  let noteStarted = false
  let noteWantsContinuation = false
  let pendingBlank = false

  const flush = (): void => {
    const text = normalizeSpace(textLines.join(' '))
    const note = normalizeSpace(noteLines.join(' '))
    textLines = []
    noteLines = []
    noteStarted = false
    noteWantsContinuation = false
    if (!text && !note) return
    entries.push({
      title: title || fallbackTitle,
      author,
      text,
      note,
      tags: [],
      location: section,
      url: '',
    })
  }

  for (const rawLine of lines) {
    const line = rawLine.trim().replace(/^>\s*/, '').trim()
    if (!line) {
      pendingBlank = true
      continue
    }
    if (UI_LINE.test(line) || DATE_ONLY.test(line)) continue

    const combined = line.match(TITLE_WITH_AUTHOR)
    if (combined) {
      flush()
      if (!title) title = cleanTitle(combined[1] ?? '')
      if (!author) author = (combined[2] ?? '').trim()
      continue
    }
    const bracketTitle = line.match(TITLE_BRACKETS)
    if (bracketTitle) {
      flush()
      if (!title) title = cleanTitle(bracketTitle[1] ?? '')
      continue
    }
    const explicitTitle = line.match(TITLE_LINE)
    if (explicitTitle) {
      flush()
      if (!title) title = cleanTitle(explicitTitle[1] ?? '')
      continue
    }
    const authorLine = line.match(AUTHOR_LINE)
    if (authorLine) {
      flush()
      if (!author) author = (authorLine[1] ?? '').trim()
      continue
    }

    const note = line.match(NOTE_LINE)
    if (note) {
      pendingBlank = false
      noteStarted = true
      const content = (note[1] ?? '').trim()
      if (content) noteLines.push(content)
      else noteWantsContinuation = true
      continue
    }

    const heading = headingText(line)
    if (heading) {
      flush()
      pendingBlank = false
      section = heading
      continue
    }

    // 「想法：」后面单独换行的内容继续算进上一条笔记。
    if (noteWantsContinuation) {
      noteLines.push(line)
      noteWantsContinuation = false
      pendingBlank = false
      continue
    }
    if (pendingBlank) {
      flush()
      pendingBlank = false
    }
    if (noteStarted) flush()

    const text = line.replace(HIGHLIGHT_PREFIX, '').replace(/^[·•●○▸►▶■□▪]\s+/, '').trim()
    if (text) textLines.push(text)
  }
  flush()

  // 书名/作者可能出现在划线之后，统一回填到本书的所有条目。
  if (title) for (const entry of entries) entry.title = title
  if (author) for (const entry of entries) if (!entry.author) entry.author = author

  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = `${entry.title}\u0000${entry.author}\u0000${entry.text}\u0000${entry.note}\u0000${entry.location}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
