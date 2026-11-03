import { useCallback, useState } from 'react'

import type { BookSummary, ChapterContent, ChapterMeta } from '../../shared/types.js'

export type RenameTarget =
  | { kind: 'book'; bookId: string; value: string; author: string }
  | { kind: 'chapter'; chapterId: string; value: string }
  | { kind: 'part'; bookId: string; partIndex: number; value: string }

interface RenameOptions {
  bookId: string | null
  setBooks: React.Dispatch<React.SetStateAction<BookSummary[]>>
  setBook: React.Dispatch<React.SetStateAction<BookSummary | null>>
  setChapters: React.Dispatch<React.SetStateAction<ChapterMeta[]>>
  setChapter: React.Dispatch<React.SetStateAction<ChapterContent | null>>
}

export interface RenameState {
  renameTarget: RenameTarget | null
  setRenameTarget: React.Dispatch<React.SetStateAction<RenameTarget | null>>
  startRenameBook(target: BookSummary): void
  startRenameChapter(target: ChapterMeta): void
  startRenamePart(partIndex: number, title: string): void
  saveRename(value: string, secondary?: string): Promise<void>
}

/** 书名/作者、章节名和分篇名的重命名。 */
export function useRename(options: RenameOptions): RenameState {
  const { bookId, setBooks, setBook, setChapters, setChapter } = options
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)

  const startRenameBook = useCallback((target: BookSummary) => {
    setRenameTarget({ kind: 'book', bookId: target.id, value: target.title, author: target.author })
  }, [])

  const startRenameChapter = useCallback((target: ChapterMeta) => {
    setRenameTarget({ kind: 'chapter', chapterId: target.id, value: target.title })
  }, [])

  const startRenamePart = useCallback(
    (partIndex: number, title: string) => {
      if (!bookId) return
      setRenameTarget({ kind: 'part', bookId, partIndex, value: title })
    },
    [bookId],
  )

  const saveRename = useCallback(
    async (value: string, secondary?: string) => {
      if (!renameTarget) return
      const title = value.replace(/\s+/g, ' ').trim()
      if (!title) throw new Error('标题不能为空。')
      if (renameTarget.kind === 'book') {
        const updated = await window.api.renameBook(
          renameTarget.bookId,
          title,
          secondary === undefined ? renameTarget.author : secondary.trim(),
        )
        setBooks((current) => current.map((item) => (item.id === updated.id ? updated : item)))
        setBook((current) => (current?.id === updated.id ? updated : current))
        return
      }
      if (renameTarget.kind === 'chapter') {
        await window.api.renameChapter(renameTarget.chapterId, title)
        setChapters((current) =>
          current.map((item) => (item.id === renameTarget.chapterId ? { ...item, title } : item)),
        )
        setChapter((current) => (current && current.id === renameTarget.chapterId ? { ...current, title } : current))
        return
      }
      await window.api.renamePart(renameTarget.bookId, renameTarget.partIndex, title)
      setChapters((current) =>
        current.map((item) => (item.partIndex === renameTarget.partIndex ? { ...item, partTitle: title } : item)),
      )
      setChapter((current) =>
        current && current.partIndex === renameTarget.partIndex ? { ...current, partTitle: title } : current,
      )
    },
    [renameTarget, setBook, setBooks, setChapter, setChapters],
  )

  return {
    renameTarget,
    setRenameTarget,
    startRenameBook,
    startRenameChapter,
    startRenamePart,
    saveRename,
  }
}
