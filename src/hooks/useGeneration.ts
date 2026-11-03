import { useCallback, useEffect, useState } from 'react'

import type { BookSummary, ChapterContent, GeneratePartial, Note, ReaderStyle } from '../../shared/types.js'
import { messageOf } from '../lib/errors.js'

import type { ToastState } from './useToast.js'

export interface GenerationOptions {
  chapterId: string | null
  bookId: string | null
  setNotes(notes: Note[]): void
  setAllNotes(notes: Note[]): void
  setChapter(updater: (current: ChapterContent | null) => ChapterContent | null): void
  setBooks(updater: (current: BookSummary[]) => BookSummary[]): void
  applyStyle(style: Partial<ReaderStyle>): void
  notify(toast: ToastState): void
}

export interface GenerationState {
  generating: boolean
  setGenerating: React.Dispatch<React.SetStateAction<boolean>>
  partial: GeneratePartial | null
  setPartial: React.Dispatch<React.SetStateAction<GeneratePartial | null>>
  error: string | null
  setError: React.Dispatch<React.SetStateAction<string | null>>
  generate(): Promise<void>
  cancelGeneration(): Promise<void>
  /** 切章前调用：取消进行中的生成并清空进度/错误。 */
  resetGeneration(): void
}

/** 当前章节的生成状态、订阅和取消。写入笔记/章节/书架的动作通过 options 回调交给 App。 */
export function useGeneration(options: GenerationOptions): GenerationState {
  const { chapterId, bookId, setNotes, setAllNotes, setChapter, setBooks, applyStyle, notify } = options
  const [generating, setGenerating] = useState(false)
  const [partial, setPartial] = useState<GeneratePartial | null>(null)
  const [error, setError] = useState<string | null>(null)

  const resetGeneration = useCallback(() => {
    void window.api.cancelGeneration()
    setGenerating(false)
    setPartial(null)
    setError(null)
  }, [])

  useEffect(() => {
    const offPartial = window.api.onGenerationPartial((event) => {
      if (event.chapterId !== chapterId) return
      setGenerating(true)
      setPartial(event.partial)
      setError(null)
    })
    const offDone = window.api.onGenerationDone((event) => {
      if (event.chapterId === chapterId) {
        setGenerating(false)
        setPartial(null)
        setNotes(event.notes)
        setChapter((current) =>
          current && current.id === event.chapterId ? { ...current, noteReport: event.report } : current,
        )
      }
      if (bookId) {
        void window.api
          .listNotes(bookId)
          .then((items) => {
            setAllNotes(items)
            setBooks((current) =>
              current.map((item) => (item.id === bookId ? { ...item, noteCount: items.length } : item)),
            )
          })
          .catch(() => undefined)
      }
    })
    const offError = window.api.onGenerationError((event) => {
      if (event.chapterId !== chapterId) return
      setGenerating(false)
      setPartial(null)
      setError(event.message)
    })
    const offFormatted = window.api.onChapterFormatted((event) => {
      if (event.chapterId !== chapterId) return
      setChapter((current) =>
        current && current.id === event.chapterId
          ? { ...current, formattedHtml: event.html, removed: event.removed }
          : current,
      )
      applyStyle(event.style)
    })
    const offBookDone = window.api.onBookGenerationDone((event) => {
      if (event.bookId !== bookId) return
      notify({
        kind: event.failed.length > 0 ? 'error' : 'info',
        text: event.cancelled
          ? '整本生成已取消。'
          : `整本生成完成：新生成 ${event.generated} 节${event.failed.length > 0 ? `，失败 ${event.failed.length} 节` : ''}。`,
      })
      void window.api
        .listNotes(event.bookId)
        .then((items) => {
          setAllNotes(items)
          setBooks((current) =>
            current.map((item) => (item.id === event.bookId ? { ...item, noteCount: items.length } : item)),
          )
        })
        .catch(() => undefined)
    })
    return () => {
      offPartial()
      offDone()
      offError()
      offBookDone()
      offFormatted()
    }
  }, [chapterId, bookId, setNotes, setAllNotes, setChapter, setBooks, applyStyle, notify])

  const generate = useCallback(async (fresh = false) => {
    if (!chapterId) return
    setError(null)
    setGenerating(true)
    setPartial(null)
    try {
      await window.api.generateNotes(chapterId, { fresh })
    } catch (err) {
      setGenerating(false)
      setPartial(null)
      setError(messageOf(err))
    }
  }, [chapterId])

  const cancelGeneration = useCallback(async () => {
    await window.api.cancelGeneration()
    setGenerating(false)
    setPartial(null)
  }, [])

  return {
    generating,
    setGenerating,
    partial,
    setPartial,
    error,
    setError,
    generate,
    cancelGeneration,
    resetGeneration,
  }
}
