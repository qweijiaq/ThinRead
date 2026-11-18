import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {
  BookFormat,
  BookSummary,
  HighlightImportResult,
  ImportBookOptions,
  OcrImportOptions,
  OcrProgress,
  TextImportInput,
} from '../shared/types.js'
import { judgeChapter, shouldAutoHideChapter } from './ai/classify.js'
import { appendChapter, createNote, deleteBook as deleteBookRow, getBookSummary, getChapters, insertBook, listBooks } from './db.js'
import type { NewChapter } from './db.js'
import { parseDocx, parseHtmlDocument, parseMarkdownDocument } from './parsers/document.js'
import { parseEpub } from './parsers/epub.js'
import { parseMobi } from './parsers/mobi.js'
import { parsePdf, readPdfOutlineFile } from './parsers/pdf.js'
import { parsePdfWithDocling, type DoclingProgress } from './parsers/docling.js'
import { parsePdfWithVision } from './parsers/pdf-vision.js'
import { extractPdfCover } from './parsers/pdf-cover.js'
import { parseScannedPdf } from './parsers/pdf-ocr.js'
import { getActiveSettings } from './settings.js'
import { groupHighlights, parseHighlightsFile } from './parsers/highlights.js'
import type { HighlightEntry } from './parsers/highlights.js'
import { chaptersFromHtml, isReferenceHeading, splitTextIntoChapters } from './parsers/text-book.js'
import { stripReferencesFromChapters } from './references.js'
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

function withoutReferenceChapters(
  chapters: NewChapter[],
  options: ImportBookOptions,
): NewChapter[] {
  if (!options.skipReferences) return chapters
  const filtered = chapters.filter((chapter) => !isReferenceHeading(chapter.title))
  return filtered.length > 0 ? filtered : chapters
}

export async function importBookFile(
  sourcePath: string,
  dataDir: string,
  options: ImportBookOptions = {},
  onDoclingProgress?: (progress: DoclingProgress) => void,
  signal?: AbortSignal,
): Promise<BookSummary> {
  const extension = path.extname(sourcePath).toLowerCase()
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('目前支持 EPUB、PDF、MOBI、AZW3、DOCX、HTML、Markdown 和 TXT。')
  }

  const buffer = await fs.readFile(sourcePath)
  const textDocument = TEXT_DOCUMENT_EXTENSIONS.has(extension)
  let parsed: { title: string; author: string; chapters: NewChapter[]; structured?: Array<{ page: number; kind: 'table' | 'formula'; text: string }> }
  let format: BookFormat = 'text'
  let storedBytes: Buffer | string = buffer

  if (extension === '.epub') {
    parsed = parseEpub(buffer, sourcePath)
    format = 'epub'
  } else if (extension === '.pdf') {
    if (options.visionPdf) {
      parsed = await parsePdfWithVision({
        buffer,
        sourcePath,
        config: getActiveSettings('notes'),
        maintainFormat: options.visionPdfMaintainFormat === true,
        pages: options.visionPdfPages,
        dataDir,
        extractStructure: options.visionPdfStructure !== false,
        signal,
        onProgress: (done, total) => onDoclingProgress?.({ phase: 'pages', done, total }),
      })
    } else if (options.deepPdf) {
      const info = await readPdfOutlineFile(sourcePath)
      parsed = await parsePdfWithDocling({
        sourcePath,
        dataDir,
        outline: info.outline,
        title: info.title,
        author: info.author,
        onProgress: onDoclingProgress,
      })
    } else {
      const imageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'thinread-pdf-pages-'))
      try {
        parsed = await parsePdf(buffer, sourcePath, { imageDir })
      } finally {
        await fs.rm(imageDir, { recursive: true, force: true }).catch(() => undefined)
      }
    }
    format = 'pdf'
  } else if (extension === '.mobi' || extension === '.azw3') {
    parsed = await parseMobi(buffer, sourcePath)
    format = 'mobi'
  } else if (extension === '.docx') {
    parsed = parseDocx(buffer, path.basename(sourcePath), options)
    storedBytes = parsedDocumentText(parsed)
  } else if (extension === '.html' || extension === '.htm') {
    parsed = parseHtmlDocument(buffer.toString('utf8'), path.basename(sourcePath), options)
    storedBytes = parsedDocumentText(parsed)
  } else {
    parsed = parseMarkdownDocument(buffer.toString('utf8'), path.basename(sourcePath), options)
    storedBytes = parsedDocumentText(parsed)
  }
  if (options.skipReferences) parsed.chapters = stripReferencesFromChapters(parsed.chapters)
  parsed.chapters = withoutReferenceChapters(parsed.chapters, options)

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
  parsed: {
    title: string
    author: string
    chapters: NewChapter[]
    cover?: { data: Uint8Array; extension: string }
  },
  format: BookFormat,
  storedPath: string,
  bookId: string,
  _dataDir: string,
  classifyOptions: { skipToc?: boolean } = {},
): Promise<BookSummary> {
  let coverPath: string | null = null
  const cover =
    parsed.cover ??
    (format === 'pdf' || format === 'pdf-ocr' ? await extractPdfCover(storedPath) : null)
  if (cover) {
    try {
      coverPath = path.join(path.dirname(storedPath), `cover${cover.extension}`)
      await fs.writeFile(coverPath, cover.data)
    } catch {
      coverPath = null
    }
  }
  return insertBook(
    {
      title: parsed.title.trim() || '未命名',
      author: parsed.author.trim(),
      format,
      filePath: storedPath,
      coverPath,
    },
    classifyImportedChapters(parsed.chapters, classifyOptions),
    bookId,
  )
}

export async function reparseBookFile(
  record: {
    format: BookFormat
    filePath: string
    title: string
    author: string
  },
  dataDir: string,
  options: ImportBookOptions = {},
  onDoclingProgress?: (progress: DoclingProgress) => void,
): Promise<{ title: string; author: string; chapters: NewChapter[] }> {
  const finish = (parsed: { title: string; author: string; chapters: NewChapter[] }) => ({
    ...parsed,
    chapters: options.skipReferences
      ? withoutReferenceChapters(stripReferencesFromChapters(parsed.chapters), options)
      : parsed.chapters,
  })

  if (record.format === 'pdf-ocr') {
    const textPath = path.join(path.dirname(record.filePath), 'source-ocr.txt')
    const text = await fs.readFile(textPath, 'utf8')
    return finish({
      title: record.title,
      author: record.author,
      chapters: splitTextIntoChapters(text, record.title, { skipReferences: options.skipReferences === true }),
    })
  }
  const buffer = await fs.readFile(record.filePath)
  if (record.format === 'epub') return finish(parseEpub(buffer, record.filePath))
  if (record.format === 'pdf') {
    if (options.visionPdf) {
      return finish(
        await parsePdfWithVision({
          buffer,
          sourcePath: record.filePath,
          config: getActiveSettings('notes'),
          maintainFormat: options.visionPdfMaintainFormat === true,
          pages: options.visionPdfPages,
          dataDir,
          extractStructure: options.visionPdfStructure !== false,
          onProgress: (done, total) => onDoclingProgress?.({ phase: 'pages', done, total }),
        }),
      )
    }
    if (options.deepPdf) {
      const info = await readPdfOutlineFile(record.filePath)
      return finish(
        await parsePdfWithDocling({
          sourcePath: record.filePath,
          dataDir,
          outline: info.outline,
          title: info.title,
          author: info.author,
          onProgress: onDoclingProgress,
        }),
      )
    }
    const imageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'thinread-pdf-pages-'))
    try {
      return finish(await parsePdf(buffer, record.filePath, { imageDir }))
    } finally {
      await fs.rm(imageDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  if (record.format === 'mobi') return finish(await parseMobi(buffer, record.filePath))
  const text = buffer.toString('utf8')
  return finish({
    title: record.title,
    author: record.author,
    chapters:
      record.format === 'url'
        ? chaptersFromHtml(text, record.title, { skipReferences: options.skipReferences === true })
        : splitTextIntoChapters(text, record.title, { skipReferences: options.skipReferences === true }),
  })
}

export async function importHighlightEntries(
  entries: HighlightEntry[],
  dataDir: string,
  options: { mergeExisting?: boolean } = {},
): Promise<HighlightImportResult> {
  if (entries.length === 0) throw new Error('没有从文件里读出划线。')
  const groups = groupHighlights(entries)
  const books: BookSummary[] = []
  let highlights = 0
  const existingBooks = options.mergeExisting ? listBooks() : []
  const titleKey = (value: string): string =>
    value.toLowerCase().replace(/\s+/g, '').replace(/[“”"'‘’「」『』（）()【】\[\]…—–\-·、，,。.；;：:！!？?《》<>]/g, '')
  const findExisting = (title: string, author: string): BookSummary | null => {
    const wanted = titleKey(title)
    const candidates = existingBooks.filter((book) => titleKey(book.title) === wanted)
    if (candidates.length === 0) return null
    if (!author.trim()) return candidates[0] ?? null
    const wantedAuthor = titleKey(author)
    return candidates.find((book) => titleKey(book.author) === wantedAuthor) ?? null
  }

  const addNotes = (bookId: string, chapterId: string | null, groupEntries: typeof entries): number => {
    let added = 0
    for (const entry of groupEntries) {
      const content = entry.text
        ? `${entry.text}${entry.note ? `\n\n笔记：${entry.note}` : ''}`
        : entry.note
      if (!content.trim()) continue
      createNote({
        bookId,
        chapterId,
        kind: 'highlight',
        title: (entry.text || entry.note).replace(/\s+/g, ' ').trim().slice(0, 56),
        content,
        quote: entry.text || null,
        tags: entry.tags,
      })
      added++
    }
    return added
  }

  const bodyFor = (group: (typeof groups)[number]): string =>
    group.entries
      .map((entry, index) => {
        const parts = [`## 划线 ${index + 1}`]
        if (entry.location) parts.push(`位置：${entry.location}`)
        parts.push(entry.text || entry.note)
        if (entry.text && entry.note) parts.push(`笔记：${entry.note}`)
        return parts.join('\n\n')
      })
      .join('\n\n')

  for (const group of groups) {
    const body = bodyFor(group)
    const existing = findExisting(group.title, group.author)
    if (existing) {
      try {
        const chapterId = appendChapter(existing.id, { title: '划线摘录', text: body, html: null })
        highlights += addNotes(existing.id, chapterId, group.entries)
        const summary = getBookSummary(existing.id)
        if (summary) books.push(summary)
      } catch (error) {
        throw error
      }
      continue
    }

    const bookId = crypto.randomUUID()
    const bookDir = path.join(dataDir, 'books', bookId)
    await fs.mkdir(bookDir, { recursive: true })
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
      highlights += addNotes(book.id, chapterId, group.entries)
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

export async function importHighlightsFile(
  sourcePath: string,
  dataDir: string,
  options: { mergeExisting?: boolean } = {},
): Promise<HighlightImportResult> {
  const text = await fs.readFile(sourcePath, 'utf8')
  const entries = parseHighlightsFile(text, path.basename(sourcePath))
  if (entries.length === 0) {
    throw new Error('没有从文件里读出划线。支持 Readwise CSV 和 Kindle 的 My Clippings.txt。')
  }
  return importHighlightEntries(entries, dataDir, options)
}

export async function importScannedPdf(
  sourcePath: string,
  dataDir: string,
  onProgress?: (progress: OcrProgress) => void,
  signal?: AbortSignal,
  options: OcrImportOptions = {},
): Promise<BookSummary> {
  const buffer = await fs.readFile(sourcePath)
  const parsed = await parseScannedPdf(sourcePath, onProgress, signal, options)
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
  const splitChapters = splitTextIntoChapters(text, title, { skipReferences: input.skipReferences === true })
  const chapters = withoutReferenceChapters(
    input.skipReferences ? stripReferencesFromChapters(splitChapters) : splitChapters,
    input,
  )
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

export async function importUrlBook(
  rawUrl: string,
  dataDir: string,
  options: ImportBookOptions = {},
): Promise<BookSummary> {
  const parsed = await parseUrl(rawUrl, { skipReferences: options.skipReferences === true })
  const bookId = crypto.randomUUID()
  const bookDir = path.join(dataDir, 'books', bookId)
  await fs.mkdir(bookDir, { recursive: true })
  const storedPath = path.join(bookDir, 'source.html')
  await fs.writeFile(storedPath, parsed.html, 'utf8')
  try {
    return await persistParsedBook(
      {
        title: parsed.title,
        author: parsed.author,
        chapters: withoutReferenceChapters(
          options.skipReferences ? stripReferencesFromChapters(parsed.chapters) : parsed.chapters,
          options,
        ),
      },
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
