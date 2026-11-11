import type { SearchResult, SearchResultType } from '../shared/types.js'
import { contentAsMarkdown, contentKindForTool } from './db.js'
import { getDatabase } from './database.js'

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed.filter((tag): tag is string => typeof tag === 'string')
  } catch {
    // 忽略无法解析的旧数据。
  }
  return []
}

export interface SearchDocument {
  type: SearchResultType
  id: string
  bookId: string
  bookTitle: string
  chapterId: string | null
  chapterTitle: string | null
  title: string
  text: string
  updatedAt: string | null
  meta?: string
}

/** 供本地全文索引使用；和搜索结果共享同一套来源字段。 */
export function searchDocuments(): SearchDocument[] {
  const conn = getDatabase()
  const docs: SearchDocument[] = []
  const books = conn
    .prepare(
      `SELECT b.id, b.title, b.author, b.created_at, b.last_opened_at,
              (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id AND c.hidden = 0) AS chapter_count,
              (SELECT COUNT(*) FROM notes n WHERE n.book_id = b.id) AS note_count
       FROM books b`,
    )
    .all() as unknown as Array<{
    id: string
    title: string
    author: string
    created_at: string
    last_opened_at: string | null
    chapter_count: number
    note_count: number
  }>
  for (const book of books) {
    docs.push({
      type: 'book',
      id: book.id,
      bookId: book.id,
      bookTitle: book.title,
      chapterId: null,
      chapterTitle: null,
      title: book.title,
      text: `${book.title} ${book.author}`,
      updatedAt: book.last_opened_at ?? book.created_at,
      meta: `${book.author || '未知作者'} · ${Number(book.chapter_count)} 章 · ${Number(book.note_count)} 条笔记`,
    })
  }

  const chapters = conn
    .prepare(
      `SELECT c.id, c.book_id, b.title AS book_title, c.title, c.text
       FROM chapters c JOIN books b ON b.id = c.book_id
       WHERE c.hidden = 0`,
    )
    .all() as unknown as Array<{
    id: string
    book_id: string
    book_title: string
    title: string
    text: string
  }>
  for (const chapter of chapters) {
    docs.push({
      type: 'chapter',
      id: chapter.id,
      bookId: chapter.book_id,
      bookTitle: chapter.book_title,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      title: chapter.title,
      text: `${chapter.title}\n${chapter.text}`,
      updatedAt: null,
    })
  }

  const notes = conn
    .prepare(
      `SELECT n.id, n.book_id, b.title AS book_title, n.chapter_id, c.title AS chapter_title,
              n.title, n.content, n.tags, n.updated_at
       FROM notes n
       JOIN books b ON b.id = n.book_id
       LEFT JOIN chapters c ON c.id = n.chapter_id`,
    )
    .all() as unknown as Array<{
    id: string
    book_id: string
    book_title: string
    chapter_id: string | null
    chapter_title: string | null
    title: string
    content: string
    tags: string
    updated_at: string
  }>
  for (const note of notes) {
    docs.push({
      type: 'note',
      id: note.id,
      bookId: note.book_id,
      bookTitle: note.book_title,
      chapterId: note.chapter_id,
      chapterTitle: note.chapter_title,
      title: note.title,
      text: `${note.title}\n${note.content}\n${parseTags(note.tags).join(' ')}`,
      updatedAt: note.updated_at,
    })
  }

  const artifacts = conn
    .prepare(
      `SELECT a.id, a.title, a.content, a.updated_at,
              COALESCE(a.book_id, c.book_id) AS book_id,
              COALESCE(b.title, cb.title) AS book_title,
              a.chapter_id, c.title AS chapter_title
       FROM lab_artifact_versions a
       LEFT JOIN chapters c ON c.id = a.chapter_id
       LEFT JOIN books b ON b.id = a.book_id
       LEFT JOIN books cb ON cb.id = c.book_id
       WHERE a.status != 'deleted'`,
    )
    .all() as unknown as Array<{
    id: string
    title: string
    content: string
    updated_at: string
    book_id: string | null
    book_title: string | null
    chapter_id: string | null
    chapter_title: string | null
  }>
  for (const artifact of artifacts) {
    docs.push({
      type: 'content',
      id: artifact.id,
      bookId: artifact.book_id ?? '',
      bookTitle: artifact.book_title ?? '生成内容',
      chapterId: artifact.chapter_id,
      chapterTitle: artifact.chapter_title,
      title: artifact.title,
      text: `${artifact.title}\n${readableArtifactContent('', artifact.content)}`,
      updatedAt: artifact.updated_at,
    })
  }
  return docs
}

let cachedConnection: object | null = null
let cachedSignature = ''
let cachedChanges = -1

/** 索引签名按数据库连接和 total_changes 缓存；没有写入时不再重复扫描全库。 */
export function searchIndexSignature(): string {
  const conn = getDatabase()
  if (cachedConnection !== conn) {
    cachedConnection = conn
    cachedSignature = ''
    cachedChanges = -1
  }
  let changes = -1
  try {
    const probe = conn.prepare('SELECT total_changes() AS n').get() as { n?: number } | undefined
    changes = Number(probe?.n ?? -1)
  } catch {
    // 老版本 SQLite 没有 total_changes 时退回每次计算。
  }
  if (changes >= 0 && changes === cachedChanges && cachedSignature) return cachedSignature
  const row = conn
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM books) AS book_count,
        (SELECT COALESCE(MAX(rowid), 0) FROM books) AS book_rowid,
        (SELECT GROUP_CONCAT(title || char(31) || COALESCE(author, ''), char(30)) FROM books) AS books,
        (SELECT COUNT(*) FROM chapters WHERE hidden = 0) AS chapter_count,
        (SELECT COALESCE(SUM(chars), 0) FROM chapters WHERE hidden = 0) AS chapter_chars,
        (SELECT COALESCE(MAX(rowid), 0) FROM chapters) AS chapter_rowid,
        (SELECT GROUP_CONCAT(title, char(30)) FROM chapters WHERE hidden = 0) AS chapters,
        (SELECT COUNT(*) FROM notes) AS note_count,
        (SELECT COALESCE(MAX(updated_at), '') FROM notes) AS note_updated,
        (SELECT COALESCE(MAX(rowid), 0) FROM notes) AS note_rowid,
        (SELECT COUNT(*) FROM lab_artifact_versions WHERE status != 'deleted') AS content_count,
        (SELECT COALESCE(MAX(updated_at), '') FROM lab_artifact_versions) AS content_updated,
        (SELECT COALESCE(MAX(rowid), 0) FROM lab_artifact_versions) AS content_rowid`,
    )
    .get() as
    | {
        book_count: number
        book_rowid: number
        books: string | null
        chapter_count: number
        chapter_chars: number
        chapter_rowid: number
        chapters: string | null
        note_count: number
        note_updated: string
        note_rowid: number
        content_count: number
        content_updated: string
        content_rowid: number
      }
    | undefined
  cachedChanges = changes
  cachedSignature = JSON.stringify(row ?? null)
  return cachedSignature
}

export function searchLibrary(rawQuery: string, limit = 40): SearchResult[] {
  const query = rawQuery.replace(/\s+/g, ' ').trim()
  if (!query) return []
  const escaped = query.replace(/[\\%_]/g, (char) => `\\${char}`)
  const like = `%${escaped}%`
  const conn = getDatabase()
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

