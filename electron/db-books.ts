import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import type {
  BookFormat,
  BookGenre,
  BookShelfStatus,
  BookSummary,
  BookTranslationInfo,
  ChapterContent,
  ChapterFlag,
  ChapterFlagSource,
  ChapterKind,
  ChapterMeta,
  ReaderStyle,
  RemovedPart,
  TrashedBook,
  TrashedChapter,
} from '../shared/types.js'
import { detectBookLanguage } from './book-language.js'
import { htmlToText } from './html.js'
import { pruneArtifactVersions } from './db-content.js'
import { parseNoteReport } from './db-notes.js'
import { getDatabase } from './database.js'
import { normalizeReaderStyle, parseStyleJson } from './reader-style.js'

const database = getDatabase

export interface NewBook {
  title: string
  author: string
  format: BookFormat
  filePath: string
  coverPath?: string | null
}

export interface BookRecord {
  id: string
  title: string
  author: string
  format: BookFormat
  filePath: string
}

export interface NewChapter {
  title: string
  text: string
  html: string | null
  hidden?: boolean
  kind?: ChapterKind
  reason?: string | null
  classifiedBy?: ChapterFlagSource | null
  partTitle?: string | null
  partIndex?: number | null
  isPart?: boolean
}

interface BookRow {
  id: string
  title: string
  author: string
  format: string
  genre: string
  cover_path: string | null
  file_path: string
  created_at: string
  last_opened_at: string | null
  current_chapter_id: string | null
  chapter_count: number
  hidden_chapter_count: number
  read_count: number | null
  note_count: number
  total_chars: number
  read_chars: number | null
  current_chapter_idx: number | null
  shelf_status?: string | null
}

interface ChapterRow {
  id: string
  book_id: string
  idx: number
  title: string
  text: string
  html: string | null
  chars: number
  hidden: number
  kind: string
  reason: string | null
  classified_by: string | null
  part_title: string | null
  part_index: number | null
  is_part: number
  formatted_html: string | null
  format_removed: string | null
  format_updated_at: string | null
  note_report: string | null
  translated_text: string | null
  translated_html: string | null
  translated_at: string | null
}

interface ChapterMarkRow {
  id: string
  book_id: string
  chapter_id: string
  quote: string
  style: string
  created_at: string
}

interface ChapterBookmarkRow {
  id: string
  book_id: string
  chapter_id: string
  scroll_ratio: number
  scroll_top: number
  page: number | null
  label: string
  quote: string | null
  created_at: string
}

interface ChapterPositionRow {
  chapter_id: string
  book_id: string
  scroll_ratio: number
  scroll_top: number
  page: number | null
  updated_at: string
}

interface ChapterTrashPayload {
  chapter: ChapterRow
  notes: NoteRow[]
  marks: ChapterMarkRow[]
  bookmarks: ChapterBookmarkRow[]
  position: ChapterPositionRow | null
}

interface NoteRow {
  id: string
  book_id: string
  chapter_id: string | null
  kind: string
  title: string
  content: string
  quote: string | null
  quote_verified: number
  author: string
  edited: number
  tags: string
  section: string | null
  importance: number | null
  role: string | null
  color: string | null
  expansion: string | null
  created_at: string
  updated_at: string
}

export function insertBook(book: NewBook, chapters: NewChapter[], bookId: string = crypto.randomUUID()): BookSummary {
  const conn = database()
  const now = new Date().toISOString()
  conn.exec('BEGIN IMMEDIATE')
  try {
    conn
      .prepare(
        "INSERT INTO books (id, title, author, format, file_path, cover_path, created_at, last_opened_at, shelf_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'inbox')",
      )
      .run(bookId, book.title, book.author, book.format, book.filePath, book.coverPath ?? null, now, now)
    const insertChapter = conn.prepare(
      'INSERT INTO chapters (id, book_id, idx, title, text, html, chars, hidden, kind, reason, classified_by, part_title, part_index, is_part) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    chapters.forEach((chapter, index) => {
      insertChapter.run(
        crypto.randomUUID(),
        bookId,
        index,
        chapter.title,
        chapter.text,
        chapter.html,
        chapter.text.length,
        chapter.hidden ? 1 : 0,
        chapter.kind ?? 'content',
        chapter.reason ?? null,
        chapter.classifiedBy ?? null,
        chapter.partTitle ?? null,
        chapter.partIndex ?? null,
        chapter.isPart ? 1 : 0,
      )
    })
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
  const summary = getBookSummary(bookId)
  if (!summary) throw new Error('书籍写入失败')
  return summary
}

/** 把多本书的章节和笔记并入第一本书；源书随后删除。 */
export function updateBookSource(bookId: string, filePath: string, format: BookFormat): void {
  database().prepare('UPDATE books SET file_path = ?, format = ? WHERE id = ?').run(filePath, format, bookId)
}

export function mergeBooks(
  bookIds: string[],
  title: string,
  author: string,
  mergedFilePath?: string,
): BookSummary {
  const ids = [...new Set(bookIds.filter(Boolean))]
  if (ids.length < 2) throw new Error('至少选择两本书才能合并。')
  const conn = database()
  const target = getBookSummary(ids[0]!)
  if (!target) throw new Error('找不到要合并的书。')
  const now = new Date().toISOString()
  conn.exec('BEGIN IMMEDIATE')
  try {
    let nextIdx =
      (conn.prepare('SELECT COALESCE(MAX(idx), -1) AS max_idx FROM chapters WHERE book_id = ?').get(target.id) as { max_idx: number })
        .max_idx + 1
    for (const sourceId of ids.slice(1)) {
      if (!getBookSummary(sourceId)) continue
      const chapters = conn
        .prepare('SELECT id FROM chapters WHERE book_id = ? ORDER BY idx')
        .all(sourceId) as unknown as Array<{ id: string }>
      for (const chapter of chapters) {
        conn.prepare('UPDATE chapters SET book_id = ?, idx = ? WHERE id = ?').run(target.id, nextIdx++, chapter.id)
        conn.prepare('UPDATE notes SET book_id = ? WHERE chapter_id = ?').run(target.id, chapter.id)
      }
      conn.prepare('UPDATE notes SET book_id = ? WHERE book_id = ?').run(target.id, sourceId)
      conn.prepare('UPDATE note_trash SET book_id = ? WHERE book_id = ?').run(target.id, sourceId)
      conn.prepare('UPDATE chapter_trash SET book_id = ? WHERE book_id = ?').run(target.id, sourceId)
      conn.prepare('DELETE FROM books WHERE id = ?').run(sourceId)
    }
    conn
      .prepare('UPDATE books SET title = ?, author = ?, last_opened_at = ? WHERE id = ?')
      .run(cleanTitle(title || target.title, '书名'), author.trim() || target.author, now, target.id)
    if (mergedFilePath) conn.prepare("UPDATE books SET file_path = ?, format = 'text' WHERE id = ?").run(mergedFilePath, target.id)
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
  const merged = getBookSummary(target.id)
  if (!merged) throw new Error('合并失败。')
  return merged
}

/** 把从某一章开始的章节移到一本新书；原书保留前面的章节。 */
export function splitBook(
  bookId: string,
  fromChapterId: string,
  title: string,
  filePath: string,
  newBookId: string = crypto.randomUUID(),
  sourceFilePath?: string,
): BookSummary {
  const conn = database()
  const source = getBookSummary(bookId)
  if (!source) throw new Error('找不到这本书。')
  const chapters = getChapters(bookId)
  const splitIndex = chapters.findIndex((chapter) => chapter.id === fromChapterId)
  if (splitIndex <= 0 || splitIndex >= chapters.length) {
    throw new Error('请选择书中间的章节作为拆分点，拆分后两边都要有内容。')
  }
  const moved = chapters.slice(splitIndex)
  const now = new Date().toISOString()
  conn.exec('BEGIN IMMEDIATE')
  try {
    conn
      .prepare(
        'INSERT INTO books (id, title, author, format, file_path, created_at, last_opened_at, current_chapter_id, style_json) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)',
      )
      .run(newBookId, cleanTitle(title || `${source.title} · 下篇`, '书名'), source.author, 'text', filePath, now)
    moved.forEach((chapter, index) => {
      conn.prepare('UPDATE chapters SET book_id = ?, idx = ? WHERE id = ?').run(newBookId, index, chapter.id)
      conn.prepare('UPDATE notes SET book_id = ? WHERE chapter_id = ?').run(newBookId, chapter.id)
      conn.prepare('UPDATE note_trash SET book_id = ? WHERE chapter_id = ?').run(newBookId, chapter.id)
      conn.prepare('UPDATE chapter_trash SET book_id = ? WHERE id = ?').run(newBookId, chapter.id)
    })
    conn
      .prepare('UPDATE books SET current_chapter_id = NULL, last_opened_at = ? WHERE id = ?')
      .run(now, bookId)
    if (sourceFilePath) conn.prepare("UPDATE books SET file_path = ?, format = 'text' WHERE id = ?").run(sourceFilePath, bookId)
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
  const split = getBookSummary(newBookId)
  if (!split) throw new Error('拆分失败。')
  return split
}

const BOOK_SELECT = `WITH chapter_stats AS (
    SELECT book_id,
      SUM(CASE WHEN hidden = 0 THEN 1 ELSE 0 END) AS chapter_count,
      SUM(CASE WHEN hidden = 1 THEN 1 ELSE 0 END) AS hidden_chapter_count,
      SUM(CASE WHEN hidden = 0 THEN chars ELSE 0 END) AS total_chars
    FROM chapters GROUP BY book_id
  ),
  note_stats AS (
    SELECT book_id, COUNT(*) AS note_count FROM notes GROUP BY book_id
  ),
  current_pos AS (
    SELECT b.id AS book_id, COALESCE(c.idx, -1) AS current_idx
    FROM books b LEFT JOIN chapters c ON c.id = b.current_chapter_id
  ),
  read_stats AS (
    SELECT c.book_id,
      SUM(CASE WHEN c.hidden = 0 AND c.idx <= cp.current_idx THEN 1 ELSE 0 END) AS read_count,
      SUM(CASE WHEN c.hidden = 0 AND c.idx <= cp.current_idx THEN c.chars ELSE 0 END) AS read_chars
    FROM chapters c JOIN current_pos cp ON cp.book_id = c.book_id
    GROUP BY c.book_id
  )
  SELECT b.*,
    COALESCE(cs.chapter_count, 0) AS chapter_count,
    COALESCE(cs.hidden_chapter_count, 0) AS hidden_chapter_count,
    COALESCE(rs.read_count, 0) AS read_count,
    COALESCE(ns.note_count, 0) AS note_count,
    COALESCE(cs.total_chars, 0) AS total_chars,
    COALESCE(rs.read_chars, 0) AS read_chars,
    cp.current_idx AS current_chapter_idx
  FROM books b
  LEFT JOIN chapter_stats cs ON cs.book_id = b.id
  LEFT JOIN note_stats ns ON ns.book_id = b.id
  LEFT JOIN current_pos cp ON cp.book_id = b.id
  LEFT JOIN read_stats rs ON rs.book_id = b.id`

export function listBooks(): BookSummary[] {
  const rows = database()
    .prepare(`${BOOK_SELECT} ORDER BY COALESCE(b.last_opened_at, b.created_at) DESC`)
    .all() as unknown as BookRow[]
  return rows.map(mapBook)
}

const SHELF_STATUSES = new Set(['inbox', 'reading', 'finished', 'archived'])

export function setBookShelfStatus(bookId: string, status: BookShelfStatus): BookSummary {
  if (!SHELF_STATUSES.has(status)) throw new Error('书架状态无效。')
  const result = database().prepare('UPDATE books SET shelf_status = ? WHERE id = ?').run(status, bookId)
  if (Number(result.changes) === 0) throw new Error('这本书不存在。')
  const updated = getBookSummary(bookId)
  if (!updated) throw new Error('这本书不存在。')
  return updated
}

export function getBookSummary(bookId: string): BookSummary | null {
  const row = database().prepare(`${BOOK_SELECT} WHERE b.id = ?`).get(bookId) as unknown as
    | BookRow
    | undefined
  return row ? mapBook(row) : null
}

/** 判断整本书是否以可见正文中的外文为主，并统计已有译文的章节数。 */
export function getBookTranslationInfo(bookId: string): BookTranslationInfo {
  const rows = database()
    .prepare(
      `SELECT id, text, translated_html
       FROM chapters
       WHERE book_id = ?
         AND hidden = 0
         AND kind IN ('content', 'front', 'unknown')
       ORDER BY idx`,
    )
    .all(bookId) as unknown as Array<{
    id: string
    text: string
    translated_html: string | null
  }>
  const language = detectBookLanguage(rows.map((row) => row.text))
  return {
    foreign: language.foreign,
    language: language.language,
    ratio: language.ratio,
    total: rows.length,
    translated: rows.filter((row) => Boolean(row.translated_html?.trim())).length,
  }
}

const bookCoverCache = new Map<string, { mtimeMs: number; size: number; dataUrl: string }>()

export function updateBookCover(bookId: string, coverPath: string): void {
  database().prepare('UPDATE books SET cover_path = ? WHERE id = ?').run(coverPath, bookId)
  bookCoverCache.delete(bookId)
}

export function getBookCover(bookId: string): string | null {
  const row = database().prepare('SELECT cover_path FROM books WHERE id = ?').get(bookId) as
    | { cover_path: string | null }
    | undefined
  if (!row?.cover_path) return null
  const extension = path.extname(row.cover_path).toLowerCase()
  const mime =
    extension === '.png' ? 'image/png'
      : extension === '.gif' ? 'image/gif'
        : extension === '.webp' ? 'image/webp'
          : extension === '.svg' ? 'image/svg+xml'
            : 'image/jpeg'
  try {
    const stat = fs.statSync(row.cover_path)
    const cached = bookCoverCache.get(bookId)
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.dataUrl
    const dataUrl = `data:${mime};base64,${fs.readFileSync(row.cover_path).toString('base64')}`
    bookCoverCache.set(bookId, { mtimeMs: stat.mtimeMs, size: stat.size, dataUrl })
    while (bookCoverCache.size > 80) {
      const oldest = bookCoverCache.keys().next().value
      if (typeof oldest !== 'string') break
      bookCoverCache.delete(oldest)
    }
    return dataUrl
  } catch {
    bookCoverCache.delete(bookId)
    return null
  }
}

export function setBookGenre(bookId: string, genre: BookGenre): BookSummary {
  const allowed = new Set<BookGenre>([
    'auto',
    'nonfiction',
    'history',
    'historical-fiction',
    'fiction',
    'detective',
    'biography',
    'myth',
    'other',
  ])
  if (!allowed.has(genre)) throw new Error('书籍类型无效。')
  const result = database().prepare('UPDATE books SET genre = ? WHERE id = ?').run(genre, bookId)
  if (Number(result.changes) === 0) throw new Error('这本书不存在。')
  const updated = getBookSummary(bookId)
  if (!updated) throw new Error('这本书不存在。')
  return updated
}

export function renameBook(bookId: string, title: string, author?: string): BookSummary {
  const clean = cleanTitle(title, '书名')
  const nextAuthor = author === undefined ? null : author.replace(/\s+/g, ' ').trim()
  if (nextAuthor !== null && nextAuthor.length > 200) throw new Error('作者不能超过 200 个字。')
  const result = database()
    .prepare('UPDATE books SET title = ?, author = COALESCE(?, author) WHERE id = ?')
    .run(clean, nextAuthor, bookId)
  if (Number(result.changes) === 0) throw new Error('这本书不存在。')
  const updated = getBookSummary(bookId)
  if (!updated) throw new Error('这本书不存在。')
  return updated
}

export function renameChapter(chapterId: string, title: string): void {
  const clean = cleanTitle(title, '章节名')
  const result = database().prepare('UPDATE chapters SET title = ? WHERE id = ?').run(clean, chapterId)
  if (Number(result.changes) === 0) throw new Error('这一章不存在。')
}

export function renamePart(bookId: string, partIndex: number, title: string): void {
  const clean = cleanTitle(title, '分篇名')
  if (!Number.isFinite(partIndex)) throw new Error('分篇无效。')
  const result = database()
    .prepare('UPDATE chapters SET part_title = ? WHERE book_id = ? AND part_index = ?')
    .run(clean, bookId, partIndex)
  if (Number(result.changes) === 0) throw new Error('这个分篇不存在。')
}

function cleanTitle(value: string, label: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) throw new Error(`${label}不能为空。`)
  if (text.length > 200) throw new Error(`${label}不能超过 200 个字。`)
  return text
}

function mapBook(row: BookRow): BookSummary {
  const chapterCount = Number(row.chapter_count ?? 0)
  const readCount = Number(row.read_count ?? 0)
  const currentIdx = row.current_chapter_idx == null ? -1 : Number(row.current_chapter_idx)
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    format: row.format as BookFormat,
    genre: (row.genre as BookGenre) || 'auto',
    hasCover: Boolean(row.cover_path) || row.format === 'epub',
    chapterCount,
    hiddenChapterCount: Number(row.hidden_chapter_count ?? 0),
    noteCount: Number(row.note_count ?? 0),
    totalChars: Number(row.total_chars ?? 0),
    readChars: Number(row.read_chars ?? 0),
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
    currentChapterId: row.current_chapter_id,
    currentChapterIdx: currentIdx,
    progress: chapterCount === 0 ? 0 : Math.min(1, readCount / chapterCount),
    shelfStatus: (row.shelf_status as BookShelfStatus) || 'reading',
  }
}

export function optimizeDatabase(): void {
  try {
    database().exec('PRAGMA optimize')
    database().exec('PRAGMA wal_checkpoint(TRUNCATE)')
    pruneArtifactVersions()
  } catch {
    // 维护失败不影响启动；下次启动会再次尝试。
  }
}

export function setProgress(bookId: string, chapterId: string): void {
  database()
    .prepare(
      "UPDATE books SET current_chapter_id = ?, last_opened_at = ?, shelf_status = CASE WHEN shelf_status = 'inbox' THEN 'reading' ELSE shelf_status END WHERE id = ?",
    )
    .run(chapterId, new Date().toISOString(), bookId)
}

interface CurrentChapterRow {
  book_id: string
  hidden: number
  kind: string
  reason: string | null
  classified_by: string | null
}

export function applyChapterFlags(flags: ChapterFlag[]): void {
  const conn = database()
  const books = new Set<string>()
  conn.exec('BEGIN IMMEDIATE')
  try {
    for (const flag of flags) {
      const row = conn
        .prepare('SELECT book_id, hidden, kind, reason, classified_by FROM chapters WHERE id = ?')
        .get(flag.chapterId) as unknown as CurrentChapterRow | undefined
      if (!row) continue
      books.add(row.book_id)
      conn
        .prepare('UPDATE chapters SET hidden = ?, kind = ?, reason = ?, classified_by = ? WHERE id = ?')
        .run(
          flag.hidden ? 1 : 0,
          flag.kind ?? row.kind,
          flag.reason === undefined ? row.reason : flag.reason,
          flag.classifiedBy ?? row.classified_by,
          flag.chapterId,
        )
    }
    for (const bookId of books) ensureCurrentChapter(conn, bookId)
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
}

export function trashChapters(chapterIds: string[]): number {
  const conn = database()
  const books = new Set<string>()
  let count = 0
  conn.exec('BEGIN IMMEDIATE')
  try {
    for (const chapterId of [...new Set(chapterIds)].filter(Boolean)) {
      const chapter = conn.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId) as unknown as
        | ChapterRow
        | undefined
      if (!chapter) continue
      const notes = conn.prepare('SELECT * FROM notes WHERE chapter_id = ?').all(chapterId) as unknown as NoteRow[]
      const marks = conn
        .prepare('SELECT * FROM reader_marks WHERE chapter_id = ?')
        .all(chapterId) as unknown as ChapterMarkRow[]
      const bookmarks = conn
        .prepare('SELECT * FROM bookmarks WHERE chapter_id = ?')
        .all(chapterId) as unknown as ChapterBookmarkRow[]
      const position = conn
        .prepare('SELECT * FROM reading_positions WHERE chapter_id = ?')
        .get(chapterId) as unknown as ChapterPositionRow | undefined
      const payload: ChapterTrashPayload = {
        chapter,
        notes,
        marks,
        bookmarks,
        position: position ?? null,
      }
      conn
        .prepare('INSERT OR REPLACE INTO chapter_trash (id, book_id, payload, deleted_at) VALUES (?, ?, ?, ?)')
        .run(chapterId, chapter.book_id, JSON.stringify(payload), new Date().toISOString())
      // notes 的外键是 ON DELETE SET NULL；不显式删除的话，删章后笔记会留成 chapter_id 为空的孤儿，
      // 30 天后回收站 payload 被清理，就再也挂不回任何章节了。恢复时会从 payload 重新插入。
      conn.prepare('DELETE FROM notes WHERE chapter_id = ?').run(chapterId)
      conn.prepare('DELETE FROM chapters WHERE id = ?').run(chapterId)
      books.add(chapter.book_id)
      count++
    }
    for (const bookId of books) ensureCurrentChapter(conn, bookId)
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
  return count
}

/** 兼容旧调用名；删除章节现在进入回收站，不再直接落盘。 */
export function deleteChapters(chapterIds: string[]): void {
  trashChapters(chapterIds)
}

export const CHAPTER_TRASH_RETENTION_DAYS = 30

export function listTrashedChapters(): TrashedChapter[] {
  const rows = database()
    .prepare(
      `SELECT t.id, t.payload, t.deleted_at, b.title AS book_title
       FROM chapter_trash t
       LEFT JOIN books b ON b.id = t.book_id
       ORDER BY t.deleted_at DESC`,
    )
    .all() as unknown as Array<{ id: string; payload: string; deleted_at: string; book_title: string | null }>
  return rows.map((row) => {
    let payload: ChapterTrashPayload | null = null
    try {
      payload = JSON.parse(row.payload) as ChapterTrashPayload
    } catch {
      // 损坏的回收站数据仍然展示，用户可以彻底删除。
    }
    return {
      id: row.id,
      title: payload?.chapter?.title || '已删除的章节',
      bookId: payload?.chapter?.book_id ?? '',
      bookTitle: row.book_title?.trim() || '原书已删除',
      noteCount: Array.isArray(payload?.notes) ? payload.notes.length : 0,
      deletedAt: row.deleted_at,
    }
  })
}

/**
 * 旧版本删章时只把 chapters 行删掉，notes.chapter_id 被置空，笔记成了孤儿。
 * 回收站 payload 里有这些笔记的 id；永久删除章节时顺手清理掉仍然挂着 NULL 的那些。
 */
function purgeOrphanedNotes(payloads: string[]): number {
  const ids: string[] = []
  for (const raw of payloads) {
    try {
      const payload = JSON.parse(raw) as { notes?: Array<{ id?: unknown }> }
      for (const note of payload.notes ?? []) {
        if (typeof note.id === 'string') ids.push(note.id)
      }
    } catch {
      // 坏 payload 不影响其他章节的清理。
    }
  }
  if (ids.length === 0) return 0
  const conn = database()
  let removed = 0
  for (let index = 0; index < ids.length; index += 400) {
    const chunk = ids.slice(index, index + 400)
    const placeholders = chunk.map(() => '?').join(',')
    const result = conn
      .prepare(`DELETE FROM notes WHERE chapter_id IS NULL AND id IN (${placeholders})`)
      .run(...chunk)
    removed += Number(result.changes ?? 0)
  }
  return removed
}

export function pruneChapterTrash(days = CHAPTER_TRASH_RETENTION_DAYS): number {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const conn = database()
  const rows = conn
    .prepare('SELECT payload FROM chapter_trash WHERE deleted_at < ?')
    .all(cutoff) as unknown as Array<{ payload: string }>
  conn.exec('BEGIN IMMEDIATE')
  try {
    purgeOrphanedNotes(rows.map((row) => row.payload))
    const result = conn.prepare('DELETE FROM chapter_trash WHERE deleted_at < ?').run(cutoff)
    conn.exec('COMMIT')
    return Number(result.changes ?? 0)
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
}

export function purgeTrashedChapter(chapterId: string): void {
  const conn = database()
  const row = conn.prepare('SELECT payload FROM chapter_trash WHERE id = ?').get(chapterId) as
    | { payload: string }
    | undefined
  conn.exec('BEGIN IMMEDIATE')
  try {
    if (row) purgeOrphanedNotes([row.payload])
    conn.prepare('DELETE FROM chapter_trash WHERE id = ?').run(chapterId)
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
}

export function emptyChapterTrash(): number {
  const conn = database()
  const rows = conn.prepare('SELECT payload FROM chapter_trash').all() as unknown as Array<{ payload: string }>
  conn.exec('BEGIN IMMEDIATE')
  try {
    purgeOrphanedNotes(rows.map((row) => row.payload))
    const result = conn.prepare('DELETE FROM chapter_trash').run()
    conn.exec('COMMIT')
    return Number(result.changes ?? 0)
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
}


export function restoreTrashedChapter(chapterId: string): ChapterContent | null {
  const row = database().prepare('SELECT payload, book_id FROM chapter_trash WHERE id = ?').get(chapterId) as
    | { payload: string; book_id: string }
    | undefined
  if (!row) return null
  let payload: ChapterTrashPayload
  try {
    payload = JSON.parse(row.payload) as ChapterTrashPayload
  } catch {
    return null
  }
  const chapter = payload.chapter
  if (!chapter || !row.book_id) return null
  const book = database().prepare('SELECT 1 FROM books WHERE id = ?').get(row.book_id)
  if (!book) return null
  const conn = database()
  conn.exec('BEGIN IMMEDIATE')
  try {
    const existing = conn
      .prepare('SELECT 1 FROM chapters WHERE book_id = ? AND idx = ?')
      .get(row.book_id, chapter.idx)
    const nextIdx = existing
      ? Number(
          (conn.prepare('SELECT COALESCE(MAX(idx), -1) AS max_idx FROM chapters WHERE book_id = ?').get(row.book_id) as {
            max_idx: number
          }).max_idx,
        ) + 1
      : chapter.idx
    conn
      .prepare(
        `INSERT OR REPLACE INTO chapters
         (id, book_id, idx, title, text, html, chars, hidden, kind, reason, classified_by, part_title, part_index, is_part, formatted_html, format_removed, format_updated_at, note_report)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        chapter.id,
        row.book_id,
        nextIdx,
        chapter.title,
        chapter.text,
        chapter.html,
        chapter.chars,
        chapter.hidden,
        chapter.kind,
        chapter.reason,
        chapter.classified_by,
        chapter.part_title,
        chapter.part_index,
        chapter.is_part,
        chapter.formatted_html,
        chapter.format_removed,
        chapter.format_updated_at,
        chapter.note_report,
      )
    for (const note of payload.notes ?? []) {
      conn
        .prepare(
          `INSERT OR REPLACE INTO notes
           (id, book_id, chapter_id, kind, title, content, quote, quote_verified, author, edited, tags, section, importance, role, expansion, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          note.id,
          row.book_id,
          chapter.id,
          note.kind,
          note.title,
          note.content,
          note.quote,
          note.quote_verified,
          note.author,
          note.edited,
          note.tags,
          note.section,
          note.importance,
          note.role,
          note.expansion,
          note.created_at,
          note.updated_at,
        )
    }
    for (const mark of payload.marks ?? []) {
      conn
        .prepare('INSERT OR REPLACE INTO reader_marks (id, book_id, chapter_id, quote, style, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(mark.id, row.book_id, chapter.id, mark.quote, mark.style, mark.created_at)
    }
    for (const bookmark of payload.bookmarks ?? []) {
      conn
        .prepare(
          `INSERT OR REPLACE INTO bookmarks
           (id, book_id, chapter_id, scroll_ratio, scroll_top, page, label, quote, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          bookmark.id,
          row.book_id,
          chapter.id,
          bookmark.scroll_ratio,
          bookmark.scroll_top,
          bookmark.page,
          bookmark.label,
          bookmark.quote,
          bookmark.created_at,
        )
    }
    if (payload.position) {
      conn
        .prepare(
          `INSERT OR REPLACE INTO reading_positions
           (chapter_id, book_id, scroll_ratio, scroll_top, page, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          chapter.id,
          row.book_id,
          payload.position.scroll_ratio,
          payload.position.scroll_top,
          payload.position.page,
          payload.position.updated_at,
        )
    }
    conn.prepare('DELETE FROM chapter_trash WHERE id = ?').run(chapterId)
    ensureCurrentChapter(conn, row.book_id)
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
  return getChapter(chapterId)
}

/** 当前章节被隐藏或删除时，把阅读进度挪到第一个可见章节。 */
function ensureCurrentChapter(conn: DatabaseSync, bookId: string): void {
  const book = conn.prepare('SELECT current_chapter_id FROM books WHERE id = ?').get(bookId) as
    | { current_chapter_id: string | null }
    | undefined
  const current = book?.current_chapter_id ?? null
  if (current) {
    const valid = conn.prepare('SELECT id FROM chapters WHERE id = ? AND hidden = 0').get(current)
    if (valid) return
  }
  const next = conn
    .prepare('SELECT id FROM chapters WHERE book_id = ? AND hidden = 0 ORDER BY idx LIMIT 1')
    .get(bookId) as { id: string } | undefined
  conn.prepare('UPDATE books SET current_chapter_id = ? WHERE id = ?').run(next?.id ?? null, bookId)
}

function mapChapterMeta(row: ChapterRow): ChapterMeta {
  return {
    id: row.id,
    idx: Number(row.idx),
    title: row.title,
    chars: Number(row.chars),
    hidden: Number(row.hidden) === 1,
    kind: (row.kind as ChapterKind) ?? 'content',
    reason: row.reason,
    classifiedBy: (row.classified_by as ChapterFlagSource | null) ?? null,
    partTitle: row.part_title,
    partIndex: row.part_index == null ? null : Number(row.part_index),
    isPart: Number(row.is_part) === 1,
  }
}

export function getChapters(bookId: string): ChapterMeta[] {
  const rows = database()
    .prepare(
      'SELECT id, idx, title, chars, hidden, kind, reason, classified_by, part_title, part_index, is_part FROM chapters WHERE book_id = ? ORDER BY idx',
    )
    .all(bookId) as unknown as ChapterRow[]
  return rows.map(mapChapterMeta)
}

export function getChapter(chapterId: string): ChapterContent {
  const row = database().prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId) as unknown as
    | ChapterRow
    | undefined
  if (!row) throw new Error('章节不存在')
  return {
    ...mapChapterMeta(row),
    bookId: row.book_id,
    text: row.text,
    html: row.html,
    formattedHtml: row.formatted_html,
    removed: parseRemoved(row.format_removed),
    noteReport: parseNoteReport(row.note_report),
    translatedText: row.translated_text,
    translatedHtml: row.translated_html,
    translatedAt: row.translated_at,
  }
}

function parseRemoved(raw: string | null): RemovedPart[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        reason: String(item.reason ?? '无关内容'),
        text: String(item.text ?? ''),
        verified: item.verified === true,
      }))
      .filter((item) => item.text.length > 0)
  } catch {
    return []
  }
}

/** 排版后同步更新 chars，书架总字数和阅读进度才会反映实际正文。 */
export function saveChapterFormat(chapterId: string, html: string, removed: RemovedPart[]): number {
  const chars = htmlToText(html).length
  database()
    .prepare('UPDATE chapters SET formatted_html = ?, format_removed = ?, format_updated_at = ?, chars = ? WHERE id = ?')
    .run(html, JSON.stringify(removed), new Date().toISOString(), chars, chapterId)
  return chars
}

export function saveChapterContent(chapterId: string, html: string): number {
  const chars = htmlToText(html).length
  database()
    .prepare('UPDATE chapters SET formatted_html = ?, format_removed = NULL, format_updated_at = ?, chars = ? WHERE id = ?')
    .run(html, new Date().toISOString(), chars, chapterId)
  return chars
}

export function saveChapterTranslation(
  chapterId: string,
  html: string,
  text: string,
): { translatedAt: string } {
  const translatedAt = new Date().toISOString()
  database()
    .prepare('UPDATE chapters SET translated_text = ?, translated_html = ?, translated_at = ? WHERE id = ?')
    .run(text, html, translatedAt, chapterId)
  return { translatedAt }
}

export function resetChapterFormat(chapterId: string): number {
  database()
    .prepare(
      'UPDATE chapters SET formatted_html = NULL, format_removed = NULL, format_updated_at = NULL, chars = LENGTH(text) WHERE id = ?',
    )
    .run(chapterId)
  const row = database().prepare('SELECT chars FROM chapters WHERE id = ?').get(chapterId) as { chars?: number } | undefined
  return Number(row?.chars ?? 0)
}

export function getBookStyle(bookId: string): ReaderStyle {
  const row = database().prepare('SELECT style_json FROM books WHERE id = ?').get(bookId) as
    | { style_json: string | null }
    | undefined
  if (!row) throw new Error('找不到这本书')
  return parseStyleJson(row.style_json)
}

export function saveBookStyle(bookId: string, style: unknown): ReaderStyle {
  const normalized = normalizeReaderStyle(style)
  database().prepare('UPDATE books SET style_json = ? WHERE id = ?').run(JSON.stringify(normalized), bookId)
  return normalized
}

export function getBookRecord(bookId: string): BookRecord | null {
  const row = database()
    .prepare('SELECT id, title, author, format, file_path FROM books WHERE id = ?')
    .get(bookId) as
    | { id: string; title: string; author: string; format: string; file_path: string }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    format: row.format as BookFormat,
    filePath: row.file_path,
  }
}

/** 用新的目录替换一本书的章节；旧笔记优先按引用原文、其次按章节标题重新归属。 */
export function replaceBookChapters(
  bookId: string,
  parsed: { title: string; author: string; chapters: NewChapter[] },
): BookSummary {
  const conn = database()
  const now = new Date().toISOString()
  const oldNotes = conn
    .prepare(
      `SELECT n.id, n.quote, c.title AS chapter_title
       FROM notes n LEFT JOIN chapters c ON c.id = n.chapter_id
       WHERE n.book_id = ?`,
    )
    .all(bookId) as unknown as Array<{ id: string; quote: string | null; chapter_title: string | null }>

  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[\s　]/g, '')
      .replace(/[“”"'‘’「」『』（）()【】\[\]…—–\-·、，,。.；;：:！!？?《》<>]/g, '')

  const created: Array<{ id: string; title: string; text: string; hidden: boolean; kind: ChapterKind }> = []

  conn.exec('BEGIN IMMEDIATE')
  try {
    conn.prepare('UPDATE notes SET chapter_id = NULL WHERE book_id = ?').run(bookId)
    conn.prepare('DELETE FROM chapters WHERE book_id = ?').run(bookId)

    const insert = conn.prepare(
      'INSERT INTO chapters (id, book_id, idx, title, text, html, chars, hidden, kind, reason, classified_by, part_title, part_index, is_part) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    parsed.chapters.forEach((chapter, index) => {
      const id = crypto.randomUUID()
      insert.run(
        id,
        bookId,
        index,
        chapter.title,
        chapter.text,
        chapter.html,
        chapter.text.length,
        chapter.hidden ? 1 : 0,
        chapter.kind ?? 'content',
        chapter.reason ?? null,
        chapter.classifiedBy ?? null,
        chapter.partTitle ?? null,
        chapter.partIndex ?? null,
        chapter.isPart ? 1 : 0,
      )
      created.push({
        id,
        title: chapter.title,
        text: chapter.text,
        hidden: chapter.hidden === true,
        kind: chapter.kind ?? 'content',
      })
    })

    for (const note of oldNotes) {
      let targetId: string | null = null
      if (note.quote) {
        const needle = normalize(note.quote).slice(0, 40)
        if (needle.length >= 6) {
          targetId = created.find((chapter) => normalize(chapter.text).includes(needle))?.id ?? null
        }
      }
      if (!targetId && note.chapter_title) {
        const oldTitle = note.chapter_title
        targetId =
          created.find((chapter) => chapter.title === oldTitle)?.id ??
          created.find((chapter) => chapter.title.includes(oldTitle) || oldTitle.includes(chapter.title))?.id ??
          null
      }
      conn.prepare('UPDATE notes SET chapter_id = ? WHERE id = ?').run(targetId, note.id)
    }

    const first =
      created.find((chapter) => !chapter.hidden && chapter.kind === 'content') ??
      created.find((chapter) => !chapter.hidden) ??
      null
    conn
      .prepare('UPDATE books SET title = ?, author = ?, current_chapter_id = ?, last_opened_at = ? WHERE id = ?')
      .run(parsed.title, parsed.author, first?.id ?? null, now, bookId)

    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }

  const summary = getBookSummary(bookId)
  if (!summary) throw new Error('重新解析失败')
  return summary
}

/** 在已有书末尾追加一章，用于合并 Readwise/Kindle 划线。 */
export function appendChapter(bookId: string, chapter: NewChapter): string {
  const book = database().prepare('SELECT id FROM books WHERE id = ?').get(bookId) as { id: string } | undefined
  if (!book) throw new Error('找不到这本书。')
  const nextIdx =
    (database().prepare('SELECT COALESCE(MAX(idx), -1) AS max_idx FROM chapters WHERE book_id = ?').get(bookId) as {
      max_idx: number
    }).max_idx + 1
  const id = crypto.randomUUID()
  database()
    .prepare(
      'INSERT INTO chapters (id, book_id, idx, title, text, html, chars, hidden, kind, reason, classified_by, part_title, part_index, is_part) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, NULL, NULL, 0)',
    )
    .run(
      id,
      bookId,
      nextIdx,
      chapter.title,
      chapter.text,
      chapter.html,
      chapter.text.length,
      chapter.kind ?? 'content',
      chapter.classifiedBy ?? 'user',
    )
  database().prepare('UPDATE books SET last_opened_at = ? WHERE id = ?').run(new Date().toISOString(), bookId)
  return id
}

/** 删除前抓取整本书、章节和笔记的完整行，供书籍回收站恢复。 */
export function snapshotBookForTrash(bookId: string): string | null {
  const conn = database()
  const book = conn.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as
    | Record<string, unknown>
    | undefined
  if (!book) return null
  const chapters = conn.prepare('SELECT * FROM chapters WHERE book_id = ? ORDER BY idx').all(bookId)
  const notes = conn.prepare('SELECT * FROM notes WHERE book_id = ?').all(bookId)
  return JSON.stringify({ book, chapters, notes })
}

export function saveBookTrash(bookId: string, payload: string, fileDir: string): void {
  database()
    .prepare('INSERT OR REPLACE INTO book_trash (id, payload, file_dir, deleted_at) VALUES (?, ?, ?, ?)')
    .run(bookId, payload, fileDir, new Date().toISOString())
}

export const BOOK_TRASH_RETENTION_DAYS = 30

export function listTrashedBooks(): TrashedBook[] {
  const rows = database()
    .prepare('SELECT id, payload, deleted_at FROM book_trash ORDER BY deleted_at DESC')
    .all() as unknown as Array<{ id: string; payload: string; deleted_at: string }>
  return rows.flatMap((row) => {
    try {
      const parsed = JSON.parse(row.payload) as {
        book?: Record<string, unknown>
        chapters?: unknown[]
        notes?: unknown[]
      }
      const book = parsed.book ?? {}
      return [
        {
          id: row.id,
          title: typeof book.title === 'string' ? book.title : '未命名',
          author: typeof book.author === 'string' ? book.author : '',
          format: (book.format as BookFormat) ?? 'text',
          chapterCount: Array.isArray(parsed.chapters) ? parsed.chapters.length : 0,
          noteCount: Array.isArray(parsed.notes) ? parsed.notes.length : 0,
          deletedAt: row.deleted_at,
        },
      ]
    } catch {
      return []
    }
  })
}

function insertRow(conn: DatabaseSync, table: string, row: Record<string, unknown>): void {
  const keys = Object.keys(row)
  if (keys.length === 0) return
  const columns = keys.map((key) => `"${key.replace(/"/g, '""')}"`).join(', ')
  const placeholders = keys.map(() => '?').join(', ')
  conn.prepare(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`).run(
    ...keys.map((key) => row[key] as never),
  )
}

export function restoreTrashedBook(bookId: string): BookSummary | null {
  const row = database()
    .prepare('SELECT payload FROM book_trash WHERE id = ?')
    .get(bookId) as { payload: string } | undefined
  if (!row) return null
  let payload: { book?: Record<string, unknown>; chapters?: Array<Record<string, unknown>>; notes?: Array<Record<string, unknown>> }
  try {
    payload = JSON.parse(row.payload) as typeof payload
  } catch {
    return null
  }
  if (!payload.book || typeof payload.book !== 'object') return null
  const conn = database()
  if (conn.prepare('SELECT 1 FROM books WHERE id = ?').get(bookId)) return null
  conn.exec('BEGIN IMMEDIATE')
  try {
    insertRow(conn, 'books', payload.book)
    for (const chapter of payload.chapters ?? []) insertRow(conn, 'chapters', chapter)
    for (const note of payload.notes ?? []) insertRow(conn, 'notes', note)
    conn.prepare('DELETE FROM book_trash WHERE id = ?').run(bookId)
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
  return getBookSummary(bookId)
}

export function purgeTrashedBook(bookId: string): string | null {
  const row = database().prepare('SELECT file_dir FROM book_trash WHERE id = ?').get(bookId) as
    | { file_dir: string }
    | undefined
  database().prepare('DELETE FROM book_trash WHERE id = ?').run(bookId)
  return row?.file_dir ?? null
}

export function emptyBookTrash(): string[] {
  const rows = database().prepare('SELECT file_dir FROM book_trash').all() as unknown as Array<{
    file_dir: string
  }>
  database().prepare('DELETE FROM book_trash').run()
  return rows.map((row) => row.file_dir)
}

/** 返回需要一起删除的书籍目录；调用方负责删除磁盘文件。 */
export function pruneBookTrash(days = BOOK_TRASH_RETENTION_DAYS): string[] {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const rows = database()
    .prepare('SELECT file_dir FROM book_trash WHERE deleted_at < ?')
    .all(cutoff) as unknown as Array<{ file_dir: string }>
  database().prepare('DELETE FROM book_trash WHERE deleted_at < ?').run(cutoff)
  return rows.map((row) => row.file_dir)
}

export function deleteBook(bookId: string): string | null {
  const conn = database()
  const row = conn.prepare('SELECT file_path FROM books WHERE id = ?').get(bookId) as
    | { file_path: string }
    | undefined
  conn.exec('BEGIN IMMEDIATE')
  try {
    conn.prepare('DELETE FROM note_trash WHERE book_id = ?').run(bookId)
    conn.prepare('DELETE FROM chapter_trash WHERE book_id = ?').run(bookId)
    conn.prepare('DELETE FROM books WHERE id = ?').run(bookId)
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
  return row?.file_path ?? null
}

