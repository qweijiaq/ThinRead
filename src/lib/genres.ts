import type { BookGenre } from '../../shared/types.js'

export const BOOK_GENRE_OPTIONS: Array<{ value: BookGenre; label: string }> = [
  { value: 'auto', label: '自动判断' },
  { value: 'nonfiction', label: '非虚构' },
  { value: 'history', label: '历史' },
  { value: 'historical-fiction', label: '历史小说' },
  { value: 'fiction', label: '小说' },
  { value: 'detective', label: '侦探 / 悬疑' },
  { value: 'biography', label: '传记 / 回忆录' },
  { value: 'myth', label: '神话 / 奇幻' },
  { value: 'other', label: '其他' },
]

export function bookGenreLabel(genre: BookGenre | undefined): string {
  return BOOK_GENRE_OPTIONS.find((item) => item.value === genre)?.label ?? '自动判断'
}
