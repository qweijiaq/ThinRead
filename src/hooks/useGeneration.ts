import { t } from '../lib/i18n.js'
import { bridge } from '../lib/bridge.js'
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
  generate(fresh?: boolean): Promise<void>
  cancelGeneration(): Promise<void>
  /** 切章前调用：清空进度/错误；后台生成继续执行，回来后再接上。 */
  resetGeneration(): void
}

/** 当前章节的生成状态、订阅和取消。写入笔记/章节/书架的动作通过 options 回调交给 App。 */
export function useGeneration(options: GenerationOptions): GenerationState {
  const { chapterId, bookId, setNotes, setAllNotes, setChapter, setBooks, applyStyle, notify } = options
  const [generating, setGenerating] = useState(false)
  const [partial, setPartial] = useState<GeneratePartial | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attachKey, setAttachKey] = useState(0)

  const resetGeneration = useCallback(() => {
    // 只重置当前界面状态；后台任务继续跑，切回章节时再重新接上。
    setGenerating(false)
    setPartial(null)
    setError(null)
    setAttachKey((value) => value + 1)
  }, [])

  useEffect(() => {
    if (!chapterId) return
    let cancelled = false
    void bridge
      .getChapterAiJobs(chapterId)
      .then((jobs) => {
        if (cancelled) return
        const job = jobs.notes
        if (!job) {
          setGenerating(false)
          setPartial(null)
          return
        }
        if (job.status === 'running') {
          setGenerating(true)
          setPartial(job.partial ?? null)
          setError(null)
          return
        }
        setGenerating(false)
        setPartial(null)
        if (
          job.status === 'error' &&
          job.error &&
          Date.now() - Date.parse(job.updatedAt) < 10 * 60 * 1000
        ) {
          setError(job.error)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [chapterId, attachKey])

  useEffect(() => {
    const offPartial = bridge.onGenerationPartial((event) => {
      if (event.chapterId !== chapterId) return
      setGenerating(true)
      setPartial(event.partial)
      setError(null)
    })
    const offDone = bridge.onGenerationDone((event) => {
      if (event.chapterId === chapterId) {
        setGenerating(false)
        setPartial(null)
        setNotes(event.notes)
        setChapter((current) =>
          current && current.id === event.chapterId ? { ...current, noteReport: event.report } : current,
        )
      }
      if (bookId) {
        void bridge
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
    const offError = bridge.onGenerationError((event) => {
      if (event.chapterId !== chapterId) return
      setGenerating(false)
      setPartial(null)
      setError(event.message)
    })
    const offFormatted = bridge.onChapterFormatted((event) => {
      if (event.chapterId !== chapterId) return
      setChapter((current) =>
        current && current.id === event.chapterId
          ? { ...current, formattedHtml: event.html, removed: event.removed, chars: event.chars }
          : current,
      )
      applyStyle(event.style)
    })
    const offBookDone = bridge.onBookGenerationDone((event) => {
      if (event.bookId !== bookId) return
      notify({
        kind: event.failed.length > 0 ? 'error' : 'info',
        text: event.cancelled
          ? t('整本生成已取消。')
          : `${t('整本生成完成：新生成 ')}${event.generated}${t(' 节')}${event.failed.length > 0 ? `${t('，失败 ')}${event.failed.length}${t(' 节')}` : ''}。`,
      })
      void bridge
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
      await bridge.generateNotes(chapterId, { fresh })
    } catch (err) {
      setGenerating(false)
      setPartial(null)
      setError(messageOf(err))
    }
  }, [chapterId])

  const cancelGeneration = useCallback(async () => {
    if (chapterId) await bridge.cancelGeneration({ chapterId })
    setGenerating(false)
    setPartial(null)
  }, [chapterId])

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
