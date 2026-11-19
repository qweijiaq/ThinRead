import crypto from 'node:crypto'

import type {
  DegradedStep,
  GeneratedNote,
  GenerationMode,
  GenerationStage,
  LibraryFilter,
  LibraryNote,
  LibraryNoteAudit,
  Note,
  NoteDivergence,
  NoteDraft,
  NoteKind,
  NotePatch,
  NoteQualitySummary,
  NoteReport,
  PageResult,
  RelatedNote,
  TagCount,
  TokenUsage,
  TrashedNote,
} from '../shared/types.js'
import { generatedNoteListSchema, noteKindSchema, noteSchema, tagListSchema } from '../shared/schemas.js'
import { getDatabase } from './database.js'
import { markCorruptRow } from './db-health.js'

const database = getDatabase

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

export function getNoteQuality(): NoteQualitySummary {
  const row = database()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN author = 'ai' THEN 1 ELSE 0 END) AS ai,
              SUM(CASE WHEN edited = 1 THEN 1 ELSE 0 END) AS edited,
              SUM(CASE WHEN quote IS NOT NULL AND TRIM(quote) != '' THEN 1 ELSE 0 END) AS quoted,
              SUM(CASE WHEN quote IS NOT NULL AND TRIM(quote) != '' AND quote_verified = 1 THEN 1 ELSE 0 END) AS verified
       FROM notes`,
    )
    .get() as unknown as {
    total: number | null
    ai: number | null
    edited: number | null
    quoted: number | null
    verified: number | null
  }
  const total = Number(row.total ?? 0)
  const quoted = Number(row.quoted ?? 0)
  const verified = Number(row.verified ?? 0)
  return {
    total,
    ai: Number(row.ai ?? 0),
    edited: Number(row.edited ?? 0),
    quoted,
    verified,
    verifiedRate: quoted === 0 ? 0 : verified / quoted,
  }
}

export function trashNote(noteId: string): Note | null {
  const note = getNote(noteId)
  if (!note) return null
  const conn = database()
  conn.exec('BEGIN IMMEDIATE')
  try {
    conn
      .prepare('INSERT OR REPLACE INTO note_trash (id, payload, book_id, chapter_id, deleted_at) VALUES (?, ?, ?, ?, ?)')
      .run(note.id, JSON.stringify(note), note.bookId, note.chapterId, new Date().toISOString())
    deleteNote(noteId)
    conn.exec('COMMIT')
    return note
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
}

export function restoreTrashedNote(noteId: string): Note | null {
  const row = database().prepare('SELECT payload, book_id, chapter_id FROM note_trash WHERE id = ?').get(noteId) as
    | { payload: string; book_id: string | null; chapter_id: string | null }
    | undefined
  if (!row || !row.book_id) return null
  try {
    const parsed = noteSchema.safeParse(JSON.parse(row.payload) as unknown)
    if (!parsed.success) return null
    const note: Note = { ...parsed.data, bookId: row.book_id, chapterId: row.chapter_id }
    const bookExists = database().prepare('SELECT 1 FROM books WHERE id = ?').get(note.bookId)
    if (!bookExists) return null
    if (note.chapterId) {
      const chapterExists = database().prepare('SELECT 1 FROM chapters WHERE id = ?').get(note.chapterId)
      if (!chapterExists) note.chapterId = null
    }
    const conn = database()
    conn.exec('BEGIN IMMEDIATE')
    try {
      conn
        .prepare(
          `INSERT OR REPLACE INTO notes
           (id, book_id, chapter_id, kind, title, content, quote, quote_verified, author, edited, tags, section, importance, role, expansion, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          note.id,
          note.bookId,
          note.chapterId,
          note.kind,
          note.title,
          note.content,
          note.quote,
          note.quoteVerified ? 1 : 0,
          note.author,
          note.edited ? 1 : 0,
          JSON.stringify(note.tags),
          note.section,
          note.importance,
          note.role,
          JSON.stringify(note.divergences ?? []),
          note.createdAt,
          new Date().toISOString(),
        )
      conn.prepare('DELETE FROM note_trash WHERE id = ?').run(noteId)
      conn.exec('COMMIT')
    } catch (error) {
      conn.exec('ROLLBACK')
      throw error
    }
    return getNote(noteId)
  } catch {
    return null
  }
}

export const NOTE_TRASH_RETENTION_DAYS = 30

/** 删除超过保留期的回收站笔记；在应用启动时执行，避免 note_trash 无限增长。 */
export function pruneNoteTrash(days = NOTE_TRASH_RETENTION_DAYS): number {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const result = database().prepare('DELETE FROM note_trash WHERE deleted_at < ?').run(cutoff)
  return Number(result.changes ?? 0)
}

export function listTrashedNotes(): TrashedNote[] {
  const rows = database()
    .prepare(
      `SELECT t.id, t.payload, t.deleted_at, b.title AS book_title, c.title AS chapter_title
       FROM note_trash t
       LEFT JOIN books b ON b.id = t.book_id
       LEFT JOIN chapters c ON c.id = t.chapter_id
       ORDER BY t.deleted_at DESC`,
    )
    .all() as unknown as Array<{
    id: string
    payload: string
    deleted_at: string
    book_title: string | null
    chapter_title: string | null
  }>
  return rows.map((row) => {
    let note: Note | null = null
    try {
      const parsed = noteSchema.safeParse(JSON.parse(row.payload) as unknown)
      if (parsed.success) note = parsed.data
    } catch {
      // 损坏的回收站数据仍然展示，用户可以彻底删除。
    }
    return {
      id: row.id,
      title: note?.title || '已删除的笔记',
      kind: note?.kind ?? 'thought',
      preview: note?.content.replace(/\s+/g, ' ').trim().slice(0, 180) ?? '',
      bookTitle: row.book_title?.trim() || '原书已删除',
      chapterTitle: row.chapter_title,
      deletedAt: row.deleted_at,
    }
  })
}

export function purgeTrashedNote(noteId: string): void {
  database().prepare('DELETE FROM note_trash WHERE id = ?').run(noteId)
}

export function emptyNoteTrash(): number {
  const result = database().prepare('DELETE FROM note_trash').run()
  return Number(result.changes ?? 0)
}

/** 轻量维护：更新查询规划器统计并截断 WAL，不自动执行耗时的 VACUUM。 */
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

export function listRelatedNotes(bookId: string, tags: string[], limit = 6, options: { excludeKinds?: NoteKind[] } = {}): RelatedNote[] {
  const wanted = tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length >= 2)
  if (wanted.length === 0) return []
  const excluded = [...new Set(['condensed', 'summary', 'question', ...(options.excludeKinds ?? [])])]
  const placeholders = excluded.map(() => '?').join(', ')

  const rows = database()
    .prepare(
      `SELECT n.id, n.book_id, b.title AS book_title, n.chapter_id, c.title AS chapter_title,
              n.title, n.content, n.tags
       FROM notes n
       JOIN books b ON b.id = n.book_id
       LEFT JOIN chapters c ON c.id = n.chapter_id
       WHERE n.book_id != ?
         AND n.kind NOT IN (${placeholders})
         AND TRIM(n.content) != ''`,
    )
    .all(bookId, ...excluded) as unknown as Array<{
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
    // 只命中一个弱关键词不算关联；至少一个精确标签或两个内容命中。
    if (score < 2) continue
    if (row.content.trim().length < 8) continue
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



interface LibraryRow extends NoteRow {
  book_title: string
  chapter_title: string | null
}

function mapLibraryNote(row: LibraryRow): LibraryNote {
  return {
    ...mapNote(row),
    bookTitle: row.book_title,
    chapterTitle: row.chapter_title,
  }
}

function libraryNoteFilter(filter: LibraryFilter = {}): {
  from: string
  where: string
  params: Array<string | number>
  bookId: string | null
} {
  const where: string[] = []
  const params: Array<string | number> = []
  const term = filter.query?.replace(/\s+/g, ' ').trim() ?? ''
  if (filter.bookId) {
    where.push('n.book_id = ?')
    params.push(filter.bookId)
  }
  if (filter.kind) {
    where.push('n.kind = ?')
    params.push(filter.kind)
  }
  if (filter.tag) {
    const escaped = filter.tag.replace(/[\\%_]/g, (char) => `\\${char}`)
    where.push("n.tags LIKE ? ESCAPE '\\'")
    params.push(`%"${escaped}"%`)
  }
  if (filter.untagged) {
    where.push("(n.tags IS NULL OR TRIM(n.tags) = '' OR n.tags = '[]')")
  }
  if (term) {
    const escaped = term.replace(/[\\%_]/g, (char) => `\\${char}`)
    where.push("(n.title LIKE ? ESCAPE '\\' OR n.content LIKE ? ESCAPE '\\')")
    params.push(`%${escaped}%`, `%${escaped}%`)
  }
  if (filter.audit === 'unverified') {
    where.push("n.quote IS NOT NULL AND TRIM(n.quote) <> '' AND n.quote_verified = 0")
  } else if (filter.audit === 'noQuote') {
    where.push("(n.quote IS NULL OR TRIM(n.quote) = '')")
  } else if (filter.audit === 'edited') {
    where.push('n.edited = 1')
  }
  if (filter.ids) {
    if (filter.ids.length === 0) {
      where.push('1 = 0')
    } else {
      where.push(`n.id IN (${filter.ids.map(() => '?').join(',')})`)
      params.push(...filter.ids)
    }
  }
  return {
    from: `FROM notes n
    JOIN books b ON b.id = n.book_id
    LEFT JOIN chapters c ON c.id = n.chapter_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    where: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
    bookId: filter.bookId ?? null,
  }
}

export function listLibraryNotesPage(filter: LibraryFilter = {}): PageResult<LibraryNote> {
  const { from, params } = libraryNoteFilter(filter)
  const limit = Math.min(Math.max(filter.limit ?? 30, 1), 200)
  const offset = Math.max(filter.offset ?? 0, 0)
  const total = Number(
    (database().prepare(`SELECT COUNT(*) AS total ${from}`).get(...params) as { total: number } | undefined)?.total ?? 0,
  )
  const orderBy =
    filter.sort === 'created'
      ? 'n.created_at DESC, n.rowid DESC'
      : filter.sort === 'title'
        ? 'n.title COLLATE NOCASE ASC, n.updated_at DESC'
        : filter.sort === 'book'
          ? 'b.title COLLATE NOCASE ASC, c.idx ASC, n.updated_at DESC'
          : 'n.updated_at DESC, n.rowid DESC'
  const rows = database()
    .prepare(
      `SELECT n.*, b.title AS book_title, c.title AS chapter_title ${from}
       ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as unknown as LibraryRow[]
  return { items: rows.map(mapLibraryNote), total }
}

/** 笔记库摘要：引用核对、人工修改，以及当前书（或全库）的章节覆盖度。 */
export function getLibraryNoteAudit(filter: LibraryFilter = {}): LibraryNoteAudit {
  const { from, params, bookId } = libraryNoteFilter({ ...filter, audit: null })
  const row = database()
    .prepare(
      `SELECT COUNT(*) AS notes,
        COALESCE(SUM(CASE WHEN n.author = 'ai' THEN 1 ELSE 0 END), 0) AS ai,
        COALESCE(SUM(CASE WHEN n.edited = 1 THEN 1 ELSE 0 END), 0) AS edited,
        COALESCE(SUM(CASE WHEN n.quote_verified = 1 THEN 1 ELSE 0 END), 0) AS verified,
        COALESCE(SUM(CASE WHEN n.quote IS NOT NULL AND TRIM(n.quote) <> '' AND n.quote_verified = 0 THEN 1 ELSE 0 END), 0) AS unverified,
        COALESCE(SUM(CASE WHEN n.quote IS NULL OR TRIM(n.quote) = '' THEN 1 ELSE 0 END), 0) AS no_quote
       ${from}`,
    )
    .get(...params) as unknown as {
    notes: number
    ai: number
    edited: number
    verified: number
    unverified: number
    no_quote: number
  }
  const coverage = database()
    .prepare(
      `SELECT COUNT(DISTINCT c.id) AS total,
        COUNT(DISTINCT CASE WHEN n.id IS NOT NULL THEN c.id END) AS with_notes,
        COUNT(DISTINCT CASE WHEN n.kind = 'condensed' THEN c.id END) AS with_condensed
       FROM chapters c
       LEFT JOIN notes n ON n.chapter_id = c.id
       WHERE c.hidden = 0${bookId ? ' AND c.book_id = ?' : ''}`,
    )
    .get(...(bookId ? [bookId] : [])) as unknown as {
    total: number
    with_notes: number
    with_condensed: number
  }
  return {
    notes: Number(row?.notes) || 0,
    ai: Number(row?.ai) || 0,
    edited: Number(row?.edited) || 0,
    verified: Number(row?.verified) || 0,
    unverified: Number(row?.unverified) || 0,
    noQuote: Number(row?.no_quote) || 0,
    chapterTotal: Number(coverage?.total) || 0,
    chapterWithNotes: Number(coverage?.with_notes) || 0,
    chapterWithCondensed: Number(coverage?.with_condensed) || 0,
  }
}

export function listLibraryNotes(filter: LibraryFilter = {}): LibraryNote[] {
  return listLibraryNotesPage({ ...filter, limit: filter.limit ?? 300 }).items
}

export function listLibraryTags(bookId?: string | null): TagCount[] {
  // 只读 tags 列：之前会把每条笔记的完整内容都读进内存再丢掉。
  const conn = database()
  const rows = (bookId
    ? conn.prepare('SELECT tags FROM notes WHERE book_id = ?').all(bookId)
    : conn.prepare('SELECT tags FROM notes').all()) as unknown as Array<{ tags: string }>
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const tag of parseTags(row.tags)) {
      const text = tag.trim()
      if (text) counts.set(text, (counts.get(text) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export function mergeNoteTags(tags: string[], canonical: string): number {
  const wanted = new Set(tags.map((tag) => tag.trim()).filter(Boolean))
  const target = canonical.trim()
  if (wanted.size === 0 || !target) return 0
  const conn = database()
  const rows = conn.prepare('SELECT id, tags FROM notes').all() as unknown as Array<{ id: string; tags: string }>
  let changed = 0
  const now = new Date().toISOString()
  conn.exec('BEGIN IMMEDIATE')
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
  conn.exec('BEGIN IMMEDIATE')
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

function mapSemanticRows(
  rows: Array<{
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
  }>,
): SemanticNote[] {
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

export function listSemanticCandidates(
  bookId: string,
  options: { excludeKinds?: NoteKind[] } = {},
): SemanticNote[] {
  const excluded = [...new Set(options.excludeKinds ?? [])]
  const kindFilter = excluded.length > 0 ? `AND n.kind NOT IN (${excluded.map(() => '?').join(', ')})` : ''
  const rows = database()
    .prepare(
      `SELECT n.id, n.book_id, b.title AS book_title, n.chapter_id, c.title AS chapter_title,
              n.title, n.content, n.tags, e.vector, e.model
       FROM notes n
       JOIN books b ON b.id = n.book_id
       LEFT JOIN chapters c ON c.id = n.chapter_id
       LEFT JOIN note_embeddings e ON e.note_id = n.id
       WHERE n.book_id != ?
         ${kindFilter}
         AND TRIM(n.content) != ''`,
    )
    .all(bookId, ...excluded) as unknown as Parameters<typeof mapSemanticRows>[0]
  return mapSemanticRows(rows)
}

/** 全局语义搜索用：不排除当前书，检索所有带向量的笔记。 */
export function listSemanticCandidatesAll(options: { excludeKinds?: NoteKind[] } = {}): SemanticNote[] {
  const excluded = [...new Set(options.excludeKinds ?? [])]
  const kindFilter = excluded.length > 0 ? `AND n.kind NOT IN (${excluded.map(() => '?').join(', ')})` : ''
  const rows = database()
    .prepare(
      `SELECT n.id, n.book_id, b.title AS book_title, n.chapter_id, c.title AS chapter_title,
              n.title, n.content, n.tags, e.vector, e.model
       FROM notes n
       JOIN books b ON b.id = n.book_id
       LEFT JOIN chapters c ON c.id = n.chapter_id
       LEFT JOIN note_embeddings e ON e.note_id = n.id
       WHERE TRIM(n.content) != ''
         ${kindFilter}`,
    )
    .all(...excluded) as unknown as Parameters<typeof mapSemanticRows>[0]
  return mapSemanticRows(rows)
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
    markCorruptRow('note.tags')
  } catch {
    markCorruptRow('note.tags')
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
    markCorruptRow('note.embedding')
  } catch {
    markCorruptRow('note.embedding')
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
    else markCorruptRow('note.tags')
  } catch {
    markCorruptRow('note.tags')
    tags = []
  }
  const note: Note = {
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
    color: row.color === 'red' || row.color === 'yellow' || row.color === 'green' || row.color === 'blue' ? row.color : null,
    divergences: parseDivergences(row.expansion),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  const validated = noteSchema.safeParse(note)
  if (validated.success) return validated.data
  markCorruptRow('note.fields')
  // 旧库或异常写入可能留下非法枚举/数值；读出来时修复，避免整页笔记无法打开。
  const kind = noteKindSchema.safeParse(note.kind)
  const importance = Number.isFinite(note.importance) ? Math.min(5, Math.max(1, Math.round(note.importance!))) : null
  return {
    ...note,
    kind: kind.success ? kind.data : 'point',
    author: note.author === 'user' ? 'user' : 'ai',
    tags: tagListSchema.safeParse(note.tags).success ? note.tags : [],
    importance,
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
    markCorruptRow('note.divergences')
  } catch {
    markCorruptRow('note.divergences')
  }
  return []
}

function normalizeDivergenceType(value: unknown): NoteDivergence['type'] {
  return value === 'crossbook' || value === 'transfer' || value === 'boundary' ? value : 'boundary'
}

export function parseNoteReport(raw: string | null): NoteReport | null {
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
    const usageRecord =
      record.usage && typeof record.usage === 'object' && !Array.isArray(record.usage)
        ? (record.usage as Record<string, unknown>)
        : null
    const usage: TokenUsage | undefined = usageRecord
      ? {
          inputTokens: Number(usageRecord.inputTokens) || 0,
          outputTokens: Number(usageRecord.outputTokens) || 0,
          totalTokens: Number(usageRecord.totalTokens) || 0,
        }
      : undefined
    const mode: GenerationMode | undefined =
      record.mode === 'fast' || record.mode === 'standard' || record.mode === 'deep' ? record.mode : undefined
    const validStages = new Set<GenerationStage>([
      'condense',
      'audit-fidelity',
      'audit-details',
      'extract-cards',
      'refilter-cards',
      'expand-cards',
    ])
    const degraded: DegradedStep[] | undefined = Array.isArray(record.degraded)
      ? record.degraded.flatMap((item): DegradedStep[] => {
          if (!item || typeof item !== 'object') return []
          const entry = item as Record<string, unknown>
          const stage = entry.stage as GenerationStage
          if (!validStages.has(stage)) return []
          return [
            {
              stage,
              failed: Number(entry.failed) || 1,
              ...(typeof entry.total === 'number' ? { total: entry.total } : {}),
              ...(typeof entry.message === 'string' ? { message: entry.message.slice(0, 300) } : {}),
            },
          ]
        })
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
      ...(mode ? { mode } : {}),
      ...(usage ? { usage } : {}),
      ...(typeof record.promptVersion === 'string' ? { promptVersion: record.promptVersion } : {}),
      ...(typeof record.images === 'number' ? { images: record.images } : {}),
      ...(typeof record.visionUsed === 'boolean' ? { visionUsed: record.visionUsed } : {}),
      ...(degraded && degraded.length > 0 ? { degraded } : {}),
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
  const conn = database()
  conn.exec('BEGIN IMMEDIATE')
  try {
    conn
      .prepare('UPDATE notes SET title = ?, content = ?, quote = ?, tags = ?, color = ?, kind = ?, edited = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.title ?? current.title,
        patch.content ?? current.content,
        patch.quote === undefined ? current.quote : patch.quote,
        JSON.stringify(patch.tags ?? current.tags),
        (patch.color === undefined ? current.color : patch.color) ?? null,
        patch.kind ?? current.kind,
        edited,
        now,
        noteId,
      )
    conn.prepare('DELETE FROM note_embeddings WHERE note_id = ?').run(noteId)
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
  return getNote(noteId)
}

export function deleteNote(noteId: string): void {
  database().prepare('DELETE FROM notes WHERE id = ?').run(noteId)
}

/** 用新生成的 AI 笔记替换同一章节的旧 AI 笔记，用户编辑过的笔记永远保留。 */
export function replaceAiNotes(chapterId: string, generated: GeneratedNote[]): Note[] {
  const validated = generatedNoteListSchema.safeParse(generated)
  if (!validated.success) {
    const issue = validated.error.issues[0]
    throw new Error(`笔记格式异常，已停止写入${issue ? `：${issue.path.join('.') || 'notes'} ${issue.message}` : ''}`)
  }
  const conn = database()
  const now = new Date().toISOString()
  conn.exec('BEGIN IMMEDIATE')
  try {
    conn.prepare("DELETE FROM notes WHERE chapter_id = ? AND author = 'ai' AND edited = 0").run(chapterId)
    const insert = conn.prepare(
      `INSERT INTO notes (id, book_id, chapter_id, kind, title, content, quote, quote_verified, author, edited, tags, section, importance, role, expansion, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai', 0, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const note of validated.data) {
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
