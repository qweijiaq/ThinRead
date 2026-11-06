import { useCallback, useEffect, useState } from 'react'

import type { BookSummary, ChapterContent, ChapterMeta, Note, ReaderMarkStyle } from '../../shared/types.js'
import type { BookmarkDraft, BookmarkView } from '../lib/bookmarks.js'
import { messageOf } from '../lib/errors.js'
import { t } from '../lib/i18n.js'

import type { ToastState } from './useToast.js'

type SideTab = 'notes' | 'chat' | 'feynman' | 'format'

interface ReaderSessionOptions {
  book: BookSummary | null
  chapter: ChapterContent | null
  chapters: ChapterMeta[]
  notes: Note[]
  setReaderMarks: React.Dispatch<React.SetStateAction<import('../../shared/types.js').ReaderMark[]>>
  openChapter(bookId: string, meta: ChapterMeta, chapterList: ChapterMeta[]): Promise<void>
  notify(toast: ToastState): void
}

export interface ReaderSessionState {
  bookmarks: BookmarkView[]
  setBookmarks: React.Dispatch<React.SetStateAction<BookmarkView[]>>
  positionTarget: { chapterId: string; ratio: number; key: number } | null
  setPositionTarget: React.Dispatch<React.SetStateAction<{ chapterId: string; ratio: number; key: number } | null>>
  listen: { title: string; text: string; scope?: string } | null
  setListen: React.Dispatch<React.SetStateAction<{ title: string; text: string; scope?: string } | null>>
  marginQuote: string | null
  setMarginQuote: React.Dispatch<React.SetStateAction<string | null>>
  focusNote: { id: string; key: number } | null
  setFocusNote: React.Dispatch<React.SetStateAction<{ id: string; key: number } | null>>
  pendingNoteId: string | null
  setPendingNoteId: React.Dispatch<React.SetStateAction<string | null>>
  scrollTarget: { quote: string; key: number } | null
  setScrollTarget: React.Dispatch<React.SetStateAction<{ quote: string; key: number } | null>>
  sideTab: SideTab
  setSideTab: React.Dispatch<React.SetStateAction<SideTab>>
  chatSeed: { text: string; key: number } | null
  setChatSeed: React.Dispatch<React.SetStateAction<{ text: string; key: number } | null>>
  refreshBookmarks(bookId: string): Promise<void>
  createReaderMark(style: ReaderMarkStyle, text: string): Promise<void>
  clearReaderMarks(ids: string[]): Promise<void>
  deleteReaderMark(id: string): void
  askAboutSelection(text: string): void
  listenSelection(text: string): void
  listenChapter(text: string): void
  jumpToQuote(quote: string): void
  openNote(note: Note): Promise<void>
  createReaderBookmark(draft: BookmarkDraft): Promise<void>
  deleteReaderBookmark(id: string): Promise<void>
  openBookmark(bookmark: BookmarkView): Promise<void>
}

/** 阅读现场：书签、划线、选中间 AI、朗读、原文定位和笔记聚焦。 */
export function useReaderSession(options: ReaderSessionOptions): ReaderSessionState {
  const { book, chapter, chapters, notes, setReaderMarks, openChapter, notify } = options
  const [bookmarks, setBookmarks] = useState<BookmarkView[]>([])
  const [positionTarget, setPositionTarget] = useState<{ chapterId: string; ratio: number; key: number } | null>(null)
  const [listen, setListen] = useState<{ title: string; text: string; scope?: string } | null>(null)
  const [marginQuote, setMarginQuote] = useState<string | null>(null)
  const [focusNote, setFocusNote] = useState<{ id: string; key: number } | null>(null)
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null)
  const [scrollTarget, setScrollTarget] = useState<{ quote: string; key: number } | null>(null)
  const [sideTab, setSideTab] = useState<SideTab>('notes')
  const [chatSeed, setChatSeed] = useState<{ text: string; key: number } | null>(null)

  useEffect(() => {
    if (!pendingNoteId) return
    if (!notes.some((note) => note.id === pendingNoteId)) return
    setFocusNote({ id: pendingNoteId, key: Date.now() })
    setPendingNoteId(null)
  }, [notes, pendingNoteId])

  const refreshBookmarks = useCallback(async (bookId: string) => {
    try {
      setBookmarks(await window.api.listBookmarks(bookId))
    } catch {
      setBookmarks([])
    }
  }, [])

  const createReaderMark = useCallback(
    async (style: ReaderMarkStyle, text: string) => {
      if (!chapter) return
      try {
        const mark = await window.api.createChapterMark({ chapterId: chapter.id, quote: text, style })
        setReaderMarks((current) => [...current, mark])
      } catch (err) {
        notify({ kind: 'error', text: messageOf(err) })
      }
    },
    [chapter, notify, setReaderMarks],
  )

  const clearReaderMarks = useCallback(
    async (ids: string[]) => {
      try {
        await Promise.all(ids.map((id) => window.api.deleteChapterMark(id)))
        setReaderMarks((current) => current.filter((mark) => !ids.includes(mark.id)))
      } catch (err) {
        notify({ kind: 'error', text: messageOf(err) })
      }
    },
    [notify, setReaderMarks],
  )

  const deleteReaderMark = useCallback(
    (id: string) => {
      void clearReaderMarks([id])
    },
    [clearReaderMarks],
  )

  const askAboutSelection = useCallback((text: string) => {
    setChatSeed({ text, key: Date.now() })
    setSideTab('chat')
  }, [])

  const listenSelection = useCallback((text: string) => {
    setListen({
      title: `${t('朗读')} · ${t('选中文本')}`,
      text,
    })
  }, [])

  const listenChapter = useCallback(
    (text: string) =>
      setListen({
        title: `${t('朗读')} · ${chapter?.title ?? ''}`,
        text,
      }),
    [chapter?.title],
  )

  const jumpToQuote = useCallback((quote: string) => {
    setScrollTarget({ quote, key: Date.now() })
  }, [])

  const openNote = useCallback(
    async (note: Note) => {
      if (!book) return
      if (note.chapterId && note.chapterId !== chapter?.id) {
        const meta = chapters.find((item) => item.id === note.chapterId)
        if (!meta) return
        await openChapter(book.id, meta, chapters)
        setPendingNoteId(note.id)
        return
      }
      setFocusNote({ id: note.id, key: Date.now() })
    },
    [book, chapter?.id, chapters, openChapter],
  )

  const createReaderBookmark = useCallback(
    async (draft: BookmarkDraft) => {
      try {
        await window.api.createBookmark(draft)
        if (book) await refreshBookmarks(book.id)
        notify({ kind: 'info', text: t('已添加书签。') })
      } catch (err) {
        notify({ kind: 'error', text: messageOf(err) })
      }
    },
    [book, notify, refreshBookmarks],
  )

  const deleteReaderBookmark = useCallback(
    async (id: string) => {
      try {
        await window.api.deleteBookmark(id)
        if (book) await refreshBookmarks(book.id)
      } catch (err) {
        notify({ kind: 'error', text: messageOf(err) })
      }
    },
    [book, notify, refreshBookmarks],
  )

  const openBookmark = useCallback(
    async (bookmark: BookmarkView) => {
      if (!book) return
      const meta = chapters.find((item) => item.id === bookmark.chapterId)
      if (!meta) {
        notify({ kind: 'error', text: t('这个书签对应的章节已经不存在。') })
        return
      }
      await openChapter(book.id, meta, chapters)
      setPositionTarget({ chapterId: bookmark.chapterId, ratio: bookmark.scrollRatio, key: Date.now() })
    },
    [book, chapters, notify, openChapter],
  )

  return {
    bookmarks,
    setBookmarks,
    positionTarget,
    setPositionTarget,
    listen,
    setListen,
    marginQuote,
    setMarginQuote,
    focusNote,
    setFocusNote,
    pendingNoteId,
    setPendingNoteId,
    scrollTarget,
    setScrollTarget,
    sideTab,
    setSideTab,
    chatSeed,
    setChatSeed,
    refreshBookmarks,
    createReaderMark,
    clearReaderMarks,
    deleteReaderMark,
    askAboutSelection,
    listenSelection,
    listenChapter,
    jumpToQuote,
    openNote,
    createReaderBookmark,
    deleteReaderBookmark,
    openBookmark,
  }
}
