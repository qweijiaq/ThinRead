import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type {
  BookFormat,
  BookGenre,
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
  ReaderMark,
  ReaderMarkStyle,
  ReaderStyle,
  RelatedNote,
  RemovedPart,
  SearchResult,
  LibraryFilter,
  LibraryNote,
  LabArtifact,
  TagCount,
  ContentApplyAction,
  ContentApplyResult,
  ContentFilter,
  ContentItem,
  ContentKind,
  ContentStatus,
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
  genre: string
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

    CREATE TABLE IF NOT EXISTS reader_marks (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      quote TEXT NOT NULL,
      style TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reader_marks_chapter ON reader_marks(chapter_id, created_at);

    CREATE TABLE IF NOT EXISTS lab_artifacts (
      tool TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'latest',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      meta TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tool, scope)
    );

    CREATE TABLE IF NOT EXISTS lab_artifact_versions (
      id TEXT PRIMARY KEY,
      tool TEXT NOT NULL,
      scope TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      meta TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lab_artifact_versions_tool ON lab_artifact_versions(tool, created_at DESC);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  migrateBooks(db)
  migrateChapters(db)
  migrateNotes(db)
  migrateLabArtifacts(db)
  migrateLabArtifactMetadata(db)
  backfillChapterNoteSnapshots(db)
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

function migrateLabArtifacts(conn: DatabaseSync): void {
  conn
    .prepare(
      `INSERT OR IGNORE INTO lab_artifact_versions (id, tool, scope, title, content, meta, created_at)
       SELECT 'legacy:' || tool || ':' || scope, tool, scope, title, content, meta, updated_at
       FROM lab_artifacts`,
    )
    .run()
}

function migrateLabArtifactMetadata(conn: DatabaseSync): void {
  const columns = new Set(
    (conn.prepare('PRAGMA table_info(lab_artifact_versions)').all() as unknown as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  )
  const additions: Array<[string, string]> = [
    ['kind', 'TEXT'],
    ['book_id', 'TEXT'],
    ['chapter_id', 'TEXT'],
    ['favorite', 'INTEGER NOT NULL DEFAULT 0'],
    ['status', "TEXT NOT NULL DEFAULT 'draft'"],
    ['updated_at', 'TEXT'],
    ['deleted_at', 'TEXT'],
    ['applied_note_id', 'TEXT'],
    ['current_at', 'TEXT'],
  ]
  for (const [name, ddl] of additions) {
    if (!columns.has(name)) conn.exec(`ALTER TABLE lab_artifact_versions ADD COLUMN ${name} ${ddl}`)
  }
  conn.exec("UPDATE lab_artifact_versions SET kind = tool WHERE kind IS NULL OR kind = ''")
  const kindRows = conn.prepare('SELECT id, tool, kind FROM lab_artifact_versions').all() as unknown as Array<{
    id: string
    tool: string
    kind: string | null
  }>
  const validKinds = new Set(['report', 'chat', 'quiz', 'notes', 'format', 'compose', 'suggestion', 'pdf', 'graph', 'other'])
  const updateKind = conn.prepare('UPDATE lab_artifact_versions SET kind = ? WHERE id = ?')
  for (const row of kindRows) {
    if (!validKinds.has(row.kind ?? '')) updateKind.run(contentKindForTool(row.tool), row.id)
  }
  conn.exec("UPDATE lab_artifact_versions SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''")
  conn.exec(
    'CREATE INDEX IF NOT EXISTS idx_lab_artifact_versions_content ON lab_artifact_versions(status, updated_at DESC)',
  )
  conn.exec(
    'CREATE INDEX IF NOT EXISTS idx_lab_artifact_versions_scope ON lab_artifact_versions(tool, scope, updated_at DESC)',
  )
  backfillArtifactSources(conn)
}

function backfillChapterNoteSnapshots(conn: DatabaseSync): void {
  const chapters = conn
    .prepare(
      `SELECT DISTINCT n.book_id, n.chapter_id, c.title AS chapter_title, b.title AS book_title, c.note_report
       FROM notes n
       JOIN chapters c ON c.id = n.chapter_id
       JOIN books b ON b.id = n.book_id
       WHERE n.author = 'ai' AND n.chapter_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM lab_artifact_versions a
           WHERE a.tool = 'chapter-notes' AND a.chapter_id = n.chapter_id
         )`,
    )
    .all() as unknown as Array<{
    book_id: string
    chapter_id: string
    chapter_title: string
    book_title: string
    note_report: string | null
  }>
  if (chapters.length === 0) return
  const insert = conn.prepare(
    `INSERT INTO lab_artifact_versions
       (id, tool, scope, title, content, meta, created_at, kind, book_id, chapter_id, favorite, status, updated_at, applied_note_id)
     VALUES (?, 'chapter-notes', ?, ?, ?, ?, ?, 'notes', ?, ?, 0, 'draft', ?, NULL)`,
  )
  const now = new Date().toISOString()
  for (const row of chapters) {
    const notes = listNotes(row.book_id, row.chapter_id).filter((note) => note.author === 'ai')
    if (notes.length === 0) continue
    const report = parseNoteReport(row.note_report)
    insert.run(
      crypto.randomUUID(),
      `chapter:${row.chapter_id}`,
      `${row.book_title} · ${row.chapter_title} · 笔记`,
      JSON.stringify({ notes, report }),
      JSON.stringify({ bookId: row.book_id, chapterId: row.chapter_id, chapterTitle: row.chapter_title }),
      now,
      row.book_id,
      row.chapter_id,
      now,
    )
  }
}

function backfillArtifactSources(conn: DatabaseSync): void {
  const rows = conn
    .prepare(
      "SELECT id, scope, tool, meta FROM lab_artifact_versions WHERE book_id IS NULL OR chapter_id IS NULL",
    )
    .all() as unknown as Array<{ id: string; scope: string; tool: string; meta: string | null }>
  if (rows.length === 0) return
  const update = conn.prepare(
    'UPDATE lab_artifact_versions SET book_id = COALESCE(?, book_id), chapter_id = COALESCE(?, chapter_id), kind = COALESCE(kind, ?) WHERE id = ?',
  )
  for (const row of rows) {
    const source = artifactSource(row.tool, row.scope, row.meta)
    update.run(source.bookId, source.chapterId, contentKindForTool(row.tool), row.id)
  }
}

function migrateBooks(conn: DatabaseSync): void {
  const columns = new Set(
    (conn.prepare('PRAGMA table_info(books)').all() as unknown as Array<{ name: string }>).map((row) => row.name),
  )
  if (!columns.has('style_json')) conn.exec('ALTER TABLE books ADD COLUMN style_json TEXT')
  if (!columns.has('genre')) conn.exec("ALTER TABLE books ADD COLUMN genre TEXT NOT NULL DEFAULT 'auto'")
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

/** 用 SQLite 自己的 VACUUM INTO 做一致性快照，避免直接复制 WAL 中的半写状态。 */
export function backupDatabaseTo(filePath: string): void {
  const target = path.resolve(filePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (fs.existsSync(target)) fs.rmSync(target, { force: true })
  const escaped = target.replace(/'/g, "''")
  database().exec(`VACUUM INTO '${escaped}'`)
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
  conn.exec('BEGIN')
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
  conn.exec('BEGIN')
  try {
    conn
      .prepare(
        'INSERT INTO books (id, title, author, format, file_path, created_at, last_opened_at, current_chapter_id, style_json) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)',
      )
      .run(newBookId, cleanTitle(title || `${source.title} · 下篇`, '书名'), source.author, 'text', filePath, now)
    moved.forEach((chapter, index) => {
      conn.prepare('UPDATE chapters SET book_id = ?, idx = ? WHERE id = ?').run(newBookId, index, chapter.id)
      conn.prepare('UPDATE notes SET book_id = ? WHERE chapter_id = ?').run(newBookId, chapter.id)
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

const BOOK_SELECT = `SELECT b.*,
  (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id AND c.hidden = 0) AS chapter_count,
  (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id AND c.hidden = 1) AS hidden_chapter_count,
  (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id AND c.hidden = 0
     AND c.idx <= COALESCE((SELECT cc.idx FROM chapters cc WHERE cc.id = b.current_chapter_id), -1)) AS read_count,
  (SELECT COUNT(*) FROM notes n WHERE n.book_id = b.id) AS note_count,
  (SELECT COALESCE(SUM(c.chars), 0) FROM chapters c WHERE c.book_id = b.id AND c.hidden = 0) AS total_chars,
  (SELECT COALESCE(SUM(c.chars), 0) FROM chapters c WHERE c.book_id = b.id AND c.hidden = 0
     AND c.idx <= COALESCE((SELECT cc.idx FROM chapters cc WHERE cc.id = b.current_chapter_id), -1)) AS read_chars,
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

export function renameBook(bookId: string, title: string): BookSummary {
  const clean = cleanTitle(title, '书名')
  const result = database().prepare('UPDATE books SET title = ? WHERE id = ?').run(clean, bookId)
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

export function listChapterMarks(chapterId: string): ReaderMark[] {
  const rows = database()
    .prepare('SELECT * FROM reader_marks WHERE chapter_id = ? ORDER BY created_at, rowid')
    .all(chapterId) as unknown as Array<{
    id: string
    book_id: string
    chapter_id: string
    quote: string
    style: ReaderMarkStyle
    created_at: string
  }>
  return rows.map((row) => ({
    id: row.id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    quote: row.quote,
    style: row.style,
    createdAt: row.created_at,
  }))
}

export function createChapterMark(input: { chapterId: string; quote: string; style: ReaderMarkStyle }): ReaderMark {
  const quote = input.quote.replace(/\s+/g, ' ').trim()
  if (!quote) throw new Error('没有选中文字。')
  if (quote.length > 4000) throw new Error('选中的文字太长。')
  const style: ReaderMarkStyle =
    input.style === 'underline' || input.style === 'strikethrough' ? input.style : 'highlight'
  const chapter = database().prepare('SELECT book_id FROM chapters WHERE id = ?').get(input.chapterId) as
    | { book_id: string }
    | undefined
  if (!chapter) throw new Error('找不到这一章。')
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  database()
    .prepare('INSERT INTO reader_marks (id, book_id, chapter_id, quote, style, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, chapter.book_id, input.chapterId, quote, style, now)
  return { id, bookId: chapter.book_id, chapterId: input.chapterId, quote, style, createdAt: now }
}

export function deleteChapterMark(id: string): void {
  database().prepare('DELETE FROM reader_marks WHERE id = ?').run(id)
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

  const contents = conn
    .prepare(
      `SELECT a.id, a.tool, a.title, a.content, a.updated_at,
              COALESCE(a.book_id, c.book_id) AS book_id, COALESCE(b.title, cb.title) AS book_title,
              a.chapter_id, c.title AS chapter_title
       FROM lab_artifact_versions a
       LEFT JOIN chapters c ON c.id = a.chapter_id
       LEFT JOIN books b ON b.id = a.book_id
       LEFT JOIN books cb ON cb.id = c.book_id
       WHERE a.status != 'deleted'
         AND (a.title LIKE ? ESCAPE '\\' OR a.content LIKE ? ESCAPE '\\')
       ORDER BY CASE WHEN a.title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, a.updated_at DESC
       LIMIT 12`,
    )
    .all(like, like, like) as unknown as Array<{
    id: string
    tool: string
    title: string
    content: string
    updated_at: string
    book_id: string | null
    book_title: string | null
    chapter_id: string | null
    chapter_title: string | null
  }>
  for (const row of contents) {
    results.push({
      type: 'content',
      id: row.id,
      bookId: row.book_id ?? '',
      bookTitle: row.book_title ?? '生成内容',
      chapterId: row.chapter_id,
      chapterTitle: row.chapter_title,
      title: row.title,
      snippet: makeSnippet(readableArtifactContent(row.tool, row.content), query),
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


interface LibraryRow extends NoteRow {
  book_title: string
  chapter_title: string | null
}

function libraryRows(): LibraryRow[] {
  return database()
    .prepare(
      `SELECT n.*, b.title AS book_title, c.title AS chapter_title
       FROM notes n
       JOIN books b ON b.id = n.book_id
       LEFT JOIN chapters c ON c.id = n.chapter_id
       ORDER BY n.updated_at DESC, n.rowid DESC`,
    )
    .all() as unknown as LibraryRow[]
}

function mapLibraryNote(row: LibraryRow): LibraryNote {
  return {
    ...mapNote(row),
    bookTitle: row.book_title,
    chapterTitle: row.chapter_title,
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

const CHAT_TOOL_IDS = new Set([
  'author-roundtable',
  'library-research',
  'devils-advocate',
  'book-club',
  'chapter-chat',
  'feynman',
])
const REPORT_TOOL_IDS = new Set([
  'cross-book-synthesis',
  'weekly-review',
  'reading-path',
  'annual-report',
  'argument-map',
  'chapter-annotations',
  'margin-note',
  'view-timeline',
  'knowledge-gaps',
  'fact-check',
  'podcast',
])

export function contentKindForTool(tool: string): ContentKind {
  if (tool === 'book-compose') return 'compose'
  if (tool === 'chapter-notes') return 'notes'
  if (tool === 'chapter-format') return 'format'
  if (tool === 'adaptive-quiz') return 'quiz'
  if (tool === 'lab-dedupe' || tool === 'lab-merge') return 'suggestion'
  if (tool === 'lab-pdf-page') return 'pdf'
  if (tool === 'relation-graph') return 'graph'
  if (CHAT_TOOL_IDS.has(tool)) return 'chat'
  if (REPORT_TOOL_IDS.has(tool)) return 'report'
  return 'other'
}

function parseMetaObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function artifactSource(
  tool: string,
  scope: string,
  meta: string | null,
): { bookId: string | null; chapterId: string | null } {
  const parsed = parseMetaObject(meta)
  let chapterId = typeof parsed.chapterId === 'string' && parsed.chapterId ? parsed.chapterId : null
  let bookId = typeof parsed.bookId === 'string' && parsed.bookId ? parsed.bookId : null
  const chapterMatch = scope.match(/^chapter:(.+)$/)
  if (!chapterId && chapterMatch) chapterId = chapterMatch[1]!
  if (chapterId) {
    const row = database().prepare('SELECT book_id FROM chapters WHERE id = ?').get(chapterId) as
      | { book_id: string }
      | undefined
    if (row) bookId = bookId ?? row.book_id
    else if (!chapterMatch && !chapterId) chapterId = null
  }
  if (!bookId && scope) {
    // 章节问答 / 出题 / 费曼的 scope 直接就是章节 id。
    const chapterRow = database().prepare('SELECT id, book_id FROM chapters WHERE id = ?').get(scope) as
      | { id: string; book_id: string }
      | undefined
    if (chapterRow) {
      chapterId = chapterRow.id
      bookId = chapterRow.book_id
    }
  }
  if (!bookId) {
    const bookMatch = scope.match(/^book:(.+)$/)
    const booksMatch = scope.match(/^books:(.+)$/)
    const pdfMatch = scope.match(/^pdf:([^:]+):/)
    if (bookMatch) bookId = bookMatch[1]!
    else if (booksMatch) bookId = booksMatch[1]!.split(',')[0]!.trim() || null
    else if (pdfMatch) bookId = pdfMatch[1]!
  }
  if (tool === 'book-compose' && !bookId) {
    const bookMatch = scope.match(/^book:(.+)$/)
    if (bookMatch) bookId = bookMatch[1]!
  }
  return { bookId, chapterId }
}

export function getLabArtifact(tool: string, scope = 'latest'): LabArtifact | null {
  const conn = database()
  let row = (scope === 'latest'
    ? conn
        .prepare(
          "SELECT * FROM lab_artifact_versions WHERE tool = ? AND status != 'deleted' ORDER BY COALESCE(current_at, created_at) DESC LIMIT 1",
        )
        .get(tool)
    : conn
        .prepare(
          "SELECT * FROM lab_artifact_versions WHERE tool = ? AND scope = ? AND status != 'deleted' ORDER BY COALESCE(current_at, created_at) DESC LIMIT 1",
        )
        .get(tool, scope)) as LabArtifactRow | undefined
  // 兼容旧版本只保存 latest 的结果：新作用域没有记录时回退到旧结果。
  if (!row && scope !== 'latest') {
    row = conn
      .prepare(
        "SELECT * FROM lab_artifact_versions WHERE tool = ? AND scope = 'latest' AND status != 'deleted' ORDER BY COALESCE(current_at, created_at) DESC LIMIT 1",
      )
      .get(tool) as LabArtifactRow | undefined
  }
  return row ? mapLabArtifact(row) : null
}

export function getLabArtifactById(id: string): LabArtifact | null {
  const row = database().prepare('SELECT * FROM lab_artifact_versions WHERE id = ?').get(id) as
    | LabArtifactRow
    | undefined
  return row ? mapLabArtifact(row) : null
}

interface LabArtifactRow {
  id: string
  tool: string
  scope: string
  title: string
  content: string
  meta: string | null
  created_at: string
  kind: string | null
  book_id: string | null
  chapter_id: string | null
  favorite: number | null
  status: string | null
  updated_at: string | null
  deleted_at: string | null
  applied_note_id: string | null
  current_at: string | null
}

interface ContentRow extends LabArtifactRow {
  book_title: string | null
  chapter_title: string | null
}

export function listLabArtifacts(tool: string, limit = 30): LabArtifact[] {
  const rows = database()
    .prepare(
      "SELECT * FROM lab_artifact_versions WHERE tool = ? AND status != 'deleted' ORDER BY COALESCE(current_at, created_at) DESC LIMIT ?",
    )
    .all(tool, Math.min(Math.max(limit, 1), 100)) as unknown as LabArtifactRow[]
  return rows.map(mapLabArtifact)
}

export function saveLabArtifact(input: {
  tool: string
  scope: string
  title: string
  content: string
  meta?: string | null
  kind?: ContentKind
  bookId?: string | null
  chapterId?: string | null
}): LabArtifact {
  const tool = input.tool.trim()
  const scope = input.scope.trim() || 'latest'
  const title = input.title.trim() || 'AI 结果'
  if (!tool) throw new Error('工具无效。')
  if (typeof input.content !== 'string') throw new Error('生成内容无效。')
  const source = artifactSource(tool, scope, input.meta ?? null)
  const kind = input.kind ?? contentKindForTool(tool)
  const bookId = input.bookId !== undefined ? input.bookId : source.bookId
  const chapterId = input.chapterId !== undefined ? input.chapterId : source.chapterId
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  database()
    .prepare(
      `INSERT INTO lab_artifact_versions
         (id, tool, scope, title, content, meta, created_at, kind, book_id, chapter_id, favorite, status, updated_at, applied_note_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'draft', ?, NULL)`,
    )
    .run(id, tool, scope, title, input.content, input.meta ?? null, now, kind, bookId, chapterId, now)
  return {
    id,
    tool,
    scope,
    title,
    content: input.content,
    meta: input.meta ?? null,
    createdAt: now,
  }
}

export function updateLabArtifact(
  id: string,
  patch: { title?: string; content?: string; meta?: string | null },
): LabArtifact {
  const current = getLabArtifactById(id)
  if (!current) throw new Error('找不到这份生成内容。')
  const title = patch.title?.trim() || current.title
  const content = typeof patch.content === 'string' ? patch.content : current.content
  const meta = patch.meta !== undefined ? patch.meta : current.meta
  database()
    .prepare('UPDATE lab_artifact_versions SET title = ?, content = ?, meta = ?, updated_at = ? WHERE id = ?')
    .run(title, content, meta, new Date().toISOString(), id)
  const updated = getLabArtifactById(id)
  if (!updated) throw new Error('更新生成内容失败。')
  return updated
}

function mapLabArtifact(row: LabArtifactRow): LabArtifact {
  return {
    id: row.id,
    tool: row.tool,
    scope: row.scope,
    title: row.title,
    content: row.content,
    meta: row.meta,
    createdAt: row.created_at,
  }
}

function mapContentItem(row: ContentRow): ContentItem {
  return {
    ...mapLabArtifact(row),
    kind: (row.kind || contentKindForTool(row.tool)) as ContentKind,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    bookTitle: row.book_title,
    chapterTitle: row.chapter_title,
    favorite: Number(row.favorite ?? 0) === 1,
    status: (row.status || 'draft') as ContentStatus,
    updatedAt: row.updated_at || row.created_at,
    appliedNoteId: row.applied_note_id,
  }
}

function contentSelect(): string {
  return `SELECT a.*, b.title AS book_title, c.title AS chapter_title
          FROM lab_artifact_versions a
          LEFT JOIN chapters c ON c.id = a.chapter_id
          LEFT JOIN books b ON b.id = COALESCE(a.book_id, c.book_id)`
}

export function listContent(filter: ContentFilter = {}): ContentItem[] {
  const where: string[] = []
  const params: Array<string | number | null> = []
  const status = filter.status ?? 'active'
  if (status === 'active') where.push("a.status NOT IN ('archived', 'deleted')")
  else if (status !== 'all') {
    where.push('a.status = ?')
    params.push(status)
  }
  if (filter.favorite) where.push('a.favorite = 1')
  if (filter.kind) {
    where.push('a.kind = ?')
    params.push(filter.kind)
  }
  if (filter.tool) {
    where.push('a.tool = ?')
    params.push(filter.tool)
  }
  if (filter.bookId) {
    where.push('COALESCE(a.book_id, c.book_id) = ?')
    params.push(filter.bookId)
  }
  if (filter.chapterId) {
    where.push('a.chapter_id = ?')
    params.push(filter.chapterId)
  }
  if (filter.query?.trim()) {
    const escaped = filter.query.trim().replace(/[\\%_]/g, (char) => `\\${char}`)
    const like = `%${escaped}%`
    where.push("(a.title LIKE ? ESCAPE '\\' OR a.content LIKE ? ESCAPE '\\')")
    params.push(like, like)
  }
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 300)
  const rows = database()
    .prepare(`${contentSelect()} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.updated_at DESC, a.created_at DESC LIMIT ?`)
    .all(...params, limit) as unknown as ContentRow[]
  return rows.map(mapContentItem)
}

export function getContent(id: string): ContentItem | null {
  const row = database().prepare(`${contentSelect()} WHERE a.id = ?`).get(id) as ContentRow | undefined
  return row ? mapContentItem(row) : null
}

export function setContentFavorite(id: string, favorite: boolean): ContentItem {
  database().prepare('UPDATE lab_artifact_versions SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, id)
  const item = getContent(id)
  if (!item) throw new Error('找不到这份生成内容。')
  return item
}

export function setContentStatus(id: string, status: ContentStatus): ContentItem {
  if (status !== 'draft' && status !== 'adopted' && status !== 'archived' && status !== 'deleted') {
    throw new Error('内容状态无效。')
  }
  database()
    .prepare('UPDATE lab_artifact_versions SET status = ?, deleted_at = ?, updated_at = ? WHERE id = ?')
    .run(status, status === 'deleted' ? new Date().toISOString() : null, new Date().toISOString(), id)
  const item = getContent(id)
  if (!item) throw new Error('找不到这份生成内容。')
  return item
}

export function deleteContent(id: string): void {
  setContentStatus(id, 'deleted')
}

function readableArtifactContent(tool: string, content: string): string {
  const kind = contentKindForTool(tool)
  return contentAsMarkdown({
    id: '',
    tool,
    scope: '',
    title: '',
    content,
    meta: null,
    createdAt: '',
    kind,
    bookId: null,
    chapterId: null,
    bookTitle: null,
    chapterTitle: null,
    favorite: false,
    status: 'draft',
    updatedAt: '',
    appliedNoteId: null,
  })
}

export function contentAsMarkdown(item: ContentItem): string {
  if (item.kind === 'chat') {
    try {
      const parsed = JSON.parse(item.content) as { turns?: Array<{ role?: string; content?: string }> }
      if (Array.isArray(parsed.turns)) {
        return parsed.turns
          .map((turn) => `**${turn.role === 'user' ? '我' : '助手'}**：${turn.content ?? ''}`)
          .join('\n\n')
      }
    } catch {
      // 旧格式。
    }
  }
  if (item.kind === 'quiz') {
    try {
      const parsed = JSON.parse(item.content) as {
        quiz?: { questions?: Array<Record<string, unknown>> }
        questions?: Array<Record<string, unknown>>
      }
      const questions = parsed.quiz?.questions ?? parsed.questions
      if (Array.isArray(questions)) {
        return questions
          .map((question, index) => {
            const title = typeof question.question === 'string' ? question.question : ''
            const answer = typeof question.answer === 'string' ? question.answer : ''
            const source = typeof question.source === 'string' ? question.source : ''
            return `${index + 1}. **${title}**\n\n参考答案：${answer}${source ? `\n\n依据：${source}` : ''}`
          })
          .join('\n\n')
      }
    } catch {
      // 旧格式。
    }
  }
  if (item.kind === 'notes') {
    try {
      const parsed = JSON.parse(item.content) as { notes?: Array<Record<string, unknown>> }
      if (Array.isArray(parsed.notes)) {
        return parsed.notes
          .filter((note) => typeof note.content === 'string' && note.content.trim())
          .map((note) => {
            const title = typeof note.title === 'string' ? note.title : ''
            return `${title ? `### ${title}\n\n` : ''}${note.content as string}`
          })
          .join('\n\n')
      }
    } catch {
      // 旧格式。
    }
  }
  if (item.kind === 'graph') {
    try {
      const parsed = JSON.parse(item.content) as {
        title?: string
        genre?: string
        summary?: string
        plot?: string
        nodes?: Array<{ label?: string; kind?: string; role?: string; importance?: number; identity?: string; rank?: string; affiliation?: string; aliases?: string[]; realWorld?: boolean; encyclopedia?: string; description?: string }>
        edges?: Array<{ source?: string; target?: string; label?: string; description?: string }>
      }
      if (Array.isArray(parsed.nodes)) {
        return [
          parsed.title ? `# ${parsed.title}` : '',
          parsed.genre ? `体裁：${parsed.genre}` : '',
          parsed.summary ?? '',
          parsed.plot ?? '',
          '## 节点',
          ...parsed.nodes.map((node) => {
            const facts = [node.identity, node.rank, node.affiliation].filter(Boolean).join(' / ')
            const wiki = node.encyclopedia ? `\n  百科：${node.encyclopedia}` : ''
            return `- ${node.label ?? '未命名'}（${node.kind ?? 'other'}${node.role ? ` · ${node.role}` : ''}${node.importance ? ` · 重要度 ${node.importance}` : ''}${facts ? ` · ${facts}` : ''}）：${node.description ?? ''}${wiki}`
          }),
          '## 关系',
          ...(parsed.edges ?? []).map((edge) => `- ${edge.source ?? ''} — ${edge.label ?? '关系'} — ${edge.target ?? ''}${edge.description ? `：${edge.description}` : ''}`),
        ]
          .filter(Boolean)
          .join('\n')
      }
    } catch {
      // 旧格式直接显示原文。
    }
  }
  if (item.kind === 'compose') {
    try {
      const parsed = JSON.parse(item.content) as { markdown?: string }
      if (typeof parsed.markdown === 'string') return parsed.markdown
    } catch {
      // 旧格式。
    }
  }
  if (item.kind === 'pdf') {
    try {
      const parsed = JSON.parse(item.content) as { result?: { markdown?: string } }
      if (typeof parsed.result?.markdown === 'string') return parsed.result.markdown
    } catch {
      // 旧格式。
    }
  }
  if (item.kind === 'format') {
    try {
      const parsed = JSON.parse(item.content) as { note?: string }
      if (typeof parsed.note === 'string' && parsed.note.trim()) return parsed.note
    } catch {
      // 旧格式。
    }
  }
  return item.content
}

export function applyContent(id: string, action: ContentApplyAction): ContentApplyResult {
  const item = getContent(id)
  if (!item || item.status === 'deleted') throw new Error('这份生成内容已经删除。')

  if (action === 'current') {
    database()
      .prepare("UPDATE lab_artifact_versions SET current_at = ?, status = 'adopted', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), new Date().toISOString(), id)
    return { appliedTo: 'current', message: '已设为当前内容。' }
  }

  if (action === 'source') {
    if (!item.chapterId) throw new Error('这份内容没有关联章节。')
    if (item.kind === 'format') {
      const parsed = JSON.parse(item.content) as { html?: string; removed?: RemovedPart[]; style?: ReaderStyle }
      if (typeof parsed.html !== 'string' || !parsed.html.trim()) throw new Error('这份排版没有可应用的正文。')
      saveChapterFormat(item.chapterId, parsed.html, Array.isArray(parsed.removed) ? parsed.removed : [])
      if (parsed.style && item.bookId) saveBookStyle(item.bookId, parsed.style)
      database()
        .prepare("UPDATE lab_artifact_versions SET status = 'adopted', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), id)
      return { appliedTo: 'chapter', chapterId: item.chapterId, message: '排版已应用到章节。' }
    }
    if (item.kind === 'notes') {
      const parsed = JSON.parse(item.content) as { notes?: Note[]; report?: NoteReport | null }
      if (!Array.isArray(parsed.notes) || parsed.notes.length === 0) throw new Error('这份记录没有可恢复的笔记。')
      const generated: GeneratedNote[] = parsed.notes.map((note) => ({
        kind: note.kind,
        title: note.title,
        content: note.content,
        quote: note.quote,
        quoteVerified: note.quoteVerified,
        tags: note.tags,
        section: note.section,
        importance: note.importance,
        role: note.role,
        divergences: note.divergences,
      }))
      replaceAiNotes(item.chapterId, generated)
      if (parsed.report) saveNoteReport(item.chapterId, parsed.report)
      database()
        .prepare("UPDATE lab_artifact_versions SET status = 'adopted', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), id)
      return { appliedTo: 'chapter', chapterId: item.chapterId, message: '这组笔记已恢复到章节。' }
    }
    throw new Error('这份内容不能直接应用到来源章节。')
  }

  if (action === 'note') {
    if (item.appliedNoteId) {
      try {
        const existing = getNote(item.appliedNoteId)
        return { appliedTo: 'note', noteId: existing.id, message: '这份内容已经存为笔记。' }
      } catch {
        // 原笔记已删除，重新存一份。
      }
    }
    const bookId = item.bookId ?? (listBooks()[0]?.id ?? null)
    if (!bookId) throw new Error('还没有可以存放笔记的书。')
    const note = createNote({
      bookId,
      chapterId: item.chapterId,
      kind: 'summary',
      title: item.title,
      content: contentAsMarkdown(item),
    })
    database()
      .prepare("UPDATE lab_artifact_versions SET status = 'adopted', applied_note_id = ?, updated_at = ? WHERE id = ?")
      .run(note.id, new Date().toISOString(), id)
    return { appliedTo: 'note', noteId: note.id, message: '已存为笔记。' }
  }

  return { appliedTo: 'none', message: '没有执行任何操作。' }
}

export function mergeNoteTags(tags: string[], canonical: string): number {
  const wanted = new Set(tags.map((tag) => tag.trim()).filter(Boolean))
  const target = canonical.trim()
  if (wanted.size === 0 || !target) return 0
  const conn = database()
  const rows = conn.prepare('SELECT id, tags FROM notes').all() as unknown as Array<{ id: string; tags: string }>
  let changed = 0
  const now = new Date().toISOString()
  conn.exec('BEGIN')
  try {
    for (const row of rows) {
      const current = parseTags(row.tags)
      if (!current.some((tag) => wanted.has(tag))) continue
      const next = [...new Set(current.map((tag) => (wanted.has(tag) ? target : tag)))]
      conn.prepare('UPDATE notes SET tags = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), now, row.id)
      conn.prepare('DELETE FROM note_embeddings WHERE note_id = ?').run(row.id)
      changed += 1
    }
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
  return changed
}

export function mergeNotes(keepId: string, mergeId: string): Note {
  if (keepId === mergeId) throw new Error('不能合并同一张卡片。')
  const keep = getNote(keepId)
  const duplicate = getNote(mergeId)
  if (keep.bookId !== duplicate.bookId) throw new Error('只能合并同一本书里的卡片。')
  if (!keep.chapterId || keep.chapterId !== duplicate.chapterId) {
    throw new Error('只能合并同一章里的卡片，跨章相近内容请保留为相关笔记。')
  }
  if ((keep.kind !== 'point' && keep.kind !== 'claim') || (duplicate.kind !== 'point' && duplicate.kind !== 'claim')) {
    throw new Error('只能合并知识点或论点卡片。')
  }
  const content = duplicate.content && !keep.content.includes(duplicate.content)
    ? [keep.content, duplicate.content].filter(Boolean).join('\n\n')
    : keep.content
  const tags = [...new Set([...keep.tags, ...duplicate.tags])]
  const divergences = [...keep.divergences, ...duplicate.divergences]
    .filter((item, index, list) => list.findIndex((other) => other.type === item.type && other.text === item.text) === index)
    .slice(0, 3)
  const quote = keep.quote || duplicate.quote
  const quoteVerified = keep.quote ? keep.quoteVerified : duplicate.quoteVerified
  const role = keep.role || duplicate.role
  const section = keep.section || duplicate.section
  const importance = Math.max(keep.importance ?? 0, duplicate.importance ?? 0) || null
  const now = new Date().toISOString()
  const conn = database()
  conn.exec('BEGIN')
  try {
    conn
      .prepare(
        `UPDATE notes SET content = ?, quote = ?, quote_verified = ?, tags = ?, section = ?, importance = ?,
         role = ?, expansion = ?, edited = 1, updated_at = ? WHERE id = ?`,
      )
      .run(
        content,
        quote,
        quoteVerified ? 1 : 0,
        JSON.stringify(tags),
        section,
        importance,
        role,
        divergences.length > 0 ? JSON.stringify(divergences) : null,
        now,
        keepId,
      )
    conn.prepare('DELETE FROM notes WHERE id = ?').run(mergeId)
    conn.prepare('DELETE FROM note_embeddings WHERE note_id = ?').run(keepId)
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
  return getNote(keepId)
}

export interface MapNote {
  id: string
  bookId: string
  bookTitle: string
  chapterId: string | null
  chapterTitle: string | null
  title: string
  kind: NoteKind
  tags: string[]
  importance: number
  updatedAt: string
  content: string
  preview: string
  vector: number[] | null
}

export function listMapNotes(limit = 300): { notes: MapNote[]; total: number } {
  const conn = database()
  const totalRow = conn.prepare('SELECT COUNT(*) AS count FROM notes').get() as { count: number } | undefined
  const rows = conn
    .prepare(
      `SELECT n.id, n.book_id, b.title AS book_title, n.chapter_id, c.title AS chapter_title,
              n.title, n.content, n.kind, n.tags, n.importance, n.updated_at, e.vector
       FROM notes n
       JOIN books b ON b.id = n.book_id
       LEFT JOIN chapters c ON c.id = n.chapter_id
       LEFT JOIN note_embeddings e ON e.note_id = n.id
       ORDER BY CASE WHEN n.importance IS NULL THEN 1 ELSE 0 END, n.importance DESC, n.updated_at DESC
       LIMIT ?`,
    )
    .all(Math.min(Math.max(limit, 1), 500)) as unknown as Array<{
    id: string
    book_id: string
    book_title: string
    chapter_id: string | null
    chapter_title: string | null
    title: string
    kind: string
    tags: string
    importance: number | null
    updated_at: string
    vector: string | null
    content: string
  }>
  return {
    total: Number(totalRow?.count ?? 0),
    notes: rows.map((row) => ({
      id: row.id,
      bookId: row.book_id,
      bookTitle: row.book_title,
      chapterId: row.chapter_id,
      chapterTitle: row.chapter_title,
      title: row.title,
      kind: row.kind as NoteKind,
      tags: parseTags(row.tags),
      importance: row.importance == null ? 2 : Number(row.importance),
      updatedAt: row.updated_at,
      content: row.content,
      preview: row.content.replace(/\s+/g, ' ').trim().slice(0, 180),
      vector: parseVector(row.vector),
    })),
  }
}

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
  const head = (firstLine || content.trim()).slice(0, kind === 'point' || kind === 'claim' ? 60 : 26)
  if (kind === 'summary') return '本章摘要'
  if (kind === 'question') return head ? `问题 · ${head}` : '阅读问题'
  return head || '未命名笔记'
}
