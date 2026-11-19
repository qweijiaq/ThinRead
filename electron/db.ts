import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { closeDatabase, getDatabase, setDatabase } from './database.js'
import { artifactSource, contentAsMarkdown, contentKindForTool, getContent } from './db-content.js'
import { getBookStyle, getChapter, listBooks, saveBookStyle, saveChapterFormat } from './db-books.js'
import { createNote, getNote, listNotes, parseNoteReport, replaceAiNotes, saveNoteReport } from './db-notes.js'
import { migrateWeeklyReviewNotes } from './db-reading.js'
import { markInterruptedBackgroundTasksPaused, pruneBackgroundTasks } from './tasks.js'
export { closeDatabase }
export { getDataHealth } from './db-health.js'
export * from './db-books.js'
export * from './db-content.js'
export * from './db-notes.js'
export * from './db-reading.js'
export * from './tasks.js'

import type { ContentApplyAction, ContentApplyResult, GeneratedNote } from '../shared/types.js'

import { formatArtifactSchema, notesArtifactSchema } from '../shared/schemas.js'


export function initDatabase(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true })
  const conn = new DatabaseSync(path.join(dataDir, 'reading-notes.db'))
  setDatabase(conn)
  conn.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

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
      translated_text TEXT,
      translated_html TEXT,
      translated_at TEXT,
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

    CREATE TABLE IF NOT EXISTS ocr_jobs (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_page INTEGER NOT NULL DEFAULT 1,
      end_page INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running',
      current INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ocr_jobs_updated ON ocr_jobs(updated_at DESC);

    CREATE TABLE IF NOT EXISTS reading_positions (
      chapter_id TEXT PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      scroll_ratio REAL NOT NULL DEFAULT 0,
      scroll_top REAL NOT NULL DEFAULT 0,
      page INTEGER,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reading_positions_book ON reading_positions(book_id);

    CREATE TABLE IF NOT EXISTS reading_stats_days (
      day TEXT PRIMARY KEY,
      seconds INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reading_stats_books (
      book_id TEXT PRIMARY KEY,
      seconds INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reading_stats_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weekly_reviews (
      id TEXT PRIMARY KEY,
      week TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reading_plans (
      book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      plan TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      scroll_ratio REAL NOT NULL DEFAULT 0,
      scroll_top REAL NOT NULL DEFAULT 0,
      page INTEGER,
      label TEXT NOT NULL,
      quote TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_chapter ON bookmarks(chapter_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS pdf_annotations (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      page INTEGER NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT 'yellow',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pdf_annotations_book_page ON pdf_annotations(book_id, page, created_at);

    CREATE TABLE IF NOT EXISTS note_trash (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      book_id TEXT,
      chapter_id TEXT,
      deleted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chapter_trash (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      deleted_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chapter_trash_book ON chapter_trash(book_id, deleted_at DESC);

    CREATE TABLE IF NOT EXISTS background_tasks (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      book_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      failures TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
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
  runMigrations(conn)
  migrateWeeklyReviewNotes()
  markInterruptedBackgroundTasksPaused()
  pruneBackgroundTasks()
}

export const SCHEMA_VERSION = 10

interface SchemaMigration {
  version: number
  run(conn: DatabaseSync): void
}

/** 旧库（user_version=0）一次性补齐当前 schema；以后每次结构变化追加新版本。 */
const MIGRATIONS: SchemaMigration[] = [
  {
    version: 1,
    run(conn) {
      migrateBooks(conn)
      migrateChapters(conn)
      migrateNotes(conn)
      migrateLabArtifacts(conn)
      migrateLabArtifactMetadata(conn)
      backfillChapterNoteSnapshots(conn)
    },
  },
  {
    version: 2,
    run(conn) {
      conn.exec(`
        CREATE TABLE IF NOT EXISTS chapter_trash (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          deleted_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chapter_trash_book ON chapter_trash(book_id, deleted_at DESC);
      `)
    },
  },
  {
    version: 3,
    run(conn) {
      conn.exec(`
        CREATE TABLE IF NOT EXISTS background_tasks (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          book_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL,
          done INTEGER NOT NULL DEFAULT 0,
          total INTEGER NOT NULL DEFAULT 0,
          failures TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `)
    },
  },
  {
    version: 4,
    // 补上列表页、回收站清理和任务查询真正用到的索引。
    run(conn) {
      conn.exec(`
        CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notes_book_updated ON notes(book_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notes_chapter_created ON notes(chapter_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_note_trash_deleted ON note_trash(deleted_at);
        CREATE INDEX IF NOT EXISTS idx_chapter_trash_deleted ON chapter_trash(deleted_at);
        CREATE INDEX IF NOT EXISTS idx_tasks_status_updated ON background_tasks(status, updated_at);
      `)
    },
  },
  {
    version: 5,
    // 整章 AI 译文，用于在原文和译文之间切换。
    run(conn) {
      const columns = new Set(
        (conn.prepare('PRAGMA table_info(chapters)').all() as unknown as Array<{ name: string }>).map((row) => row.name),
      )
      if (!columns.has('translated_text')) conn.exec('ALTER TABLE chapters ADD COLUMN translated_text TEXT')
      if (!columns.has('translated_html')) conn.exec('ALTER TABLE chapters ADD COLUMN translated_html TEXT')
      if (!columns.has('translated_at')) conn.exec('ALTER TABLE chapters ADD COLUMN translated_at TEXT')
    },
  },
  {
    version: 6,
    // 翻译保留 HTML 结构，避免标题和表格在纯文本回退时丢失。
    run(conn) {
      const columns = new Set(
        (conn.prepare('PRAGMA table_info(chapters)').all() as unknown as Array<{ name: string }>).map((row) => row.name),
      )
      if (!columns.has('translated_html')) conn.exec('ALTER TABLE chapters ADD COLUMN translated_html TEXT')
    },
  },
  {
    version: 7,
    // 书籍级回收站：删除整本书时保留 30 天，避免只能回滚整库备份。
    run(conn) {
      conn.exec(`
        CREATE TABLE IF NOT EXISTS book_trash (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          file_dir TEXT NOT NULL,
          deleted_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_book_trash_deleted ON book_trash(deleted_at);
      `)
    },
  },
  {
    version: 8,
    // 书架状态：待读 / 在读 / 读完 / 归档。
    run(conn) {
      const columns = new Set(
        (conn.prepare('PRAGMA table_info(books)').all() as unknown as Array<{ name: string }>).map((row) => row.name),
      )
      if (!columns.has('shelf_status')) {
        conn.exec("ALTER TABLE books ADD COLUMN shelf_status TEXT NOT NULL DEFAULT 'reading'")
      }
    },
  },
  {
    version: 9,
    // PDF 原版页面标注。
    run(conn) {
      conn.exec(`
        CREATE TABLE IF NOT EXISTS pdf_annotations (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          page INTEGER NOT NULL,
          x REAL NOT NULL,
          y REAL NOT NULL,
          width REAL NOT NULL,
          height REAL NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT 'yellow',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pdf_annotations_book_page ON pdf_annotations(book_id, page, created_at);
      `)
    },
  },
  {
    version: 10,
    // 笔记颜色标签。
    run(conn) {
      try {
        conn.exec('ALTER TABLE notes ADD COLUMN color TEXT')
      } catch {
        // 新库建表时已经包含 color。
      }
    },
  },
]

function readSchemaVersion(conn: DatabaseSync): number {
  const row = conn.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  return Number(row?.user_version ?? 0)
}

export function getSchemaVersion(): number {
  return readSchemaVersion(database())
}

function runMigrations(conn: DatabaseSync): void {
  let current = readSchemaVersion(conn)
  for (const migration of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (migration.version <= current) continue
    conn.exec('BEGIN IMMEDIATE')
    try {
      migration.run(conn)
      conn.exec(`PRAGMA user_version = ${migration.version}`)
      conn.exec('COMMIT')
      current = migration.version
    } catch (error) {
      conn.exec('ROLLBACK')
      throw error
    }
  }
}

function migrateNotes(conn: DatabaseSync): void {
  const columns = new Set(
    (conn.prepare('PRAGMA table_info(notes)').all() as unknown as Array<{ name: string }>).map((row) => row.name),
  )
  const additions: Array<[string, string]> = [
    ['section', 'TEXT'],
    ['importance', 'INTEGER'],
    ['role', 'TEXT'],
    ['color', 'TEXT'],
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
  if (!columns.has('shelf_status')) conn.exec("ALTER TABLE books ADD COLUMN shelf_status TEXT NOT NULL DEFAULT 'reading'")
  if (!columns.has('genre')) conn.exec("ALTER TABLE books ADD COLUMN genre TEXT NOT NULL DEFAULT 'auto'")
  if (!columns.has('cover_path')) conn.exec('ALTER TABLE books ADD COLUMN cover_path TEXT')
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
    ['translated_text', 'TEXT'],
    ['translated_html', 'TEXT'],
    ['translated_at', 'TEXT'],
  ]
  for (const [name, ddl] of additions) {
    if (!columns.has(name)) conn.exec(`ALTER TABLE chapters ADD COLUMN ${name} ${ddl}`)
  }
}

const database = getDatabase

/** 供拆出去的领域模块（PDF 标注、快照合并）复用同一个连接。 */
export function getDb(): DatabaseSync {
  return database()
}

/** 用 SQLite 自己的 VACUUM INTO 做一致性快照，避免直接复制 WAL 中的半写状态。 */
export function backupDatabaseTo(filePath: string): void {
  const target = path.resolve(filePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (fs.existsSync(target)) fs.rmSync(target, { force: true })
  const escaped = target.replace(/'/g, "''")
  database().exec(`VACUUM INTO '${escaped}'`)
}

const contentUndoStack = new Map<string, { kind: 'format' | 'notes'; chapterId: string; bookId: string | null; content: string }>()

function rememberContentUndo(entry: { kind: 'format' | 'notes'; chapterId: string; bookId: string | null; content: string }): string {
  const token = crypto.randomUUID()
  contentUndoStack.set(token, entry)
  while (contentUndoStack.size > 20) {
    const oldest = contentUndoStack.keys().next().value
    if (typeof oldest !== 'string') break
    contentUndoStack.delete(oldest)
  }
  return token
}

/** 撤销最近一次“应用到章节”；只保留当前进程内最近 20 次。 */
export function undoContentApply(token: string): ContentApplyResult {
  const entry = contentUndoStack.get(token)
  if (!entry) throw new Error('这次应用已经无法撤销。')
  contentUndoStack.delete(token)
  if (entry.kind === 'format') {
    const parsed = formatArtifactSchema.safeParse(JSON.parse(entry.content))
    if (!parsed.success) throw new Error('撤销快照已损坏。')
    saveChapterFormat(entry.chapterId, parsed.data.html, parsed.data.removed)
    if (parsed.data.style && entry.bookId) saveBookStyle(entry.bookId, parsed.data.style)
    return { appliedTo: 'chapter', chapterId: entry.chapterId, message: '已撤销上次排版应用。' }
  }
  const parsed = notesArtifactSchema.safeParse(JSON.parse(entry.content))
  if (!parsed.success) throw new Error('撤销快照已损坏。')
  const generated: GeneratedNote[] = parsed.data.notes.map((note) => ({
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
  replaceAiNotes(entry.chapterId, generated)
  if (parsed.data.report) saveNoteReport(entry.chapterId, parsed.data.report)
  return { appliedTo: 'chapter', chapterId: entry.chapterId, message: '已撤销上次笔记恢复。' }
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
      const parsed = formatArtifactSchema.safeParse(JSON.parse(item.content))
      if (!parsed.success) throw new Error('这份排版的格式异常，无法应用。')
      const chapter = getChapter(item.chapterId)
      const currentHtml = chapter.formattedHtml ?? chapter.html ?? ''
      const undoToken = currentHtml.trim()
        ? rememberContentUndo({
            kind: 'format',
            chapterId: item.chapterId,
            bookId: item.bookId,
            content: JSON.stringify({
              html: currentHtml,
              removed: chapter.removed,
              style: item.bookId ? getBookStyle(item.bookId) : undefined,
            }),
          })
        : undefined
      saveChapterFormat(item.chapterId, parsed.data.html, parsed.data.removed)
      if (parsed.data.style && item.bookId) saveBookStyle(item.bookId, parsed.data.style)
      database()
        .prepare("UPDATE lab_artifact_versions SET status = 'adopted', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), id)
      return { appliedTo: 'chapter', chapterId: item.chapterId, message: '排版已应用到章节。', undoToken }
    }
    if (item.kind === 'notes') {
      const parsed = notesArtifactSchema.safeParse(JSON.parse(item.content))
      if (!parsed.success) throw new Error('这份记录的格式异常，无法恢复笔记。')
      const existing = item.bookId ? listNotes(item.bookId, item.chapterId).filter((note) => note.author === 'ai' && !note.edited) : []
      const chapter = getChapter(item.chapterId)
      const undoToken = existing.length > 0
        ? rememberContentUndo({
            kind: 'notes',
            chapterId: item.chapterId,
            bookId: item.bookId,
            content: JSON.stringify({ notes: existing, report: chapter.noteReport }),
          })
        : undefined
      const generated: GeneratedNote[] = parsed.data.notes.map((note) => ({
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
      if (parsed.data.report) saveNoteReport(item.chapterId, parsed.data.report)
      database()
        .prepare("UPDATE lab_artifact_versions SET status = 'adopted', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), id)
      return { appliedTo: 'chapter', chapterId: item.chapterId, message: '这组笔记已恢复到章节。', undoToken }
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
