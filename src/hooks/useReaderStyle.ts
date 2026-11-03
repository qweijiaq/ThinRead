import { useCallback, useEffect, useRef, useState } from 'react'

import { DEFAULT_READER_STYLE, type ReaderStyle } from '../../shared/types.js'

const THEME_KEY = 'reading-notes-theme'

function loadStoredTheme(): ReaderStyle['theme'] {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'paper' || stored === 'plain' || stored === 'warm' || stored === 'folio') return stored
  } catch {
    // localStorage 不可用时使用默认主题。
  }
  return DEFAULT_READER_STYLE.theme
}

export interface ReaderStyleState {
  appTheme: ReaderStyle['theme']
  setAppTheme(theme: ReaderStyle['theme']): void
  readerStyle: ReaderStyle
  setReaderStyle: React.Dispatch<React.SetStateAction<ReaderStyle>>
  updateReaderStyle(patch: Partial<ReaderStyle>): void
}

/**
 * 主题和阅读排版：负责写 <html> class、记住主题、以及按书保存排版偏好。
 * 保存做了 250ms 防抖；切换书籍或卸载时会把还没落盘的改动补一次。
 */
export function useReaderStyle(bookId: string | null): ReaderStyleState {
  const [appTheme, setAppTheme] = useState<ReaderStyle['theme']>(loadStoredTheme)
  const [readerStyle, setReaderStyle] = useState<ReaderStyle>(DEFAULT_READER_STYLE)
  const styleSaveTimer = useRef<number | null>(null)
  // 记录“还没落盘的那一次改动”，带上它属于哪本书；这样切书时不会把新书的样式写进旧书。
  const pendingSave = useRef<{ bookId: string; style: ReaderStyle } | null>(null)

  useEffect(() => {
    document.documentElement.className = `theme-${appTheme}`
    try {
      localStorage.setItem(THEME_KEY, appTheme)
    } catch {
      // 忽略存储失败；当前会话仍然使用这个主题。
    }
  }, [appTheme])

  const flush = useCallback(() => {
    if (styleSaveTimer.current !== null) {
      window.clearTimeout(styleSaveTimer.current)
      styleSaveTimer.current = null
    }
    const item = pendingSave.current
    pendingSave.current = null
    if (item) void window.api.saveStyle(item.bookId, item.style)
  }, [])

  // 切换书籍或退出时补一次保存。
  useEffect(() => () => flush(), [bookId, flush])

  const updateReaderStyle = useCallback(
    (patch: Partial<ReaderStyle>) => {
      setReaderStyle((current) => {
        const next = { ...current, ...patch }
        if (!bookId) return next
        pendingSave.current = { bookId, style: next }
        if (styleSaveTimer.current !== null) window.clearTimeout(styleSaveTimer.current)
        styleSaveTimer.current = window.setTimeout(() => {
          styleSaveTimer.current = null
          flush()
        }, 250)
        return next
      })
    },
    [bookId, flush],
  )

  return { appTheme, setAppTheme, readerStyle, setReaderStyle, updateReaderStyle }
}
