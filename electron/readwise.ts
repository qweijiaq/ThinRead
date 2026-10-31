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
const V3_ENDPOINT = 'https://readwise.io/api/v3/export/'
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

/** 从 Readwise 官方 export API 拉取全部划线；同时兼容 v2 和 Reader v3。 */
export async function fetchReadwiseEntries(token: string): Promise<HighlightEntry[]> {
  if (!token.trim()) throw new Error('还没有配置 Readwise API Token。')
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

  // Reader-only 账号的划线不在 v2 export 里，回退到 Reader v3 export。
  if (entries.length === 0) {
    try {
      const payload = await fetchJson(V3_ENDPOINT, token)
      const books = Array.isArray(payload)
        ? (payload as ReadwiseBook[])
        : payload && typeof payload === 'object' && Array.isArray((payload as ReadwiseExport).results)
          ? ((payload as ReadwiseExport).results as ReadwiseBook[])
          : []
      mapBooks(books, entries)
    } catch (error) {
      // 没有 Reader API 的账号会返回 404；这不是同步失败，只是没有可合并的 Reader 书库。
      if (!(error instanceof Error) || !/HTTP 404/.test(error.message)) throw error
    }
  }

  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = `${entry.title}\u0000${entry.author}\u0000${entry.text}\u0000${entry.note}\u0000${entry.location}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
