import type { NewChapter } from '../db.js'

export interface PdfPageText {
  /** 1-based page number. */
  page: number
  text: string
}

export interface PdfChapterStart {
  page: number
  title: string
  depth?: number
}

const IGNORED_OUTLINE =
  /^(封面|书名|书名页|版权|扉页|目录|contents|table\s*of\s*contents|index|索引)$/i

const HEADING_PATTERN =
  /^(?:(?:chapter|part|book|section)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b|第\s*[0-9一二三四五六七八九十百千零两]+\s*[章回卷部篇节]|(?:preface|foreword|introduction|prologue|epilogue|conclusion|afterword|appendix|acknowledg(?:e)?ments?|references?)\b)/i

const CONTENTS_PATTERN = /^(?:contents|table\s*of\s*contents|目\s*录)$/i

function cleanTitle(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/^[\s·•\-–—]+|[\s·•\-–—]+$/g, '').trim()
}

/** 从 PDF 书签生成章节；书签页重复时保留最早出现的那一条。 */
export function buildOutlineChapters(
  pages: PdfPageText[],
  outline: PdfChapterStart[],
  pageCount: number,
  minChars = 20,
  includeFrontMatter = true,
): NewChapter[] {
  const entries: PdfChapterStart[] = []
  const seenPages = new Set<number>()
  for (const entry of outline) {
    const title = cleanTitle(entry.title)
    if (!title || IGNORED_OUTLINE.test(title)) continue
    if (!Number.isFinite(entry.page) || entry.page < 1 || entry.page > pageCount) continue
    if (seenPages.has(entry.page)) continue
    seenPages.add(entry.page)
    entries.push({ page: Math.floor(entry.page), title, ...(entry.depth !== undefined ? { depth: entry.depth } : {}) })
  }
  entries.sort((a, b) => a.page - b.page || (a.depth ?? 0) - (b.depth ?? 0))
  if (entries.length === 0) return []

  const starts: PdfChapterStart[] = []
  if (includeFrontMatter && entries[0]!.page > 1) {
    const front = pages.filter((page) => page.page < entries[0]!.page)
    const frontText = front.map((page) => page.text).join('\n').replace(/\s+/g, '')
    if (frontText.length >= minChars) starts.push({ page: 1, title: '前言' })
  }
  starts.push(...entries)

  const chapters: NewChapter[] = []
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index]!
    const end = index + 1 < starts.length ? starts[index + 1]!.page - 1 : pageCount
    if (end < start.page) continue
    const text = pages
      .filter((page) => page.page >= start.page && page.page <= end)
      .map((page) => `[第 ${page.page} 页]\n${page.text}`)
      .join('\n\n')
      .trim()
    if (text.replace(/\s/g, '').length < minChars) continue
    const title =
      start.title === '前言' && index === 0
        ? `${start.title}（第 ${start.page}–${end} 页）`
        : start.title
    chapters.push({ title, text, html: null })
  }
  return chapters
}

/**
 * 没有书签时，用页面开头的 Chapter / Part / 第 N 章 识别章节。
 * 只接受页面顶部附近、足够短的标题；目录页和反复出现的页眉会被跳过。
 */
export function detectPdfChapterStarts(pages: PdfPageText[]): PdfChapterStart[] {
  const candidates: PdfChapterStart[] = []
  for (const page of pages) {
    const lines = page.text
      .split('\n')
      .map((line) => cleanTitle(line))
      .filter(Boolean)
    const head = lines.slice(0, 12)
    if (head.some((line) => CONTENTS_PATTERN.test(line))) continue
    const headingMatches = head.filter((line) => HEADING_PATTERN.test(line))
    // 目录页通常会在同一页列出多个章节标题。
    if (headingMatches.length >= 3) continue
    const heading = head.find((line) => HEADING_PATTERN.test(line))
    if (!heading) continue
    if (heading.length > 120 || /[。.!?]$/.test(heading)) continue
    candidates.push({ page: page.page, title: heading })
  }
  if (candidates.length < 2) return []

  // 页眉也会出现 "Chapter 1"，如果同一个标题在大量页面重复，就不是章节起点。
  const titleCounts = new Map<string, number>()
  for (const item of candidates) titleCounts.set(item.title, (titleCounts.get(item.title) ?? 0) + 1)
  const repeatedLimit = Math.max(2, Math.floor(pages.length * 0.3))
  const filtered = candidates.filter((item) => (titleCounts.get(item.title) ?? 0) <= repeatedLimit)
  if (filtered.length < 2) return []

  const seen = new Set<number>()
  return filtered
    .filter((item) => {
      if (seen.has(item.page)) return false
      seen.add(item.page)
      return true
    })
    .sort((a, b) => a.page - b.page)
}

/** 没有书签也没有可识别标题时的兜底：按固定页数分组。 */
export function buildPagedChapters(
  pages: PdfPageText[],
  pagesPerChapter = 10,
  minChars = 20,
): NewChapter[] {
  const chapters: NewChapter[] = []
  const size = Math.max(1, Math.floor(pagesPerChapter))
  for (let start = 0; start < pages.length; start += size) {
    const chunk = pages.slice(start, start + size)
    const first = chunk[0]!.page
    const last = chunk[chunk.length - 1]!.page
    const title = first === last ? `第 ${first} 页` : `第 ${first}–${last} 页`
    const text = chunk.map((page) => `[第 ${page.page} 页]\n${page.text}`).join('\n\n').trim()
    if (text.replace(/\s/g, '').length < minChars) continue
    chapters.push({ title, text, html: null })
  }
  return chapters
}
