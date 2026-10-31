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
  highlights?: unknown
}

interface ReadwiseExport {
  results?: unknown
  nextPageCursor?: unknown
}

const ENDPOINT = 'https://readwise.io/api/v2/export/'
const MAX_PAGES = 20

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}

/** 从 Readwise 官方 export API 拉取全部划线；token 只保存在本机设置里。 */
export async function fetchReadwiseEntries(token: string): Promise<HighlightEntry[]> {
  if (!token.trim()) throw new Error('还没有配置 Readwise API Token。')
  const entries: HighlightEntry[] = []
  let cursor = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = cursor ? `${ENDPOINT}?pageCursor=${encodeURIComponent(cursor)}` : ENDPOINT
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
    const payload = (await response.json()) as ReadwiseExport
    const books = Array.isArray(payload.results) ? (payload.results as ReadwiseBook[]) : []
    for (const book of books) {
      const title = stringValue(book.title)
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
    cursor = stringValue(payload.nextPageCursor)
    if (!cursor) break
  }
  return entries
}
