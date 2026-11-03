import { useCallback, useState, type MutableRefObject } from 'react'

import { DEFAULT_READER_STYLE, type BookSummary,
  ChapterContent,
  ChapterMeta,
  ReaderMark,
  ReaderStyle,
} from '../../shared/types.js'
import { messageOf } from '../lib/errors.js'
import { t } from '../lib/i18n.js'

import type { ToastState } from './useToast.js'

/**
 * 打开书/章节需要触达的其他领域动作。用 ref 传入，避免 useBookshelf 依赖
 * generation / format / notes 三个 hook 的初始化顺序，也避免回调变化导致重渲染。
 */
export interface BookshelfActions {
  appTheme: ReaderStyle['theme']
  refreshNotes(bookId: string, chapterId: string | null): Promise<void>
  resetNotes(): void
  resetChapterView(): void
  resetBookView(): void
  setStyle(style: ReaderStyle): void
  refreshBookmarks(bookId: string): void
  notify(toast: ToastState): void
}

export interface Bookshelf {
  books: BookSummary[]
  setBooks: React.Dispatch<React.SetStateAction<BookSummary[]>>
  book: BookSummary | null
  setBook: React.Dispatch<React.SetStateAction<BookSummary | null>>
  chapters: ChapterMeta[]
  setChapters: React.Dispatch<React.SetStateAction<ChapterMeta[]>>
  chapter: ChapterContent | null
  setChapter: React.Dispatch<React.SetStateAction<ChapterContent | null>>
  readerMarks: ReaderMark[]
  setReaderMarks: React.Dispatch<React.SetStateAction<ReaderMark[]>>
  loadingChapter: boolean
  setLoadingChapter: React.Dispatch<React.SetStateAction<boolean>>
  updateBook(bookId: string, patch: Partial<BookSummary>): void
  clearBook(): void
  openBook(bookId: string): Promise<void>
  /** 打开一本书并尽量定位到指定章节；返回实际打开的章节（没有可用章节时为 null）。 */
  openBookAt(bookId: string, chapterId?: string | null): Promise<ChapterMeta | null>
  openChapter(bookId: string, meta: ChapterMeta, chapterList: ChapterMeta[]): Promise<void>
  refreshBook(bookId: string): Promise<void>
  deleteBook(bookId: string): Promise<void>
}

/** 当前打开的书、目录、章节正文、阅读标记和书架列表。 */
export function useBookshelf(actions: MutableRefObject<BookshelfActions>): Bookshelf {
  const [books, setBooks] = useState<BookSummary[]>([])
  const [book, setBook] = useState<BookSummary | null>(null)
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [chapter, setChapter] = useState<ChapterContent | null>(null)
  const [readerMarks, setReaderMarks] = useState<ReaderMark[]>([])
  const [loadingChapter, setLoadingChapter] = useState(false)

  const updateBook = useCallback((bookId: string, patch: Partial<BookSummary>) => {
    setBook((current) => (current && current.id === bookId ? { ...current, ...patch } : current))
    setBooks((current) => current.map((item) => (item.id === bookId ? { ...item, ...patch } : item)))
  }, [])

  const clearBook = useCallback(() => {
    setBook(null)
    setChapters([])
    setChapter(null)
    setReaderMarks([])
  }, [])

  const openChapter = useCallback(
    async (bookId: string, meta: ChapterMeta, chapterList: ChapterMeta[]) => {
      const helpers = actions.current
      helpers.resetChapterView()
      setLoadingChapter(true)
      setReaderMarks([])
      try {
        const [content, marks] = await Promise.all([
          window.api.getChapter(meta.id),
          window.api.listChapterMarks(meta.id),
        ])
        setChapter(content)
        setReaderMarks(marks)
        await helpers.refreshNotes(bookId, meta.id)
        await window.api.setProgress(bookId, meta.id)
        const visible = chapterList.filter((item) => !item.hidden)
        const position = visible.findIndex((item) => item.id === meta.id)
        const progress = visible.length === 0 ? 0 : position >= 0 ? (position + 1) / visible.length : 0
        updateBook(bookId, { currentChapterId: meta.id, currentChapterIdx: meta.idx, progress })
      } catch (err) {
        helpers.notify({ kind: 'error', text: messageOf(err) })
      } finally {
        setLoadingChapter(false)
      }
    },
    [actions, updateBook],
  )

  const openBookAt = useCallback(
    async (bookId: string, chapterId?: string | null): Promise<ChapterMeta | null> => {
      try {
        const opened = await window.api.openBook(bookId)
        const helpers = actions.current
        setBook(opened.book)
        setChapters(opened.chapters)
        helpers.refreshBookmarks(opened.book.id)
        helpers.setStyle({ ...DEFAULT_READER_STYLE, ...opened.style, theme: helpers.appTheme })
        helpers.resetBookView()
        if (opened.chapters.length > 0 && opened.chapters.every((item) => item.classifiedBy === null)) {
          helpers.notify({
            kind: 'info',
            text: t('这本书还没有整理过目录。点左侧「整理」可以识别目录、版权页、广告等无关页面。'),
          })
        }
        const visible = opened.chapters.filter((item) => !item.hidden)
        const target =
          (chapterId ? visible.find((item) => item.id === chapterId) : undefined) ??
          visible.find((item) => item.id === opened.book.currentChapterId) ??
          visible.find((item) => item.kind === 'content') ??
          visible[0] ??
          null
        if (!target) {
          setChapter(null)
          helpers.resetNotes()
          helpers.notify({ kind: 'info', text: t('这本书的章节都被隐藏了，打开「整理」可以恢复。') })
          return null
        }
        await openChapter(opened.book.id, target, opened.chapters)
        return target
      } catch (err) {
        actions.current.notify({ kind: 'error', text: messageOf(err) })
        return null
      }
    },
    [actions, openChapter],
  )

  const openBook = useCallback(
    async (bookId: string) => {
      await openBookAt(bookId)
    },
    [openBookAt],
  )

  const refreshBook = useCallback(
    async (bookId: string) => {
      const helpers = actions.current
      const opened = await window.api.openBook(bookId)
      setBook(opened.book)
      setChapters(opened.chapters)
      helpers.refreshBookmarks(bookId)
      setBooks((current) => current.map((item) => (item.id === bookId ? opened.book : item)))
      const visible = opened.chapters.filter((item) => !item.hidden)
      const currentIdx = chapter?.idx ?? -1
      const target =
        visible.find((item) => item.id === chapter?.id) ??
        visible.find((item) => item.idx >= currentIdx && item.kind === 'content') ??
        visible.find((item) => item.idx >= currentIdx) ??
        [...visible].reverse().find((item) => item.kind === 'content') ??
        visible[visible.length - 1] ??
        null
      if (!target) {
        setChapter(null)
        helpers.resetNotes()
        return
      }
      if (target.id !== chapter?.id) await openChapter(bookId, target, opened.chapters)
      else await helpers.refreshNotes(bookId, target.id)
    },
    [actions, chapter?.id, openChapter],
  )

  const deleteBook = useCallback(
    async (bookId: string) => {
      const helpers = actions.current
      try {
        await window.api.deleteBook(bookId)
        setBooks((current) => current.filter((item) => item.id !== bookId))
        if (book?.id === bookId) {
          clearBook()
          helpers.resetNotes()
        }
      } catch (err) {
        helpers.notify({ kind: 'error', text: messageOf(err) })
      }
    },
    [actions, book?.id, clearBook],
  )

  return {
    books,
    setBooks,
    book,
    setBook,
    chapters,
    setChapters,
    chapter,
    setChapter,
    readerMarks,
    setReaderMarks,
    loadingChapter,
    setLoadingChapter,
    updateBook,
    clearBook,
    openBook,
    openBookAt,
    openChapter,
    refreshBook,
    deleteBook,
  }
}
