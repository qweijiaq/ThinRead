import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import type {
  BookFormat,
  BookSummary,
  HighlightImportResult,
  OcrProgress,
  TextImportInput,
} from '../shared/types.js'
import { judgeChapter, shouldAutoHideChapter } from './ai/classify.js'
import { createNote, deleteBook as deleteBookRow, getBookSummary, getChapters, insertBook } from './db.js'
import type { NewChapter } from './db.js'
import { parseDocx, parseHtmlDocument, parseMarkdownDocument } from './parsers/document.js'
import { parseEpub } from './parsers/epub.js'
import { parseMobi } from './parsers/mobi.js'
import { parsePdf } from './parsers/pdf.js'
import { parseScannedPdf } from './parsers/pdf-ocr.js'
import { groupHighlights, parseHighlightsFile } from './parsers/highlights.js'
import { chaptersFromHtml, splitTextIntoChapters } from './parsers/text-book.js'
import { parseUrl } from './parsers/url.js'

/** 导入和重新解析共用：给章节打上来源标记，并自动隐藏高置信度的非正文页。 */
export function classifyImportedChapters(
  chapters: NewChapter[],
  options: { skipToc?: boolean } = {},
): NewChapter[] {
  const classified = chapters.map((chapter) => {
    const judgment = judgeChapter(chapter, options)
    return {
      ...chapter,
      hidden: shouldAutoHideChapter(judgment.kind, judgment.confidence),
      kind: judgment.kind,
      reason: judgment.reason || null,
      classifiedBy: 'heuristic' as const,
    }
  })

  // 规则再激进，也不能把整本书都藏起来。
  if (classified.length > 0 && classified.every((chapter) => chapter.hidden)) {
    const longest = classified.reduce((best, chapter) =>
      chapter.text.length > best.text.length ? chapter : best,
    )
    longest.hidden = false
  }
  return classified
}

const TEXT_DOCUMENT_EXTENSIONS = new Set(['.docx', '.html', '.htm', '.md', '.markdown', '.txt'])
const SUPPORTED_EXTENSIONS = new Set(['.epub', '.pdf', '.mobi', '.azw3', ...TEXT_DOCUMENT_EXTENSIONS])

function parsedDocumentText(parsed: { chapters: NewChapter[] }): string {
  return parsed.chapters.map((chapter) => `# ${chapter.title}\n\n${chapter.text}`).join('\n\n')
}

export async function importBookFile(sourcePath: string, dataDir: string): Promise<BookSummary> {
  const extension = path.extname(sourcePath).toLowerCase()
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('目前支持 EPUB、PDF、MOBI、AZW3、DOCX、HTML、Markdown 和 TXT。')
  }

  const buffer = await fs.readFile(sourcePath)
  const textDocument = TEXT_DOCUMENT_EXTENSIONS.has(extension)
  let parsed: { title: string; author: string; chapters: NewChapter[] }
  let format: BookFormat = 'text'
  let storedBytes: Buffer | string = buffer

  if (extension === '.epub') {
    parsed = parseEpub(buffer, sourcePath)
    format = 'epub'
  } else if (extension === '.pdf') {
    parsed = await parsePdf(buffer, sourcePath)
    format = 'pdf'
  } else if (extension === '.mobi' || extension === '.azw3') {
    parsed = await parseMobi(buffer, sourcePath)
    format = 'mobi'
  } else if (extension === '.docx') {
    parsed = parseDocx(buffer, path.basename(sourcePath))
    storedBytes = parsedDocumentText(parsed)
  } else if (extension === '.html' || extension === '.htm') {
    parsed = parseHtmlDocument(buffer.toString('utf8'), path.basename(sourcePath))
    storedBytes = parsedDocumentText(parsed)
  } else {
    parsed = parseMarkdownDocument(buffer.toString('utf8'), path.basename(sourcePath))
    storedBytes = parsedDocumentText(parsed)
  }

  const bookId = crypto.randomUUID()
  const bookDir = path.join(dataDir, 'books', bookId)
  await fs.mkdir(bookDir, { recursive: true })
  const storedPath = path.join(bookDir, textDocument ? 'source.txt' : `source${extension}`)
  await fs.writeFile(storedPath, storedBytes)
  try {
    return await persistParsedBook(parsed, format, storedPath, bookId, dataDir)
  } catch (error) {
    await fs.rm(bookDir, { recursive: true, force: true })
    throw error
  }
}

/** 写入书籍记录；文件导入、文本导入和网页导入共用同一套存储布局。 */
async function persistParsedBook(
  parsed: { title: string; author: string; chapters: NewChapter[] },
  format: BookFormat,
  storedPath: string,
  bookId: string,
  _dataDir: string,
  classifyOptions: { skipToc?: boolean } = {},
): Promise<BookSummary> {
  return insertBook(
    { title: parsed.title.trim() || '未命名', author: parsed.author.trim(), format, filePath: storedPath },
    classifyImportedChapters(parsed.chapters, classifyOptions),
    bookId,
  )
}

export async function reparseBookFile(record: {
  format: BookFormat
  filePath: string
  title: string
  author: string
}): Promise<{ title: string; author: string; chapters: NewChapter[] }> {
  if (record.format === 'pdf-ocr') {
    const textPath = path.join(path.dirname(record.filePath), 'source-ocr.txt')
    const text = await fs.readFile(textPath, 'utf8')
    return { title: record.title, author: record.author, chapters: splitTextIntoChapters(text, record.title) }
  }
  const buffer = await fs.readFile(record.filePath)
  if (record.format === 'epub') return parseEpub(buffer, record.filePath)
  if (record.format === 'pdf') return parsePdf(buffer, record.filePath)
  if (record.format === 'mobi') return parseMobi(buffer, record.filePath)
  const text = buffer.toString('utf8')
  return {
    title: record.title,
    author: record.author,
    chapters:
      record.format === 'url'
        ? chaptersFromHtml(text, record.title)
        : splitTextIntoChapters(text, record.title),
  }
}

export async function importHighlightsFile(sourcePath: string, dataDir: string): Promise<HighlightImportResult> {
  const text = await fs.readFile(sourcePath, 'utf8')
  const entries = parseHighlightsFile(text, path.basename(sourcePath))
  if (entries.length === 0) {
    throw new Error('没有从文件里读出划线。支持 Readwise CSV 和 Kindle 的 My Clippings.txt。')
  }
  const groups = groupHighlights(entries)
  const books: BookSummary[] = []
  let highlights = 0
  for (const group of groups) {
    const bookId = crypto.randomUUID()
    const bookDir = path.join(dataDir, 'books', bookId)
    await fs.mkdir(bookDir, { recursive: true })
    const body = group.entries
      .map((entry, index) => {
        const parts = [`## 划线 ${index + 1}`]
        if (entry.location) parts.push(`位置：${entry.location}`)
        parts.push(entry.text || entry.note)
        if (entry.text && entry.note) parts.push(`笔记：${entry.note}`)
        return parts.join('\n\n')
      })
      .join('\n\n')
    const sourceText = `# ${group.title}\n\n${group.author ? `作者：${group.author}\n\n` : ''}${body}`
    const storedPath = path.join(bookDir, 'source-highlights.txt')
    await fs.writeFile(storedPath, sourceText, 'utf8')
    try {
      const book = insertBook(
        {
          title: group.title,
          author: group.author,
          format: 'text',
          filePath: storedPath,
        },
        [{ title: '划线摘录', text: body, html: null }],
        bookId,
      )
      const chapterId = getChapters(book.id)[0]?.id ?? null
      for (const entry of group.entries) {
        const content = entry.text
          ? `${entry.text}${entry.note ? `\n\n笔记：${entry.note}` : ''}`
          : entry.note
        if (!content.trim()) continue
        createNote({
          bookId: book.id,
          chapterId,
          kind: 'highlight',
          title: (entry.text || entry.note).replace(/\s+/g, ' ').trim().slice(0, 56),
          content,
          quote: entry.text || null,
          tags: entry.tags,
        })
        highlights++
      }
      const summary = getBookSummary(book.id)
      if (summary) books.push(summary)
    } catch (error) {
      deleteBookRow(bookId)
      await fs.rm(bookDir, { recursive: true, force: true })
      throw error
    }
  }
  return { books, highlights }
}

export async function importScannedPdf(
  sourcePath: string,
  dataDir: string,
  onProgress?: (progress: OcrProgress) => void,
): Promise<BookSummary> {
  const buffer = await fs.readFile(sourcePath)
  const parsed = await parseScannedPdf(sourcePath, onProgress)
  const bookId = crypto.randomUUID()
  const bookDir = path.join(dataDir, 'books', bookId)
  await fs.mkdir(bookDir, { recursive: true })
  const storedPdf = path.join(bookDir, 'source.pdf')
  const storedText = path.join(bookDir, 'source-ocr.txt')
  await fs.writeFile(storedPdf, buffer)
  await fs.writeFile(storedText, parsed.sourceText, 'utf8')
  try {
    return await persistParsedBook(parsed, 'pdf-ocr', storedPdf, bookId, dataDir, { skipToc: true })
  } catch (error) {
    await fs.rm(bookDir, { recursive: true, force: true })
    throw error
  }
}

export async function importTextBook(input: TextImportInput, dataDir: string): Promise<BookSummary> {
  const text = input.text.replace(/\r\n?/g, '\n').trim()
  if (text.length < 20) throw new Error('至少输入一段可阅读的正文。')
  const title = input.title?.trim() || '未命名文本'
  const chapters = splitTextIntoChapters(text, title)
  if (chapters.length === 0) throw new Error('没有从文本中读出可阅读的章节。')
  const parsed = { title, author: input.author?.trim() ?? '', chapters }
  const bookId = crypto.randomUUID()
  const bookDir = path.join(dataDir, 'books', bookId)
  await fs.mkdir(bookDir, { recursive: true })
  const storedPath = path.join(bookDir, 'source.txt')
  await fs.writeFile(storedPath, text, 'utf8')
  try {
    return await persistParsedBook(parsed, 'text', storedPath, bookId, dataDir)
  } catch (error) {
    await fs.rm(bookDir, { recursive: true, force: true })
    throw error
  }
}

export async function importUrlBook(rawUrl: string, dataDir: string): Promise<BookSummary> {
  const parsed = await parseUrl(rawUrl)
  const bookId = crypto.randomUUID()
  const bookDir = path.join(dataDir, 'books', bookId)
  await fs.mkdir(bookDir, { recursive: true })
  const storedPath = path.join(bookDir, 'source.html')
  await fs.writeFile(storedPath, parsed.html, 'utf8')
  try {
    return await persistParsedBook(
      { title: parsed.title, author: parsed.author, chapters: parsed.chapters },
      'url',
      storedPath,
      bookId,
      dataDir,
    )
  } catch (error) {
    await fs.rm(bookDir, { recursive: true, force: true })
    throw error
  }
}
