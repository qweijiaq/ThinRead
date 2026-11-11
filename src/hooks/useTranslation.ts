import { bridge } from '../lib/bridge.js'
import { useCallback, useEffect, useState } from 'react'

import type { ChapterContent } from '../../shared/types.js'
import { messageOf } from '../lib/errors.js'

import type { ToastState } from './useToast.js'

interface TranslationOptions {
  chapter: ChapterContent | null
  setChapter(updater: (current: ChapterContent | null) => ChapterContent | null): void
  notify(toast: ToastState): void
}

export interface TranslationState {
  translating: boolean
  showTranslation: boolean
  progress: { done: number; total: number } | null
  error: string | null
  hasTranslation: boolean
  toggle(): void
  retranslate(): Promise<void>
  cancel(): Promise<void>
}

/** 单章 AI 翻译：后台任务、切章重连，以及在原文/译文之间切换。 */
export function useTranslation(options: TranslationOptions): TranslationState {
  const { chapter, setChapter, notify } = options
  const chapterId = chapter?.id ?? null
  const [translating, setTranslating] = useState(false)
  const [showTranslation, setShowTranslation] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setShowTranslation(false)
    setTranslating(false)
    setProgress(null)
    setError(null)
    if (!chapterId) return
    let cancelled = false
    void bridge
      .getChapterAiJobs(chapterId)
      .then((jobs) => {
        if (cancelled) return
        const job = jobs.translate
        if (job?.status === 'running') {
          setTranslating(true)
          setProgress(job.total > 0 ? { done: job.done, total: job.total } : null)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [chapterId])

  useEffect(() => {
    if (!chapterId) return
    const offProgress = bridge.onChapterTranslationProgress((event) => {
      if (event.chapterId !== chapterId) return
      setTranslating(true)
      setError(null)
      setProgress({ done: event.done, total: event.total })
    })
    const offDone = bridge.onChapterTranslated((event) => {
      if (event.chapterId !== chapterId) return
      setTranslating(false)
      setProgress(null)
      setError(null)
      setShowTranslation(true)
      setChapter((current) =>
        current && current.id === event.chapterId
          ? {
              ...current,
              translatedText: event.text,
              translatedHtml: event.html || current.translatedHtml,
              translatedAt: event.translatedAt,
            }
          : current,
      )
    })
    const offError = bridge.onChapterTranslationError((event) => {
      if (event.chapterId !== chapterId) return
      setTranslating(false)
      setProgress(null)
      const message = event.message
      if (/abort|cancel/i.test(message)) return
      setError(message)
      notify({ kind: 'error', text: message })
    })
    return () => {
      offProgress()
      offDone()
      offError()
    }
  }, [chapterId, notify, setChapter])

  const hasTranslation = Boolean(chapter?.translatedHtml?.trim() || chapter?.translatedText?.trim())

  const translate = useCallback(
    async (force = false) => {
      if (!chapterId) return
      if (!force && (chapter?.translatedHtml?.trim() || chapter?.translatedText?.trim())) {
        setShowTranslation(true)
        return
      }
      setTranslating(true)
      setError(null)
      setProgress(null)
      try {
        await bridge.translateChapter(chapterId, force ? { force: true } : undefined)
      } catch (err) {
        setTranslating(false)
        setError(messageOf(err))
        notify({ kind: 'error', text: messageOf(err) })
      }
    },
    [chapter?.translatedHtml, chapter?.translatedText, chapterId, notify],
  )

  const toggle = useCallback(() => {
    if (hasTranslation) setShowTranslation((value) => !value)
    else void translate()
  }, [hasTranslation, translate])

  const retranslate = useCallback(() => translate(true), [translate])

  const cancel = useCallback(async () => {
    if (!chapterId) return
    await bridge.cancelTranslation({ chapterId })
    setTranslating(false)
    setProgress(null)
  }, [chapterId])

  return { translating, showTranslation, progress, error, hasTranslation, toggle, retranslate, cancel }
}
