import { bridge } from '../lib/bridge.js'
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  BookTranslationInfo,
  BookTranslationOptions,
  BookTranslationProgress,
} from '../../shared/types.js'
import { messageOf } from '../lib/errors.js'

import type { ToastState } from './useToast.js'

export interface BookTranslationState {
  info: BookTranslationInfo | null
  running: boolean
  progress: BookTranslationProgress | null
  refresh(): Promise<void>
  translateBook(options?: BookTranslationOptions): Promise<void>
}

/**
 * 整本翻译状态：只在书以外文为主时提供入口，进度和完成状态跟任务中心共用同一条主进程任务。
 */
export function useBookTranslation(
  bookId: string | null,
  notify: (toast: ToastState) => void,
): BookTranslationState {
  const [info, setInfo] = useState<BookTranslationInfo | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<BookTranslationProgress | null>(null)
  const bookIdRef = useRef(bookId)
  bookIdRef.current = bookId

  const refresh = useCallback(async () => {
    if (!bookId) {
      setInfo(null)
      return
    }
    try {
      const next = await bridge.getBookTranslationInfo(bookId)
      if (bookIdRef.current === bookId) setInfo(next)
    } catch {
      // 翻译状态只影响入口显示；读取失败时保持上一次结果。
    }
  }, [bookId])

  useEffect(() => {
    setInfo(null)
    setRunning(false)
    setProgress(null)
    void refresh()
  }, [bookId, refresh])

  useEffect(() => {
    if (!bookId) return
    const offProgress = bridge.onBookTranslationProgress((event) => {
      if (event.bookId !== bookId) return
      setRunning(true)
      setProgress(event)
      setInfo((current) => (current ? { ...current, translated: event.translated } : current))
    })
    const offDone = bridge.onBookTranslationDone((event) => {
      if (event.bookId !== bookId) return
      setRunning(false)
      setProgress(null)
      void refresh()
      if (event.error) {
        notify({ kind: 'error', text: event.error })
      } else if (!event.cancelled && event.failed.length > 0) {
        notify({
          kind: 'error',
          text: `全书翻译有 ${event.failed.length} 章失败，可在任务中心继续重试。`,
        })
      }
    })
    // 单章翻译或全书翻译完成一章后，都刷新入口上的「还可翻译 N 章」。
    const offChapter = bridge.onChapterTranslated(() => {
      void refresh()
    })
    return () => {
      offProgress()
      offDone()
      offChapter()
    }
  }, [bookId, notify, refresh])

  const translateBook = useCallback(
    async (options?: BookTranslationOptions) => {
      if (!bookId) return
      setRunning(true)
      setProgress(null)
      try {
        await bridge.translateBook(bookId, options)
      } catch (error) {
        setRunning(false)
        const message = messageOf(error)
        notify({ kind: 'error', text: message })
      }
    },
    [bookId, notify],
  )

  return { info, running, progress, refresh, translateBook }
}
