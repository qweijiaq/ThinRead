import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type {
  BookFormat,
  BookSummary,
  ChapterContent,
  ChapterFlag,
  ChapterFlagSource,
  ChapterKind,
  ChapterMeta,
  Note,
  NoteDivergence,
  NoteDraft,
  NoteKind,
  NotePatch,
  NoteReport,
  ReaderStyle,
  RelatedNote,
  RemovedPart,
  SearchResult,
  LibraryFilter,
  LibraryNote,
  ReviewRating,
  ReviewStats,
  TagCount,
} from '../shared/types.js'

import { normalizeReaderStyle, parseStyleJson } from './reader-style.js'

let db: DatabaseSync | null = null

export interface NewBook {
  title: string
  author: string
  format: BookFormat
  filePath: string
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
  file_path: string
  created_at: string
  last_opened_at: string | null
  current_chapter_id: string | null
  chapter_count: number
  hidden_chapter_count: number
  read_count: number | null
  note_count: number
  current_chapter_idx: number | null
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
  expansion: string | null
  created_at: string
  updated_at: string
}

export function initDatabase(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true })
  db = new DatabaseSync(path.join(dataDir, 'reading-notes.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      format TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_opened_at TEXT,
      current_chapter_id TEXT,
      style_json TEXT
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      html TEXT,
      chars INTEGER NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'content',
      reason TEXT,
      classified_by TEXT,
      part_title TEXT,
      part_index INTEGER,
      is_part INTEGER NOT NULL DEFAULT 0,
      formatted_html TEXT,
      format_removed TEXT,
      format_updated_at TEXT,
      note_report TEXT,
      UNIQUE(book_id, idx)
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      quote TEXT,
      quote_verified INTEGER NOT NULL DEFAULT 0,
      author TEXT NOT NULL,
      edited INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      section TEXT,
      importance INTEGER,
      role TEXT,
      expansion TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notes_book ON notes(book_id);
    CREATE INDEX IF NOT EXISTS idx_notes_chapter ON notes(chapter_id);

    CREATE TABLE IF NOT EXISTS note_embeddings (
      note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      dim INTEGER NOT NULL,
      vector TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS note_reviews (
      note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
      due_at TEXT NOT NULL,
      interval_days REAL NOT NULL DEFAULT 0,
      ease REAL NOT NULL DEFAULT 2.5,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      last_rating TEXT,
      last_reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_note_reviews_due ON note_reviews(due_at);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  migrateBooks(db)
  migrateChapters(db)
  migrateNotes(db)
}

function migrateNotes(conn: DatabaseSync): void {
  const columns = new Set(
    (conn.prepare('PRAGMA table_info(notes)').all() as unknown as Array<{ name: string }>).map((row) => row.name),
  )
  const additions: Array<[string, string]> = [
    ['section', 'TEXT'],
    ['importance', 'INTEGER'],
    ['role', 'TEXT'],
    ['expansion', 'TEXT'],
  ]
  for (const [name, ddl] of additions) {
    if (!columns.has(name)) conn.exec(`ALTER TABLE notes ADD COLUMN ${name} ${ddl}`)
  }
}

function migrateBooks(conn: DatabaseSync): void {
  const columns = new Set(
    (conn.prepare('PRAGMA table_info(books)').all() as unknown as Array<{ name: string }>).map((row) => row.name),
  )
  if (!columns.has('style_json')) conn.exec('ALTER TABLE books ADD COLUMN style_json TEXT')
}

/** 旧版本的数据库没有章节标记字段，启动时补列。 */
function migrateChapters(conn: DatabaseSync): void {
  const columns = new Set(
    (conn.prepare('PRAGMA table_info(chapters)').all() as unknown as Array<{ name: string }>).map((row) => row.name),
  )
  const additions: Array<[string, string]> = [
    ['hidden', 'INTEGER NOT NULL DEFAULT 0'],
    ['kind', "TEXT NOT NULL DEFAULT 'content'"],
    ['reason', 'TEXT'],
    ['classified_by', 'TEXT'],
    ['part_title', 'TEXT'],
    ['part_index', 'INTEGER'],
    ['is_part', 'INTEGER NOT NULL DEFAULT 0'],
    ['formatted_html', 'TEXT'],
    ['format_removed', 'TEXT'],
    ['format_updated_at', 'TEXT'],
    ['note_report', 'TEXT'],
  ]
  for (const [name, ddl] of additions) {
    if (!columns.has(name)) conn.exec(`ALTER TABLE chapters ADD COLUMN ${name} ${ddl}`)
  }
}

function database(): DatabaseSync {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

export function closeDatabase(): void {
  db?.close()
  db = null
}

export function insertBook(book: NewBook, chapters: NewChapter[], bookId: string = crypto.randomUUID()): BookSummary {
  const conn = database()
  const now = new Date().toISOString()
  conn.exec('BEGIN')
  try {
    conn
      .prepare(
        'INSERT INTO books (id, title, author, format, file_path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(bookId, book.title, book.author, book.format, book.filePath, now, now)
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

const BOOK_SELECT = `SELECT b.*,
  (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id AND c.hidden = 0) AS chapter_count,
  (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id AND c.hidden = 1) AS hidden_chapter_count,
  (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id AND c.hidden = 0
     AND c.idx <= COALESCE((SELECT cc.idx FROM chapters cc WHERE cc.id = b.current_chapter_id), -1)) AS read_count,
  (SELECT COUNT(*) FROM notes n WHERE n.book_id = b.id) AS note_count,
  (SELECT c.idx FROM chapters c WHERE c.id = b.current_chapter_id) AS current_chapter_idx
 FROM books b`

export function listBooks(): BookSummary[] {
  const rows = database()
    .prepare(`${BOOK_SELECT} ORDER BY COALESCE(b.last_opened_at, b.created_at) DESC`)
    .all() as unknown as BookRow[]
  return rows.map(mapBook)
}

export function getBookSummary(bookId: string): BookSummary | null {
  const row = database().prepare(`${BOOK_SELECT} WHERE b.id = ?`).get(bookId) as unknown as
    | BookRow
    | undefined
  return row ? mapBook(row) : null
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
    chapterCount,
    hiddenChapterCount: Number(row.hidden_chapter_count ?? 0),
    noteCount: Number(row.note_count ?? 0),
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
    currentChapterId: row.current_chapter_id,
    currentChapterIdx: currentIdx,
    progress: chapterCount === 0 ? 0 : Math.min(1, readCount / chapterCount),
  }
}

export function setProgress(bookId: string, chapterId: string): void {
  database()
    .prepare('UPDATE books SET current_chapter_id = ?, last_opened_at = ? WHERE id = ?')
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
  conn.exec('BEGIN')
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

export function deleteChapters(chapterIds: string[]): void {
  const conn = database()
  const books = new Set<string>()
  conn.exec('BEGIN')
  try {
    for (const chapterId of chapterIds) {
      const row = conn.prepare('SELECT book_id FROM chapters WHERE id = ?').get(chapterId) as
        | { book_id: string }
        | undefined
      if (!row) continue
      books.add(row.book_id)
      conn.prepare('DELETE FROM notes WHERE chapter_id = ?').run(chapterId)
      conn.prepare('DELETE FROM chapters WHERE id = ?').run(chapterId)
    }
    for (const bookId of books) ensureCurrentChapter(conn, bookId)
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
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
  }
}

export function saveNoteReport(chapterId: string, report: NoteReport): void {
  database()
    .prepare('UPDATE chapters SET note_report = ? WHERE id = ?')
    .run(JSON.stringify(report), chapterId)
}

export function saveNoteDivergences(noteId: string, divergences: NoteDivergence[]): void {
  database()
    .prepare('UPDATE notes SET expansion = ? WHERE id = ?')
    .run(JSON.stringify(divergences.slice(0, 3)), noteId)
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

export function saveChapterFormat(chapterId: string, html: string, removed: RemovedPart[]): void {
  database()
    .prepare('UPDATE chapters SET formatted_html = ?, format_removed = ?, format_updated_at = ? WHERE id = ?')
    .run(html, JSON.stringify(removed), new Date().toISOString(), chapterId)
}

export function resetChapterFormat(chapterId: string): void {
  database()
    .prepare('UPDATE chapters SET formatted_html = NULL, format_removed = NULL, format_updated_at = NULL WHERE id = ?')
    .run(chapterId)
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

  conn.exec('BEGIN')
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

export function deleteBook(bookId: string): string | null {
  const row = database().prepare('SELECT file_path FROM books WHERE id = ?').get(bookId) as
    | { file_path: string }
    | undefined
  database().prepare('DELETE FROM books WHERE id = ?').run(bookId)
  return row?.file_path ?? null
}

export function listNotes(bookId: string, chapterId?: string | null): Note[] {
  const conn = database()
  const rows = chapterId
    ? (conn
        .prepare('SELECT * FROM notes WHERE book_id = ? AND chapter_id = ? ORDER BY created_at, rowid')
        .all(bookId, chapterId) as unknown as NoteRow[])
    : (conn
        .prepare('SELECT * FROM notes WHERE book_id = ? ORDER BY created_at, rowid')
        .all(bookId) as unknown as NoteRow[])
  return rows.map(mapNote)
}

export function listRelatedNotes(bookId: string, tags: string[], limit = 6): RelatedNote[] {
  const wanted = tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length >= 2)
  if (wanted.length === 0) return []

  const rows = database()
    .prepare(
      `SELECT n.id, n.book_id, b.title AS book_title, n.chapter_id, c.title AS chapter_title,
              n.title, n.content, n.tags
       FROM notes n
       JOIN books b ON b.id = n.book_id
       LEFT JOIN chapters c ON c.id = n.chapter_id
       WHERE n.book_id != ?`,
    )
    .all(bookId) as unknown as Array<{
    id: string
    book_id: string
    book_title: string
    chapter_id: string | null
    chapter_title: string | null
    title: string
    content: string
    tags: string
  }>

  const scored: RelatedNote[] = []
  for (const row of rows) {
    let noteTags: string[] = []
    try {
      const parsed = JSON.parse(row.tags) as unknown
      if (Array.isArray(parsed)) noteTags = parsed.filter((tag): tag is string => typeof tag === 'string')
    } catch {
      noteTags = []
    }
    const lowered = noteTags.map((tag) => tag.toLowerCase())
    let score = 0
    for (const tag of wanted) {
      if (lowered.includes(tag)) score += 2
      else if (row.content.toLowerCase().includes(tag)) score += 1
    }
    if (score <= 0) continue
    scored.push({
      id: row.id,
      bookId: row.book_id,
      bookTitle: row.book_title,
      chapterId: row.chapter_id,
      chapterTitle: row.chapter_title,
      title: row.title,
      content: row.content,
      tags: noteTags,
      score,
    })
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

export function searchLibrary(rawQuery: string, limit = 40): SearchResult[] {
  const query = rawQuery.replace(/\s+/g, ' ').trim()
  if (!query) return []
  const escaped = query.replace(/[\\%_]/g, (char) => `\\${char}`)
  const like = `%${escaped}%`
  const conn = database()
  const results: SearchResult[] = []

  const books = conn
    .prepare(
      `SELECT b.id, b.title, b.author, b.last_opened_at, b.created_at,
              (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id AND c.hidden = 0) AS chapter_count,
              (SELECT COUNT(*) FROM notes n WHERE n.book_id = b.id) AS note_count
       FROM books b
       WHERE b.title LIKE ? ESCAPE '\\' OR b.author LIKE ? ESCAPE '\\'
       ORDER BY b.last_opened_at DESC, b.created_at DESC
       LIMIT 6`,
    )
    .all(like, like) as unknown as Array<{
    id: string
    title: string
    author: string
    last_opened_at: string | null
    created_at: string
    chapter_count: number
    note_count: number
  }>
  for (const row of books) {
    results.push({
      type: 'book',
      id: row.id,
      bookId: row.id,
      bookTitle: row.title,
      chapterId: null,
      chapterTitle: null,
      title: row.title,
      snippet: `${row.author || '未知作者'} · ${Number(row.chapter_count)} 章 · ${Number(row.note_count)} 条笔记`,
      updatedAt: row.last_opened_at ?? row.created_at,
    })
  }

  const chapters = conn
    .prepare(
      `SELECT c.id, c.book_id, b.title AS book_title, c.title, c.text, c.idx
       FROM chapters c
       JOIN books b ON b.id = c.book_id
       WHERE c.hidden = 0 AND (c.title LIKE ? ESCAPE '\\' OR c.text LIKE ? ESCAPE '\\')
       ORDER BY CASE WHEN c.title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, b.title, c.idx
       LIMIT 14`,
    )
    .all(like, like, like) as unknown as Array<{
    id: string
    book_id: string
    book_title: string
    title: string
    text: string
    idx: number
  }>
  for (const row of chapters) {
    results.push({
      type: 'chapter',
      id: row.id,
      bookId: row.book_id,
      bookTitle: row.book_title,
      chapterId: row.id,
      chapterTitle: row.title,
      title: row.title,
      snippet: makeSnippet(row.text, query),
      updatedAt: null,
    })
  }

  const notes = conn
    .prepare(
      `SELECT n.id, n.book_id, b.title AS book_title, n.chapter_id, c.title AS chapter_title,
              n.title, n.content, n.updated_at
       FROM notes n
       JOIN books b ON b.id = n.book_id
       LEFT JOIN chapters c ON c.id = n.chapter_id
       WHERE n.title LIKE ? ESCAPE '\\' OR n.content LIKE ? ESCAPE '\\' OR n.tags LIKE ? ESCAPE '\\'
       ORDER BY CASE WHEN n.title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, n.updated_at DESC
       LIMIT 20`,
    )
    .all(like, like, like, like) as unknown as Array<{
    id: string
    book_id: string
    book_title: string
    chapter_id: string | null
    chapter_title: string | null
    title: string
    content: string
    updated_at: string
  }>
  for (const row of notes) {
    results.push({
      type: 'note',
      id: row.id,
      bookId: row.book_id,
      bookTitle: row.book_title,
      chapterId: row.chapter_id,
      chapterTitle: row.chapter_title,
      title: row.title,
      snippet: makeSnippet(row.content, query),
      updatedAt: row.updated_at,
    })
  }

  return results.slice(0, limit)
}

function makeSnippet(text: string, query: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const index = flat.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat
  const start = Math.max(0, index - 48)
  const end = Math.min(flat.length, index + query.length + 56)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

const REVIEWABLE_SQL = "n.kind IN ('point', 'claim', 'summary', 'question', 'thought') AND length(trim(n.content)) > 0"

interface LibraryRow extends NoteRow {
  book_title: string
  chapter_title: string | null
  review_due_at: string | null
  review_reps: number | null
}

function libraryRows(): LibraryRow[] {
  return database()
    .prepare(
      `SELECT n.*, b.title AS book_title, c.title AS chapter_title,
              r.due_at AS review_due_at, r.reps AS review_reps
       FROM notes n
       JOIN books b ON b.id = n.book_id
       LEFT JOIN chapters c ON c.id = n.chapter_id
       LEFT JOIN note_reviews r ON r.note_id = n.id
       ORDER BY n.updated_at DESC, n.rowid DESC`,
    )
    .all() as unknown as LibraryRow[]
}

function mapLibraryNote(row: LibraryRow): LibraryNote {
  return {
    ...mapNote(row),
    bookTitle: row.book_title,
    chapterTitle: row.chapter_title,
    dueAt: row.review_due_at,
    reviewReps: Number(row.review_reps ?? 0),
  }
}

export function listLibraryNotes(filter: LibraryFilter = {}): LibraryNote[] {
  const term = filter.query?.replace(/\s+/g, ' ').trim().toLowerCase() ?? ''
  const limit = Math.min(Math.max(filter.limit ?? 300, 1), 1000)
  return libraryRows()
    .map(mapLibraryNote)
    .filter((note) => {
      if (filter.bookId && note.bookId !== filter.bookId) return false
      if (filter.kind && note.kind !== filter.kind) return false
      if (filter.tag && !note.tags.includes(filter.tag)) return false
      if (term && !`${note.title}\n${note.content}`.toLowerCase().includes(term)) return false
      return true
    })
    .slice(0, limit)
}

export function listLibraryTags(bookId?: string | null): TagCount[] {
  const counts = new Map<string, number>()
  for (const note of libraryRows()) {
    if (bookId && note.book_id !== bookId) continue
    for (const tag of parseTags(note.tags)) {
      const text = tag.trim()
      if (text) counts.set(text, (counts.get(text) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export function getReviewStats(): ReviewStats {
  const conn = database()
  const row = (sql: string, ...params: string[]): number => {
    const result = conn.prepare(sql).get(...params) as { count: number } | undefined
    return Number(result?.count ?? 0)
  }
  const now = new Date().toISOString()
  const total = row(`SELECT COUNT(*) AS count FROM notes n WHERE ${REVIEWABLE_SQL}`)
  const newCount = row(
    `SELECT COUNT(*) AS count FROM notes n
     LEFT JOIN note_reviews r ON r.note_id = n.id
     WHERE ${REVIEWABLE_SQL} AND r.note_id IS NULL`,
  )
  const due = row(
    `SELECT COUNT(*) AS count FROM notes n
     LEFT JOIN note_reviews r ON r.note_id = n.id
     WHERE ${REVIEWABLE_SQL} AND (r.note_id IS NULL OR r.due_at <= ?)`,
    now,
  )
  const reviewedToday = row(
    `SELECT COUNT(*) AS count FROM note_reviews
     WHERE date(last_reviewed_at, 'localtime') = date('now', 'localtime')`,
  )
  return { due, total, newCount, reviewedToday }
}

export function getReviewQueue(limit = 30): LibraryNote[] {
  const rows = database()
    .prepare(
      `SELECT n.*, b.title AS book_title, c.title AS chapter_title,
              r.due_at AS review_due_at, r.reps AS review_reps
       FROM notes n
       JOIN books b ON b.id = n.book_id
       LEFT JOIN chapters c ON c.id = n.chapter_id
       LEFT JOIN note_reviews r ON r.note_id = n.id
       WHERE ${REVIEWABLE_SQL} AND (r.note_id IS NULL OR r.due_at <= ?)
       ORDER BY CASE WHEN r.note_id IS NULL THEN 1 ELSE 0 END, r.due_at, n.updated_at DESC
       LIMIT ?`,
    )
    .all(new Date().toISOString(), Math.min(Math.max(limit, 1), 100)) as unknown as LibraryRow[]
  return rows.map(mapLibraryNote)
}

export function reviewNote(noteId: string, rating: ReviewRating): void {
  if (rating !== 'again' && rating !== 'hard' && rating !== 'good' && rating !== 'easy') {
    throw new Error('复习评分无效。')
  }
  const conn = database()
  const note = conn.prepare('SELECT kind, content FROM notes WHERE id = ?').get(noteId) as
    | { kind: string; content: string }
    | undefined
  if (!note) throw new Error('笔记不存在。')
  if (!REVIEWABLE_KINDS.has(note.kind as NoteKind) || !note.content.trim()) {
    throw new Error('这条笔记不需要复习。')
  }
  const current = conn.prepare('SELECT * FROM note_reviews WHERE note_id = ?').get(noteId) as
    | {
        due_at: string
        interval_days: number
        ease: number
        reps: number
        lapses: number
      }
    | undefined
  const now = new Date()
  let interval = Number(current?.interval_days ?? 0)
  let ease = Number(current?.ease ?? 2.5)
  let reps = Number(current?.reps ?? 0)
  let lapses = Number(current?.lapses ?? 0)

  if (rating === 'again') {
    interval = 0
    ease = Math.max(1.3, ease - 0.2)
    lapses += 1
    reps = 0
  } else if (rating === 'hard') {
    interval = interval > 0 ? interval * 1.2 : 1
    ease = Math.max(1.3, ease - 0.15)
    reps += 1
  } else if (rating === 'good') {
    interval = interval > 0 ? interval * ease : 1
    reps += 1
  } else {
    interval = interval > 0 ? interval * ease * 1.3 : 3
    ease = Math.min(3, ease + 0.15)
    reps += 1
  }
  interval = Math.min(3650, Math.round(interval * 100) / 100)
  const dueAt =
    rating === 'again'
      ? new Date(now.getTime() + 10 * 60 * 1000)
      : new Date(now.getTime() + interval * 24 * 60 * 60 * 1000)

  conn
    .prepare(
      `INSERT INTO note_reviews (note_id, due_at, interval_days, ease, reps, lapses, last_rating, last_reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(note_id) DO UPDATE SET
         due_at = excluded.due_at,
         interval_days = excluded.interval_days,
         ease = excluded.ease,
         reps = excluded.reps,
         lapses = excluded.lapses,
         last_rating = excluded.last_rating,
         last_reviewed_at = excluded.last_reviewed_at`,
    )
    .run(noteId, dueAt.toISOString(), interval, Math.round(ease * 100) / 100, reps, lapses, rating, now.toISOString())
}

const REVIEWABLE_KINDS = new Set<NoteKind>(['point', 'claim', 'summary', 'question', 'thought'])

export interface NoteForEmbedding {
  id: string
  title: string
  content: string
  tags: string[]
}export interface SemanticNote {
  id: string
  bookId: string
  bookTitle: string
  chapterId: string | null
  chapterTitle: string | null
  title: string
  content: string
  tags: string[]
  vector: number[] | null
  model: string | null
}

export function listNotesForEmbedding(model: string): NoteForEmbedding[] {
  const rows = database()
    .prepare(
      `SELECT n.id, n.title, n.content, n.tags
       FROM notes n
       LEFT JOIN note_embeddings e ON e.note_id = n.id
       WHERE e.note_id IS NULL OR e.model != ?
       ORDER BY n.updated_at`,
    )
    .all(model) as unknown as Array<{ id: string; title: string; content: string; tags: string }>
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    tags: parseTags(row.tags),
  }))
}

export function listSemanticCandidates(bookId: string): SemanticNote[] {
  const rows = database()
    .prepare(
      `SELECT n.id, n.book_id, b.title AS book_title, n.chapter_id, c.title AS chapter_title,
              n.title, n.content, n.tags, e.vector, e.model
       FROM notes n
       JOIN books b ON b.id = n.book_id
       LEFT JOIN chapters c ON c.id = n.chapter_id
       LEFT JOIN note_embeddings e ON e.note_id = n.id
       WHERE n.book_id != ?`,
    )
    .all(bookId) as unknown as Array<{
    id: string
    book_id: string
    book_title: string
    chapter_id: string | null
    chapter_title: string | null
    title: string
    content: string
    tags: string
    vector: string | null
    model: string | null
  }>
  return rows.map((row) => ({
    id: row.id,
    bookId: row.book_id,
    bookTitle: row.book_title,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    title: row.title,
    content: row.content,
    tags: parseTags(row.tags),
    vector: parseVector(row.vector),
    model: row.model,
  }))
}

export function saveNoteEmbedding(noteId: string, model: string, vector: number[]): void {
  database()
    .prepare(
      `INSERT INTO note_embeddings (note_id, model, dim, vector, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(note_id) DO UPDATE SET
         model = excluded.model,
         dim = excluded.dim,
         vector = excluded.vector,
         updated_at = excluded.updated_at`,
    )
    .run(noteId, model, vector.length, JSON.stringify(vector), new Date().toISOString())
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed.filter((tag): tag is string => typeof tag === 'string')
  } catch {
    // 忽略无法解析的旧数据。
  }
  return []
}

function parseVector(raw: string | null): number[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'number')) {
      return parsed as number[]
    }
  } catch {
    // 忽略损坏的向量，下次重新计算。
  }
  return null
}

export function getNote(noteId: string): Note {
  const row = database().prepare('SELECT * FROM notes WHERE id = ?').get(noteId) as unknown as NoteRow | undefined
  if (!row) throw new Error('笔记不存在')
  return mapNote(row)
}

function mapNote(row: NoteRow): Note {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(row.tags) as unknown
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === 'string')
  } catch {
    tags = []
  }
  return {
    id: row.id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    kind: row.kind as NoteKind,
    title: row.title,
    content: row.content,
    quote: row.quote,
    quoteVerified: Number(row.quote_verified) === 1,
    author: row.author as Note['author'],
    edited: Number(row.edited) === 1,
    tags,
    section: row.section,
    importance: row.importance == null ? null : Number(row.importance),
    role: row.role,
    divergences: parseDivergences(row.expansion),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseDivergences(raw: string | null): NoteDivergence[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => {
          const type = normalizeDivergenceType(item.type)
          const text = typeof item.text === 'string' ? item.text.trim() : ''
          return text ? { type, text } : null
        })
        .filter((item): item is NoteDivergence => Boolean(item))
        .slice(0, 3)
    }
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const text = (key: string): string => (typeof record[key] === 'string' ? String(record[key]).trim() : '')
      const legacy: NoteDivergence[] = []
      if (text('counterpoint')) legacy.push({ type: 'boundary', text: text('counterpoint') })
      if (text('connection')) legacy.push({ type: 'crossbook', text: text('connection') })
      const transfer = text('application') || text('example')
      if (transfer) legacy.push({ type: 'transfer', text: transfer })
      return legacy.slice(0, 3)
    }
  } catch {
    // 忽略无法解析的旧数据。
  }
  return []
}

function normalizeDivergenceType(value: unknown): NoteDivergence['type'] {
  return value === 'crossbook' || value === 'transfer' || value === 'boundary' ? value : 'boundary'
}

function parseNoteReport(raw: string | null): NoteReport | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const num = (key: string): number => (typeof record[key] === 'number' ? Number(record[key]) : 0)
    const omittedItems = Array.isArray(record.omittedItems)
      ? record.omittedItems
          .filter(
            (item): item is { text: string; reason: string } =>
              Boolean(item) &&
              typeof item === 'object' &&
              typeof (item as { text?: unknown }).text === 'string',
          )
          .map((item) => ({
            text: item.text,
            reason: typeof item.reason === 'string' ? item.reason : '',
          }))
      : undefined
    return {
      originalChars: num('originalChars'),
      condensedChars: num('condensedChars'),
      ratio: num('ratio'),
      sections: num('sections'),
      cards: num('cards'),
      divergences: num('divergences') || num('expansions'),
      fidelityMissing: num('fidelityMissing'),
      omitted: num('omitted'),
      omittedItems,
      durationMs: num('durationMs'),
      model: typeof record.model === 'string' ? record.model : '',
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
    }
  } catch {
    return null
  }
}

export function createNote(draft: NoteDraft): Note {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  database()
    .prepare(
      `INSERT INTO notes (id, book_id, chapter_id, kind, title, content, quote, quote_verified, author, edited, tags, section, importance, role, expansion, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      draft.bookId,
      draft.chapterId ?? null,
      draft.kind,
      draft.title?.trim() || deriveTitle(draft.kind, draft.content),
      draft.content,
      draft.quote ?? null,
      0,
      'user',
      0,
      JSON.stringify(draft.tags ?? []),
      null,
      null,
      null,
      null,
      now,
      now,
    )
  return getNote(id)
}

export function updateNote(noteId: string, patch: NotePatch): Note {
  const current = getNote(noteId)
  const now = new Date().toISOString()
  const contentTouched = patch.title !== undefined || patch.content !== undefined || patch.quote !== undefined
  const edited = current.author === 'ai' ? (current.edited || contentTouched ? 1 : 0) : 0
  database()
    .prepare('UPDATE notes SET title = ?, content = ?, quote = ?, tags = ?, kind = ?, edited = ?, updated_at = ? WHERE id = ?')
    .run(
      patch.title ?? current.title,
      patch.content ?? current.content,
      patch.quote === undefined ? current.quote : patch.quote,
      JSON.stringify(patch.tags ?? current.tags),
      patch.kind ?? current.kind,
      edited,
      now,
      noteId,
    )
  database().prepare('DELETE FROM note_embeddings WHERE note_id = ?').run(noteId)
  return getNote(noteId)
}

export function deleteNote(noteId: string): void {
  database().prepare('DELETE FROM notes WHERE id = ?').run(noteId)
}

export interface GeneratedNote {
  kind: NoteKind
  title: string
  content: string
  quote: string | null
  quoteVerified: boolean
  tags: string[]
  section?: string | null
  importance?: number | null
  role?: string | null
  divergences?: NoteDivergence[]
}

/** 用新生成的 AI 笔记替换同一章节的旧 AI 笔记，用户编辑过的笔记永远保留。 */
export function replaceAiNotes(chapterId: string, generated: GeneratedNote[]): Note[] {
  const conn = database()
  const now = new Date().toISOString()
  conn.exec('BEGIN')
  try {
    conn.prepare("DELETE FROM notes WHERE chapter_id = ? AND author = 'ai' AND edited = 0").run(chapterId)
    const insert = conn.prepare(
      `INSERT INTO notes (id, book_id, chapter_id, kind, title, content, quote, quote_verified, author, edited, tags, section, importance, role, expansion, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai', 0, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const note of generated) {
      insert.run(
        crypto.randomUUID(),
        chapterBookId(chapterId),
        chapterId,
        note.kind,
        note.title,
        note.content,
        note.quote,
        note.quoteVerified ? 1 : 0,
        JSON.stringify(note.tags),
        note.section ?? null,
        note.importance ?? null,
        note.role ?? null,
        note.divergences && note.divergences.length > 0 ? JSON.stringify(note.divergences) : null,
        now,
        now,
      )
    }
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
  return listNotes(chapterBookId(chapterId), chapterId)
}

function chapterBookId(chapterId: string): string {
  const row = database().prepare('SELECT book_id FROM chapters WHERE id = ?').get(chapterId) as
    | { book_id: string }
    | undefined
  if (!row) throw new Error('章节不存在')
  return row.book_id
}

export function deriveTitle(kind: NoteKind, content: string): string {
  const firstLine = content
    .replace(/^[#>\-\s]+/, '')
    .split('\n')[0]
    ?.trim()
  const head = (firstLine || content.trim()).slice(0, 26)
  if (kind === 'summary') return '本章摘要'
  if (kind === 'question') return head ? `问题 · ${head}` : '阅读问题'
  return head || '未命名笔记'
}
