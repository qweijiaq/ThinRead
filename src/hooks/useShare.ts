import { useCallback, useState } from 'react'

import type { BookSummary, ChapterContent, ChapterMeta, LibraryNote, Note } from '../../shared/types.js'
import { messageOf } from '../lib/errors.js'
import { noteDisplayTitle, titleRepeatsContent } from '../lib/note-display.js'
import type { ShareBook, ShareNote, ShareTemplate } from '../lib/share-card.js'
import type { XhsScope } from '../lib/xhs-carousel.js'

import type { ToastState } from './useToast.js'

export interface ShareTarget {
  note?: ShareNote
  book?: ShareBook
  notes?: ShareNote[]
  initialTemplate?: ShareTemplate
}

export interface XhsTarget {
  scope: XhsScope
  chapterId?: string | null
}

interface ShareOptions {
  book: BookSummary | null
  chapter: ChapterContent | null
  chapters: ChapterMeta[]
  chapterTitles: Record<string, string>
  notify(toast: ToastState): void
}

export interface ShareState {
  shareTarget: ShareTarget | null
  setShareTarget: React.Dispatch<React.SetStateAction<ShareTarget | null>>
  xhsTarget: XhsTarget | null
  setXhsTarget: React.Dispatch<React.SetStateAction<XhsTarget | null>>
  shareNote(note: Note): void
  shareLibraryNote(note: LibraryNote): void
  shareDeck(notes: LibraryNote[]): void
  shareQuote(text: string): void
  shareCurrentBook(): Promise<void>
  openChapterXhs(): void
  openBookXhs(): void
}

function libraryNoteToShareNote(note: LibraryNote): ShareNote {
  return {
    id: note.id,
    title: noteDisplayTitle(note),
    content: note.content,
    quote: note.quote,
    tags: note.tags,
    bookTitle: note.bookTitle,
    chapterTitle: note.chapterTitle,
    kind: note.kind,
  }
}

/** 分享卡和小红书图文的入口：构造分享目标，不直接渲染图片。 */
export function useShare(options: ShareOptions): ShareState {
  const { book, chapter, chapters, chapterTitles, notify } = options
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null)
  const [xhsTarget, setXhsTarget] = useState<XhsTarget | null>(null)

  const shareNote = useCallback(
    (note: Note) => {
      if (!book) return
      setShareTarget({
        note: {
          id: note.id,
          title: noteDisplayTitle(note),
          content: note.content,
          quote: note.quote,
          tags: note.tags,
          bookTitle: book.title,
          chapterTitle: note.chapterId ? (chapterTitles[note.chapterId] ?? null) : null,
          kind: note.kind,
        },
      })
    },
    [book, chapterTitles],
  )

  const shareLibraryNote = useCallback((note: LibraryNote) => {
    setShareTarget({ note: libraryNoteToShareNote(note) })
  }, [])

  const shareDeck = useCallback((notes: LibraryNote[]) => {
    setShareTarget({
      notes: notes.map(libraryNoteToShareNote),
      initialTemplate: 'deck',
    })
  }, [])

  const shareQuote = useCallback(
    (text: string) => {
      if (!book || !chapter) return
      setShareTarget({
        note: {
          id: `quote:${Date.now()}`,
          title: '原文摘录',
          content: text,
          quote: text,
          tags: [],
          bookTitle: book.title,
          chapterTitle: chapter.title,
          kind: 'highlight',
        },
      })
    },
    [book, chapter],
  )

  const shareCurrentBook = useCallback(async () => {
    if (!book) return
    try {
      const all = await window.api.listNotes(book.id)
      const points = all.filter((note) => note.kind === 'point' || note.kind === 'claim')
      const fallback = all.filter(
        (note) => note.kind === 'summary' || note.kind === 'condensed' || note.kind === 'thought',
      )
      const cards = (points.length > 0 ? points : fallback).slice(0, 4).map((note) => {
        const title = noteDisplayTitle(note).slice(0, 60)
        const detail = titleRepeatsContent(note) ? (note.role ?? note.quote ?? '') : note.content
        return {
          title,
          content: detail.replace(/\s+/g, ' ').trim().slice(0, 120),
        }
      })
      setShareTarget({
        book: {
          title: book.title,
          author: book.author,
          chapterCount: chapters.filter((item) => !item.hidden).length,
          noteCount: all.length,
          cards,
        },
        initialTemplate: 'book',
      })
    } catch (err) {
      notify({ kind: 'error', text: messageOf(err) })
    }
  }, [book, chapters, notify])

  const openChapterXhs = useCallback(() => {
    if (!book || !chapter) return
    setXhsTarget({ scope: 'chapter', chapterId: chapter.id })
  }, [book, chapter])

  const openBookXhs = useCallback(() => {
    if (!book) return
    setXhsTarget({ scope: 'book' })
  }, [book])

  return {
    shareTarget,
    setShareTarget,
    xhsTarget,
    setXhsTarget,
    shareNote,
    shareLibraryNote,
    shareDeck,
    shareQuote,
    shareCurrentBook,
    openChapterXhs,
    openBookXhs,
  }
}
