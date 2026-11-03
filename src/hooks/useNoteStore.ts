import { useCallback, useState } from 'react'

import type { Note } from '../../shared/types.js'

export interface NoteStore {
  notes: Note[]
  allNotes: Note[]
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>
  setAllNotes: React.Dispatch<React.SetStateAction<Note[]>>
  refreshNotes(bookId: string, chapterId: string | null): Promise<void>
  resetNotes(): void
  patchNote(updated: Note): void
}

/** 当前章节笔记 + 整本书笔记；生成/删除/恢复等流程共用这一份状态。 */
export function useNoteStore(): NoteStore {
  const [notes, setNotes] = useState<Note[]>([])
  const [allNotes, setAllNotes] = useState<Note[]>([])

  const refreshNotes = useCallback(async (bookId: string, chapterId: string | null) => {
    const [chapterNotes, all] = await Promise.all([
      chapterId ? window.api.listNotes(bookId, chapterId) : Promise.resolve([]),
      window.api.listNotes(bookId),
    ])
    setNotes(chapterNotes)
    setAllNotes(all)
  }, [])

  const resetNotes = useCallback(() => {
    setNotes([])
    setAllNotes([])
  }, [])

  /** 保存后只替换这一条，不再整本重新拉取。 */
  const patchNote = useCallback((updated: Note) => {
    setNotes((current) => current.map((note) => (note.id === updated.id ? updated : note)))
    setAllNotes((current) => current.map((note) => (note.id === updated.id ? updated : note)))
  }, [])

  return { notes, allNotes, setNotes, setAllNotes, refreshNotes, resetNotes, patchNote }
}
