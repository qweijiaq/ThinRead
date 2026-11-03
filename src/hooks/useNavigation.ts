import { useCallback, useEffect } from 'react'

import type {
  BookSummary,
  ChapterContent,
  ChapterMeta,
  KnowledgeMapNode,
  LibraryNote,
  SearchResult,
} from '../../shared/types.js'
import { messageOf } from '../lib/errors.js'

import type { ToastState } from './useToast.js'
import type { MainView } from './useViews.js'

interface NavigationOptions {
  book: BookSummary | null
  chapter: ChapterContent | null
  chapters: ChapterMeta[]
  openBook(bookId: string): Promise<void>
  openBookAt(bookId: string, chapterId?: string | null): Promise<ChapterMeta | null>
  openChapter(bookId: string, meta: ChapterMeta, chapterList: ChapterMeta[]): Promise<void>
  setPendingNoteId: React.Dispatch<React.SetStateAction<string | null>>
  setFocusNote: React.Dispatch<React.SetStateAction<{ id: string; key: number } | null>>
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  setMainView: React.Dispatch<React.SetStateAction<MainView>>
  setContentFocusId: React.Dispatch<React.SetStateAction<string | null>>
  setScrollTarget: React.Dispatch<React.SetStateAction<{ quote: string; key: number } | null>>
  notify(toast: ToastState): void
}

export interface NavigationActions {
  openRelatedNote(related: import('../../shared/types.js').RelatedNote): Promise<void>
  openSearchResult(result: SearchResult): Promise<void>
  openLibraryNote(note: LibraryNote): Promise<void>
  openMapNote(node: KnowledgeMapNode): Promise<void>
  openMapBook(bookId: string): Promise<void>
}

/** 从搜索、笔记库、知识地图、页边回声和深链跳到具体书/章节/笔记。 */
export function useNavigation(options: NavigationOptions): NavigationActions {
  const {
    book,
    chapter,
    chapters,
    openBook,
    openBookAt,
    openChapter,
    setPendingNoteId,
    setFocusNote,
    setSearchOpen,
    setMainView,
    setContentFocusId,
    setScrollTarget,
    notify,
  } = options

  const openRelatedNote = useCallback(
    async (related: import('../../shared/types.js').RelatedNote) => {
      if (!book) return
      if (related.bookId === book.id) {
        if (related.chapterId && related.chapterId !== chapter?.id) {
          const meta = chapters.find((item) => item.id === related.chapterId)
          if (meta) {
            await openChapter(book.id, meta, chapters)
            setPendingNoteId(related.id)
            return
          }
        }
        setFocusNote({ id: related.id, key: Date.now() })
        return
      }
      const target = await openBookAt(related.bookId, related.chapterId)
      if (target) setPendingNoteId(related.id)
    },
    [book, chapter?.id, chapters, openBookAt, openChapter, setFocusNote, setPendingNoteId],
  )

  const openSearchResult = useCallback(
    async (result: SearchResult) => {
      setSearchOpen(false)
      if (result.type === 'content') {
        setContentFocusId(result.id)
        setMainView('content')
        return
      }
      setMainView('reader')
      if (result.type === 'book') {
        await openBook(result.bookId)
        return
      }
      if (book?.id === result.bookId) {
        const meta = chapters.find((item) => item.id === result.chapterId)
        if (meta) await openChapter(book.id, meta, chapters)
        if (result.type === 'note') setPendingNoteId(result.id)
        return
      }
      const target = await openBookAt(result.bookId, result.chapterId)
      if (result.type === 'note' && target) setPendingNoteId(result.id)
    },
    [
      book,
      chapters,
      openBook,
      openBookAt,
      openChapter,
      setContentFocusId,
      setMainView,
      setPendingNoteId,
      setSearchOpen,
    ],
  )

  const openLibraryNote = useCallback(
    async (note: LibraryNote) => {
      await openSearchResult({
        type: 'note',
        id: note.id,
        bookId: note.bookId,
        bookTitle: note.bookTitle,
        chapterId: note.chapterId,
        chapterTitle: note.chapterTitle,
        title: note.title,
        snippet: '',
        updatedAt: note.updatedAt,
      })
    },
    [openSearchResult],
  )

  const openMapNote = useCallback(
    async (node: KnowledgeMapNode) => {
      if (!node.noteId) return
      setMainView('reader')
      await openSearchResult({
        type: 'note',
        id: node.noteId,
        bookId: node.bookId,
        bookTitle: node.bookTitle,
        chapterId: node.chapterId,
        chapterTitle: node.chapterTitle,
        title: node.label,
        snippet: '',
        updatedAt: '',
      })
    },
    [openSearchResult, setMainView],
  )

  const openMapBook = useCallback(
    async (bookId: string) => {
      setMainView('reader')
      await openBook(bookId)
    },
    [openBook, setMainView],
  )

  useEffect(() => {
    const unsubscribe = window.api.onDeepLink((target) => {
      void (async () => {
        try {
          setMainView('reader')
          if (target.chapterId) {
            await openSearchResult({
              type: 'chapter',
              id: target.chapterId,
              bookId: target.bookId,
              bookTitle: '',
              chapterId: target.chapterId,
              chapterTitle: null,
              title: '',
              snippet: '',
              updatedAt: null,
            })
          } else {
            await openBook(target.bookId)
          }
          if (target.quote) setScrollTarget({ quote: target.quote, key: Date.now() })
        } catch (err) {
          notify({ kind: 'error', text: messageOf(err) })
        }
      })()
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [notify, openBook, openSearchResult, setMainView, setScrollTarget])

  return { openRelatedNote, openSearchResult, openLibraryNote, openMapNote, openMapBook }
}
