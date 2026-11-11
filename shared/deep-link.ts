export interface DeepLinkTarget {
  bookId: string
  chapterId: string | null
  quote: string | null
}

/**
 * 支持：
 * thinread://book/<bookId>/chapter/<chapterId>?quote=...
 * thinread://book/<bookId>?chapter=<chapterId>&quote=...
 */
export function parseDeepLink(raw: string): DeepLinkTarget | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'thinread:' || url.hostname !== 'book') return null
  const segments = url.pathname.split('/').filter(Boolean)
  const bookId = decodeURIComponent(segments[0] ?? '')
  if (!bookId) return null
  let chapterId = segments[1] === 'chapter' && segments[2] ? decodeURIComponent(segments[2]) : null
  if (!chapterId) chapterId = url.searchParams.get('chapter')
  const quote = url.searchParams.get('quote')
  return {
    bookId,
    chapterId: chapterId || null,
    quote: quote?.trim() || null,
  }
}


export interface CaptureLinkTarget {
  url: string
  title: string
  selection: string | null
}

/**
 * 浏览器扩展使用：
 * thinread://capture?url=<页面地址>&title=<标题>&selection=<选中文字>
 */
export function parseCaptureLink(raw: string): CaptureLinkTarget | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'thinread:' || parsed.hostname !== 'capture') return null
  const pageUrl = parsed.searchParams.get('url')?.trim() ?? ''
  if (!/^https?:\/\//i.test(pageUrl)) return null
  const title = (parsed.searchParams.get('title') ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
  const selection = (parsed.searchParams.get('selection') ?? '').trim().slice(0, 20_000)
  return {
    url: pageUrl,
    title: title || pageUrl,
    selection: selection || null,
  }
}
