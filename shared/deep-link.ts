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
