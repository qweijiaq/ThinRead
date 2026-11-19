import { bridge } from '../lib/bridge.js'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ChapterContent, ReaderStyle } from '../../shared/types.js'
import type { FormatMessage } from '../components/FormatPanel.js'
import { confirmDialog } from '../components/ConfirmDialog.js'
import { messageOf } from '../lib/errors.js'
import { t } from '../lib/i18n.js'
import type { ToastState } from './useToast.js'

interface FormatPanelOptions {
  chapterId: string | null
  setChapter(updater: (current: ChapterContent | null) => ChapterContent | null): void
  setStyle(style: ReaderStyle): void
  notify?(toast: ToastState): void
}

export interface FormatPanelState {
  busy: boolean
  error: string | null
  note: string | null
  messages: FormatMessage[]
  formatCurrentChapter(instruction?: string, options?: { skipReferences?: boolean }): Promise<void>
  resetChapterFormat(): Promise<void>
  /** 切换章节时重置面板；后台排版继续执行，回来后再接上。 */
  resetFormatState(): void
}

/** 单章 AI 排版：请求、结果写回章节、切章后重新接上后台任务。 */
export function useFormatPanel(options: FormatPanelOptions): FormatPanelState {
  const { chapterId, setChapter, setStyle, notify } = options
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [messages, setMessages] = useState<FormatMessage[]>([])
  const tokenRef = useRef(0)
  const [attachKey, setAttachKey] = useState(0)

  const resetFormatState = useCallback(() => {
    // 只清空面板；主进程里的排版任务继续跑。
    tokenRef.current += 1
    setBusy(false)
    setError(null)
    setNote(null)
    setMessages([])
    setAttachKey((value) => value + 1)
  }, [])

  useEffect(() => {
    if (!chapterId) return
    let cancelled = false
    void bridge
      .getChapterAiJobs(chapterId)
      .then((jobs) => {
        if (cancelled) return
        const job = jobs.format
        if (!job) {
          setBusy(false)
          return
        }
        if (job.status === 'running') {
          setBusy(true)
          setNote(job.detail)
          setError(null)
          return
        }
        setBusy(false)
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

  const offerFormatUndo = useCallback(
    (id: string) => {
      notify?.({
        kind: 'info',
        text: t('已完成排版'),
        action: {
          label: t('撤销'),
          onClick: () => {
            void bridge
              .undoChapterContent(id)
              .then((undone) => {
                setChapter((current) =>
                  current && current.id === id
                    ? { ...current, formattedHtml: undone.html, removed: [], chars: undone.chars }
                    : current,
                )
                notify?.({ kind: 'info', text: t('已撤销排版。') })
              })
              .catch((err: unknown) => notify?.({ kind: 'error', text: messageOf(err) }))
          },
        },
      })
    },
    [notify, setChapter],
  )

  useEffect(() => {
    const off = bridge.onChapterFormatted((event) => {
      if (event.chapterId !== chapterId) return
      setBusy(false)
      setNote(event.note)
      setError(null)
      setChapter((current) =>
        current && current.id === event.chapterId
          ? { ...current, formattedHtml: event.html, removed: event.removed, chars: event.chars }
          : current,
      )
      setStyle(event.style)
      offerFormatUndo(event.chapterId)
    })
    return off
  }, [chapterId, offerFormatUndo, setChapter, setStyle])

  const formatCurrentChapter = useCallback(
    async (instruction?: string, options?: { skipReferences?: boolean }) => {
      if (!chapterId) return
      const token = ++tokenRef.current
      setBusy(true)
      setError(null)
      setNote(null)
      if (instruction?.trim()) {
        setMessages((previous) => [...previous, { role: 'user', text: instruction.trim() }])
      }
      try {
        const result = await bridge.formatChapter(chapterId, instruction, options)
        if (token !== tokenRef.current) return
        setChapter((current) =>
          current && current.id === chapterId
            ? { ...current, formattedHtml: result.html, removed: result.removed, chars: result.chars }
            : current,
        )
        setStyle(result.style)
        setNote(result.note)
        if (instruction?.trim()) {
          setMessages((previous) => [...previous, { role: 'ai', text: result.note }])
        }
      } catch (err) {
        if (token !== tokenRef.current) return
        setError(messageOf(err))
      } finally {
        if (token === tokenRef.current) setBusy(false)
      }
    },
    [chapterId, setChapter, setStyle],
  )

  const resetChapterFormat = useCallback(async () => {
    if (!chapterId) return
    const confirmed = await confirmDialog({
      title: t('还原原文'),
      message: t('会丢弃当前 AI 排版和手工修改过的正文，恢复导入时的原文。继续？'),
      confirmLabel: t('还原原文'),
      danger: true,
    })
    if (!confirmed) return
    tokenRef.current += 1
    setBusy(false)
    setError(null)
    setNote(null)
    setMessages([])
    try {
      const chars = await bridge.resetChapterFormat(chapterId)
      setChapter((current) =>
        current && current.id === chapterId ? { ...current, formattedHtml: null, removed: [], chars } : current,
      )
      notify?.({
        kind: 'info',
        text: t('已还原原文'),
        action: {
          label: t('撤销'),
          onClick: () => {
            void bridge
              .undoChapterContent(chapterId)
              .then((undone) => {
                setChapter((current) =>
                  current && current.id === chapterId
                    ? { ...current, formattedHtml: undone.html, removed: [], chars: undone.chars }
                    : current,
                )
                notify?.({ kind: 'info', text: t('已撤销还原。') })
              })
              .catch((err: unknown) => notify?.({ kind: 'error', text: messageOf(err) }))
          },
        },
      })
    } catch (err) {
      setError(messageOf(err))
    }
  }, [chapterId, setChapter, notify])

  return { busy, error, note, messages, formatCurrentChapter, resetChapterFormat, resetFormatState }
}
