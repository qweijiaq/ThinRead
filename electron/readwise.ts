import type { HighlightEntry } from './parsers/highlights.js'

interface ReadwiseHighlight {
  text?: unknown
  note?: unknown
  tags?: unknown
  location?: unknown
  highlighted_at?: unknown
}

interface ReadwiseBook {
  title?: unknown
  author?: unknown
  readable_title?: unknown
  highlights?: unknown
}

interface ReadwiseExport {
  results?: unknown
  nextPageCursor?: unknown
}

const V2_ENDPOINT = 'https://readwise.io/api/v2/export/'
const READER_LIST_ENDPOINT = 'https://readwise.io/api/v3/list/'
const MAX_PAGES = 20

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}

function mapBooks(books: ReadwiseBook[], entries: HighlightEntry[]): void {
  for (const book of books) {
    const title = stringValue(book.title) || stringValue(book.readable_title)
    if (!title) continue
    const author = stringValue(book.author)
    const highlights = Array.isArray(book.highlights) ? (book.highlights as ReadwiseHighlight[]) : []
    for (const highlight of highlights) {
      const text = stringValue(highlight.text)
      const note = stringValue(highlight.note)
      if (!text && !note) continue
      const tags = Array.isArray(highlight.tags)
        ? highlight.tags
            .map((tag) =>
              tag && typeof tag === 'object' && 'name' in tag
                ? stringValue((tag as { name?: unknown }).name)
                : stringValue(tag),
            )
            .filter(Boolean)
        : []
      entries.push({
        title,
        author,
        text,
        note,
        tags,
        location: stringValue(highlight.location),
        url: '',
      })
    }
  }
}

interface ReaderDocument {
  id?: unknown
  title?: unknown
  author?: unknown
  category?: unknown
  parent_id?: unknown
  notes?: unknown
  note?: unknown
  summary?: unknown
  html_content?: unknown
  source_url?: unknown
  url?: unknown
  tags?: unknown
}

interface ReaderList {
  results?: unknown
  nextPageCursor?: unknown
}

function readerTags(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.values(value as Record<string, unknown>)
      : []
  return values
    .map((tag) => {
      if (typeof tag === 'string') return tag.trim()
      if (tag && typeof tag === 'object') {
        const item = tag as { name?: unknown; key?: unknown }
        return stringValue(item.name) || stringValue(item.key)
      }
      return ''
    })
    .filter(Boolean)
}

function plainText(value: unknown): string {
  return stringValue(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Reader 把划线和笔记作为 category=highlight/note 的文档返回，用 parent_id 关联原书。 */
export function mapReaderDocuments(documents: ReaderDocument[], entries: HighlightEntry[]): void {
  const byId = new Map<string, ReaderDocument>()
  for (const document of documents) {
    const id = stringValue(document.id)
    if (id) byId.set(id, document)
  }
  for (const document of documents) {
    const category = stringValue(document.category)
    if (category !== 'highlight' && category !== 'note') continue
    const parentId = stringValue(document.parent_id)
    const parent = parentId ? byId.get(parentId) : undefined
    const title =
      stringValue(parent?.title) ||
      stringValue(document.title) ||
      stringValue(document.source_url) ||
      stringValue(document.url) ||
      'Readwise Reader'
    const author = stringValue(parent?.author)
    const highlight = plainText(document.title)
    const note = plainText(document.notes) || plainText(document.note)
    const body = plainText(document.html_content) || plainText(document.summary)
    const text = highlight && highlight !== title ? highlight : body
    if (!text && !note) continue
    entries.push({
      title,
      author,
      text,
      note,
      tags: readerTags(document.tags),
      location: '',
      url: stringValue(document.source_url) || stringValue(document.url),
    })
  }
}

async function fetchReaderDocuments(token: string): Promise<ReaderDocument[]> {
  const documents: ReaderDocument[] = []
  let cursor = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ limit: '1000' })
    if (cursor) query.set('pageCursor', cursor)
    const payload = (await fetchJson(`${READER_LIST_ENDPOINT}?${query.toString()}`, token)) as ReaderList | unknown[]
    const results = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.results)
        ? (payload.results as ReaderDocument[])
        : []
    documents.push(...(results as ReaderDocument[]))
    cursor = Array.isArray(payload) ? '' : stringValue((payload as ReaderList).nextPageCursor)
    if (!cursor) break
  }
  return documents
}

async function fetchJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Token ${token.trim()}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(60_000),
  }).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Readwise 同步失败：${detail}`)
  })
  if (!response.ok) {
    throw new Error(`Readwise 同步失败：HTTP ${response.status}（请检查 Token）`)
  }
  return response.json()
}

async function fetchClassicEntries(token: string): Promise<HighlightEntry[]> {
  const entries: HighlightEntry[] = []
  let cursor = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = cursor ? `${V2_ENDPOINT}?pageCursor=${encodeURIComponent(cursor)}` : V2_ENDPOINT
    const payload = (await fetchJson(url, token)) as ReadwiseExport
    const books = Array.isArray(payload.results) ? (payload.results as ReadwiseBook[]) : []
    mapBooks(books, entries)
    cursor = stringValue(payload.nextPageCursor)
    if (!cursor) break
  }
  return entries
}

async function fetchReaderEntries(token: string): Promise<HighlightEntry[]> {
  const entries: HighlightEntry[] = []
  mapReaderDocuments(await fetchReaderDocuments(token), entries)
  return entries
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Readwise 同步失败：/, '')
}

/** v2 导出和 Reader v3 的权限相互独立：两者都尝试，任一可用就合并。 */
export async function fetchReadwiseEntries(token: string): Promise<HighlightEntry[]> {
  if (!token.trim()) throw new Error('还没有配置 Readwise API Token。')

  const [classic, reader] = await Promise.allSettled([fetchClassicEntries(token), fetchReaderEntries(token)])
  if (classic.status === 'rejected' && reader.status === 'rejected') {
    throw new Error(
      `Readwise 同步失败：常规划线和 Reader 接口都不可用（${failureMessage(classic.reason)}；${failureMessage(reader.reason)}）。请检查 Token 权限，或改用 Readwise CSV 导出后手动导入。`,
    )
  }

  const entries: HighlightEntry[] = []
  if (classic.status === 'fulfilled') entries.push(...classic.value)
  if (reader.status === 'fulfilled') entries.push(...reader.value)

  const seen = new Set<string>()
  return entries.filter((entry) => {
    // 同一条划线可能同时出现在 v2 导出和 Reader 文档里，location 往往不同，只按内容去重。
    const key = `${entry.title}\u0000${entry.author}\u0000${entry.text}\u0000${entry.note}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
