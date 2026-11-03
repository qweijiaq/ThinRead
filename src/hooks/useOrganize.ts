import { useCallback, useState } from 'react'

import type { ChapterFlag, ChapterSuggestion, ClassifyResult } from '../../shared/types.js'
import { messageOf } from '../lib/errors.js'

import type { ToastState } from './useToast.js'

interface OrganizeOptions {
  bookId: string | null
  refreshBook(bookId: string): Promise<void>
  notify(toast: ToastState): void
}

export interface OrganizeState {
  organizeOpen: boolean
  setOrganizeOpen: React.Dispatch<React.SetStateAction<boolean>>
  chapterTrashOpen: boolean
  setChapterTrashOpen: React.Dispatch<React.SetStateAction<boolean>>
  suggestions: ChapterSuggestion[]
  classifyMode: ClassifyResult['mode'] | null
  classifyError: string | null
  classifying: boolean
  openOrganize(): void
  classifyChaptersForBook(): Promise<void>
  applyChapterFlags(flags: ChapterFlag[]): Promise<void>
  deleteChapterList(chapterIds: string[]): Promise<void>
  /** 切书时清掉上一本的分类结果和整理面板。 */
  resetOrganize(): void
}

/** 整理目录：AI/本地规则分类、应用隐藏/删除标记，以及章节回收站入口。 */
export function useOrganize(options: OrganizeOptions): OrganizeState {
  const { bookId, refreshBook, notify } = options
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const [chapterTrashOpen, setChapterTrashOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<ChapterSuggestion[]>([])
  const [classifyMode, setClassifyMode] = useState<ClassifyResult['mode'] | null>(null)
  const [classifyError, setClassifyError] = useState<string | null>(null)
  const [classifying, setClassifying] = useState(false)

  const resetOrganize = useCallback(() => {
    setOrganizeOpen(false)
    setSuggestions([])
    setClassifyMode(null)
    setClassifyError(null)
  }, [])

  const openOrganize = useCallback(() => setOrganizeOpen(true), [])

  const classifyChaptersForBook = useCallback(async () => {
    if (!bookId) return
    setClassifying(true)
    setClassifyError(null)
    try {
      const result = await window.api.classifyChapters(bookId)
      setSuggestions(result.suggestions)
      setClassifyMode(result.mode)
      setClassifyError(result.error ?? null)
    } catch (err) {
      setClassifyError(messageOf(err))
    } finally {
      setClassifying(false)
    }
  }, [bookId])

  const applyChapterFlags = useCallback(
    async (flags: ChapterFlag[]) => {
      if (!bookId) return
      try {
        await window.api.applyChapterFlags(flags)
        await refreshBook(bookId)
      } catch (err) {
        notify({ kind: 'error', text: messageOf(err) })
      }
    },
    [bookId, notify, refreshBook],
  )

  const deleteChapterList = useCallback(
    async (chapterIds: string[]) => {
      if (!bookId) return
      try {
        await window.api.deleteChapters(chapterIds)
        await refreshBook(bookId)
      } catch (err) {
        notify({ kind: 'error', text: messageOf(err) })
      }
    },
    [bookId, notify, refreshBook],
  )

  return {
    organizeOpen,
    setOrganizeOpen,
    chapterTrashOpen,
    setChapterTrashOpen,
    suggestions,
    classifyMode,
    classifyError,
    classifying,
    openOrganize,
    classifyChaptersForBook,
    applyChapterFlags,
    deleteChapterList,
    resetOrganize,
  }
}
