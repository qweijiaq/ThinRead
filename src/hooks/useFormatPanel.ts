import { useCallback, useRef, useState } from 'react'

import type { ChapterContent, ReaderStyle } from '../../shared/types.js'
import type { FormatMessage } from '../components/FormatPanel.js'
import { messageOf } from '../lib/errors.js'

interface FormatPanelOptions {
  chapterId: string | null
  setChapter(updater: (current: ChapterContent | null) => ChapterContent | null): void
  setStyle(style: ReaderStyle): void
}

export interface FormatPanelState {
  busy: boolean
  error: string | null
  note: string | null
  messages: FormatMessage[]
  formatCurrentChapter(instruction?: string): Promise<void>
  resetChapterFormat(): Promise<void>
  /** 切换章节时重置排版面板，并让进行中的请求作废。 */
  resetFormatState(): void
}

/** 单章 AI 排版：请求、结果写回章节、以及切换章节时的作废。 */
export function useFormatPanel(options: FormatPanelOptions): FormatPanelState {
  const { chapterId, setChapter, setStyle } = options
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [messages, setMessages] = useState<FormatMessage[]>([])
  const tokenRef = useRef(0)

  const resetFormatState = useCallback(() => {
    tokenRef.current += 1
    setBusy(false)
    setError(null)
    setNote(null)
    setMessages([])
  }, [])

  const formatCurrentChapter = useCallback(
    async (instruction?: string) => {
      if (!chapterId) return
      const token = ++tokenRef.current
      setBusy(true)
      setError(null)
      setNote(null)
      if (instruction?.trim()) {
        setMessages((previous) => [...previous, { role: 'user', text: instruction.trim() }])
      }
      try {
        const result = await window.api.formatChapter(chapterId, instruction)
        if (token !== tokenRef.current) return
        setChapter((current) =>
          current && current.id === chapterId
            ? { ...current, formattedHtml: result.html, removed: result.removed }
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
    tokenRef.current += 1
    setBusy(false)
    setError(null)
    setNote(null)
    setMessages([])
    try {
      await window.api.resetChapterFormat(chapterId)
      setChapter((current) =>
        current && current.id === chapterId ? { ...current, formattedHtml: null, removed: [] } : current,
      )
    } catch (err) {
      setError(messageOf(err))
    }
  }, [chapterId, setChapter])

  return { busy, error, note, messages, formatCurrentChapter, resetChapterFormat, resetFormatState }
}
