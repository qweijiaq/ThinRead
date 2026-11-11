import { t } from '../lib/i18n.js'
import type { BookGenre } from '../../shared/types.js'

export const BOOK_GENRE_OPTIONS: Array<{ value: BookGenre; label: string }> = [
  { value: 'auto', label: t('自动判断') },
  { value: 'nonfiction', label: t('非虚构') },
  { value: 'history', label: t('历史') },
  { value: 'historical-fiction', label: t('历史小说') },
  { value: 'fiction', label: t('小说') },
  { value: 'detective', label: t('侦探 / 悬疑') },
  { value: 'biography', label: t('传记 / 回忆录') },
  { value: 'myth', label: t('神话 / 奇幻') },
  { value: 'other', label: t('其他') },
]

export function bookGenreLabel(genre: BookGenre | undefined): string {
  return BOOK_GENRE_OPTIONS.find((item) => item.value === genre)?.label ?? t('自动判断')
}
