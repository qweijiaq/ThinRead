import crypto from 'node:crypto'

import type {
  ContentFilter,
  ContentItem,
  ContentKind,
  ContentStatus,
  LabArtifact,
  PageResult,
} from '../shared/types.js'
import { getDatabase } from './database.js'

const database = getDatabase

export const DELETED_CONTENT_RETENTION_DAYS = 30

/** 内容库的“已删除”是回收站；超过保留期后清理，已归档内容不受影响。 */
export function pruneDeletedContent(days = DELETED_CONTENT_RETENTION_DAYS): number {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const result = database()
    .prepare("DELETE FROM lab_artifact_versions WHERE status = 'deleted' AND COALESCE(updated_at, created_at) < ?")
    .run(cutoff)
  return Number(result.changes ?? 0)
}

const ARTIFACT_VERSIONS_PER_SCOPE = 30
let artifactInsertCount = 0

/**
 * 每个工具 + 范围只保留最近 N 份生成快照。
 * 收藏、当前版本和回收站里的内容不参与清理，避免内容库无限膨胀。
 */
export function pruneArtifactVersions(keepPerScope = ARTIFACT_VERSIONS_PER_SCOPE): number {
  const keep = Math.max(5, Math.floor(Number(keepPerScope) || 0))
  try {
    const result = database()
      .prepare(
        `DELETE FROM lab_artifact_versions
         WHERE id IN (
           SELECT id FROM (
             SELECT id,
                    ROW_NUMBER() OVER (
                      PARTITION BY tool, scope
                      ORDER BY COALESCE(updated_at, created_at) DESC
                    ) AS rn
             FROM lab_artifact_versions
             WHERE status != 'deleted' AND favorite = 0 AND current_at IS NULL
           )
           WHERE rn > ?
         )`,
      )
      .run(keep)
    return Number(result.changes) || 0
  } catch {
    // 清理失败不影响生成结果写入。
    return 0
  }
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

export function artifactSource(
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
  artifactInsertCount += 1
  if (artifactInsertCount % 20 === 0) pruneArtifactVersions()
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

export function listContentPage(filter: ContentFilter = {}): PageResult<ContentItem> {
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
  if (filter.ids) {
    if (filter.ids.length === 0) return { items: [], total: 0 }
    where.push(`a.id IN (${filter.ids.map(() => '?').join(',')})`)
    params.push(...filter.ids)
  }
  if (filter.query?.trim()) {
    const escaped = filter.query.trim().replace(/[\\%_]/g, (char) => `\\${char}`)
    const like = `%${escaped}%`
    where.push("(a.title LIKE ? ESCAPE '\\' OR a.content LIKE ? ESCAPE '\\')")
    params.push(like, like)
  }
  const limit = Math.min(Math.max(filter.limit ?? 30, 1), 300)
  const offset = Math.max(filter.offset ?? 0, 0)
  const from = `FROM lab_artifact_versions a
    LEFT JOIN chapters c ON c.id = a.chapter_id
    LEFT JOIN books b ON b.id = COALESCE(a.book_id, c.book_id)
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`
  const total = Number(
    (database().prepare(`SELECT COUNT(*) AS total ${from}`).get(...params) as { total: number } | undefined)?.total ?? 0,
  )
  const rows = database()
    .prepare(
      `SELECT a.*, b.title AS book_title, c.title AS chapter_title ${from}
       ORDER BY a.updated_at DESC, a.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as unknown as ContentRow[]
  return { items: rows.map(mapContentItem), total }
}

export function listContent(filter: ContentFilter = {}): ContentItem[] {
  return listContentPage({ ...filter, limit: filter.limit ?? 100 }).items
}



export function getContent(id: string): ContentItem | null {
  const row = database().prepare(`${contentSelect()} WHERE a.id = ?`).get(id) as ContentRow | undefined
  return row ? mapContentItem(row) : null
}

/** 同一工具 + 同一作用域的历史版本，用于内容库的版本对比。 */
export function listContentVersions(tool: string, scope: string): ContentItem[] {
  if (!tool || !scope) return []
  const rows = database()
    .prepare(
      `${contentSelect()}
       WHERE a.tool = ? AND a.scope = ? AND a.status != 'deleted'
       ORDER BY a.updated_at DESC, a.created_at DESC
       LIMIT 100`,
    )
    .all(tool, scope) as unknown as ContentRow[]
  return rows.map(mapContentItem)
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

export function purgeContent(id: string): void {
  const item = getContent(id)
  if (!item || item.status !== 'deleted') throw new Error('只有回收站里的内容可以彻底删除。')
  database().prepare('DELETE FROM lab_artifact_versions WHERE id = ?').run(id)
}

export function purgeDeletedContent(): number {
  const result = database().prepare("DELETE FROM lab_artifact_versions WHERE status = 'deleted'").run()
  return Number(result.changes) || 0
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

