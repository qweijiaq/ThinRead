import { useCallback, useState } from 'react'

import type { BookSummary, ChapterContent, Note, NoteDraft, NotePatch } from '../../shared/types.js'
import { messageOf } from '../lib/errors.js'
import { t } from '../lib/i18n.js'

import type { ToastState } from './useToast.js'

interface NoteActionsOptions {
  book: BookSummary | null
  chapter: ChapterContent | null
  books: BookSummary[]
  marginQuote: string | null
  refreshNotes(bookId: string, chapterId: string | null): Promise<void>
  patchNote(note: Note): void
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>
  setAllNotes: React.Dispatch<React.SetStateAction<Note[]>>
  setChapter: React.Dispatch<React.SetStateAction<ChapterContent | null>>
  setFocusNote: React.Dispatch<React.SetStateAction<{ id: string; key: number } | null>>
  notify(toast: ToastState): void
}

export interface NoteActions {
  expandingNoteId: string | null
  setExpandingNoteId: React.Dispatch<React.SetStateAction<string | null>>
  createNote(draft: NoteDraft): Promise<Note>
  saveTutorNote(title: string, content: string): Promise<void>
  saveLabReport(title: string, markdown: string, targetBookId: string, targetChapterId: string): Promise<void>
  saveMarginNote(markdown: string): Promise<void>
  updateNote(noteId: string, patch: NotePatch): Promise<void>
  removeNote(noteId: string): Promise<void>
  expandNote(noteId: string): Promise<void>
}

/** 笔记的创建、保存、删除撤销和「继续延伸」。 */
export function useNoteActions(options: NoteActionsOptions): NoteActions {
  const {
    book,
    chapter,
    books,
    marginQuote,
    refreshNotes,
    patchNote,
    setNotes,
    setAllNotes,
    setChapter,
    setFocusNote,
    notify,
  } = options
  const [expandingNoteId, setExpandingNoteId] = useState<string | null>(null)

  const createNote = useCallback(
    async (draft: NoteDraft): Promise<Note> => {
      const created = await window.api.createNote(draft)
      if (book) await refreshNotes(book.id, chapter?.id ?? null)
      setFocusNote({ id: created.id, key: Date.now() })
      return created
    },
    [book, chapter?.id, refreshNotes, setFocusNote],
  )

  const saveTutorNote = useCallback(
    async (title: string, content: string) => {
      if (!book || !chapter) throw new Error(t('先打开一章。'))
      await createNote({ bookId: book.id, chapterId: chapter.id, kind: 'thought', title, content })
    },
    [book, chapter, createNote],
  )

  const saveLabReport = useCallback(
    async (title: string, markdown: string, targetBookId: string, targetChapterId: string) => {
      const ownerId = targetBookId || book?.id || books[0]?.id
      if (!ownerId) throw new Error(t('还没有导入书。'))
      await window.api.createNote({
        bookId: ownerId,
        chapterId: targetChapterId || null,
        kind: 'summary',
        title,
        content: markdown,
      })
      if (book?.id === ownerId && (!targetChapterId || chapter?.id === targetChapterId)) {
        await refreshNotes(ownerId, chapter?.id ?? null)
      }
      notify({ kind: 'info', text: t('已存为笔记。') })
    },
    [book, books, chapter?.id, notify, refreshNotes],
  )

  const saveMarginNote = useCallback(
    async (markdown: string) => {
      if (!chapter || !marginQuote) throw new Error(t('先选中一段原文。'))
      await createNote({
        bookId: chapter.bookId,
        chapterId: chapter.id,
        kind: 'thought',
        title: `AI 边注 · ${marginQuote.slice(0, 16)}`,
        content: markdown,
        quote: marginQuote,
      })
      notify({ kind: 'info', text: t('边注已保存。') })
    },
    [chapter, createNote, marginQuote, notify],
  )

  const updateNote = useCallback(
    async (noteId: string, patch: NotePatch) => {
      // 只回填这一条笔记，避免每次保存都把整本书的笔记重新拉一遍并重建卡片。
      const updated = await window.api.updateNote(noteId, patch)
      patchNote(updated)
    },
    [patchNote],
  )

  const removeNote = useCallback(
    async (noteId: string) => {
      await window.api.deleteNote(noteId)
      if (book) await refreshNotes(book.id, chapter?.id ?? null)
      notify({
        kind: 'info',
        text: t('笔记已删除，可撤销。'),
        action: {
          label: t('撤销'),
          onClick: () => {
            void window.api
              .restoreNote(noteId)
              .then((restored) => {
                if (!restored) throw new Error(t('笔记所在的书或章节已经不存在，无法恢复。'))
                if (book) return refreshNotes(book.id, chapter?.id ?? null)
                return undefined
              })
              .then(() => notify({ kind: 'info', text: t('笔记已恢复。') }))
              .catch((err: unknown) => notify({ kind: 'error', text: messageOf(err) }))
          },
        },
      })
    },
    [book, chapter?.id, notify, refreshNotes],
  )

  const expandNote = useCallback(
    async (noteId: string) => {
      setExpandingNoteId(noteId)
      try {
        const updated = await window.api.expandNote(noteId)
        setNotes((current) => current.map((note) => (note.id === noteId ? updated : note)))
        setAllNotes((current) => current.map((note) => (note.id === noteId ? updated : note)))
        setChapter((current) =>
          current && current.noteReport
            ? {
                ...current,
                noteReport: {
                  ...current.noteReport,
                  divergences: current.noteReport.divergences + updated.divergences.length,
                },
              }
            : current,
        )
      } catch (err) {
        notify({ kind: 'error', text: messageOf(err) })
      } finally {
        setExpandingNoteId(null)
      }
    },
    [notify, setAllNotes, setChapter, setNotes],
  )

  return {
    expandingNoteId,
    setExpandingNoteId,
    createNote,
    saveTutorNote,
    saveLabReport,
    saveMarginNote,
    updateNote,
    removeNote,
    expandNote,
  }
}
