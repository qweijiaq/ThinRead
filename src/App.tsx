import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'

import { DEFAULT_READER_STYLE } from '../shared/types.js'
import type {
  AppInfo,
  BookSummary,
  ChapterContent,
  ChapterFlag,
  ChapterMeta,
  ChapterSuggestion,
  ClassifyResult,
  GeneratePartial,
  HighlightImportResult,
  LibraryNote,
  KnowledgeMapNode,
  LabToolId,
  Note,
  NoteDraft,
  NotePatch,
  ReaderStyle,
  RelatedNote,
  SearchResult,
  SettingsView,
} from '../shared/types.js'
import { BookCompose } from './components/BookCompose.js'
import { ConfirmHost, confirmDialog } from './components/ConfirmDialog.js'
import { ChapterList } from './components/ChapterList.js'
import { ContentView } from './components/ContentView.js'
import { ChatPanel } from './components/ChatPanel.js'
import { FeynmanPanel } from './components/FeynmanPanel.js'
import { FormatPanel } from './components/FormatPanel.js'
import { ImportDialog } from './components/ImportDialog.js'
import { MergeBooksDialog } from './components/MergeBooksDialog.js'
import type { FormatMessage } from './components/FormatPanel.js'
import { KnowledgeMap } from './components/KnowledgeMap.js'
import { LabView } from './components/LabView.js'
import { Library } from './components/Library.js'
import { ListenPanel } from './components/ListenPanel.js'
import { MarginNoteDialog } from './components/MarginNoteDialog.js'
import { NotesPanel } from './components/NotesPanel.js'
import { NotesLibrary } from './components/NotesLibrary.js'
import { OrganizeDialog } from './components/OrganizeDialog.js'
import { Reader } from './components/Reader.js'
import { RenameDialog } from './components/RenameDialog.js'
import { SearchDialog } from './components/SearchDialog.js'
import { ShareDialog } from './components/ShareDialog.js'
import { SettingsDialog } from './components/SettingsDialog.js'
import { SplitBookDialog } from './components/SplitBookDialog.js'
import { TaskCenter } from './components/TaskCenter.js'
import type { BackgroundTask } from './components/TaskCenter.js'
import { TopBar } from './components/TopBar.js'
import { noteDisplayTitle, titleRepeatsContent } from './lib/note-display.js'
import type { ShareBook, ShareNote, ShareTemplate } from './lib/share-card.js'

function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

const THEME_KEY = 'reading-notes-theme'

type RenameTarget =
  | { kind: 'book'; bookId: string; value: string }
  | { kind: 'chapter'; chapterId: string; value: string }
  | { kind: 'part'; bookId: string; partIndex: number; value: string }

function loadStoredTheme(): ReaderStyle['theme'] {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'paper' || stored === 'plain' || stored === 'warm' || stored === 'folio') {
      return stored
    }
  } catch {
    // localStorage 不可用时使用默认主题。
  }
  return DEFAULT_READER_STYLE.theme
}


export function App(): JSX.Element {
  const [books, setBooks] = useState<BookSummary[]>([])
  const [book, setBook] = useState<BookSummary | null>(null)
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [chapter, setChapter] = useState<ChapterContent | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [allNotes, setAllNotes] = useState<Note[]>([])
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([])
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [loadingChapter, setLoadingChapter] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [partial, setPartial] = useState<GeneratePartial | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [mainView, setMainView] = useState<'reader' | 'notes' | 'map' | 'lab' | 'compose' | 'content'>('reader')
  const [labMounted, setLabMounted] = useState(false)
  const [labFocus, setLabFocus] = useState<{ tool: LabToolId; bookId?: string; key: number } | null>(null)
  const [contentFocusId, setContentFocusId] = useState<string | null>(null)
  const [shareTarget, setShareTarget] = useState<{
    note?: ShareNote
    book?: ShareBook
    notes?: ShareNote[]
    initialTemplate?: ShareTemplate
  } | null>(null)
  const [listen, setListen] = useState<{ title: string; text: string } | null>(null)
  const [marginQuote, setMarginQuote] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [focusNote, setFocusNote] = useState<{ id: string; key: number } | null>(null)
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null)
  const [scrollTarget, setScrollTarget] = useState<{ quote: string; key: number } | null>(null)
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<ChapterSuggestion[]>([])
  const [classifyMode, setClassifyMode] = useState<ClassifyResult['mode'] | null>(null)
  const [classifyError, setClassifyError] = useState<string | null>(null)
  const [classifying, setClassifying] = useState(false)
  const [sideTab, setSideTab] = useState<'notes' | 'chat' | 'feynman' | 'format'>('notes')
  const [appTheme, setAppTheme] = useState<ReaderStyle['theme']>(loadStoredTheme)
  const [readerStyle, setReaderStyle] = useState<ReaderStyle>(DEFAULT_READER_STYLE)
  const [formatBusy, setFormatBusy] = useState(false)
  const [formatError, setFormatError] = useState<string | null>(null)
  const [formatNote, setFormatNote] = useState<string | null>(null)
  const [formatMessages, setFormatMessages] = useState<FormatMessage[]>([])
  const [expandingNoteId, setExpandingNoteId] = useState<string | null>(null)
  const [crossBookNotes, setCrossBookNotes] = useState<RelatedNote[]>([])
  const [semanticTick, setSemanticTick] = useState(0)
  const styleSaveTimer = useRef<number | null>(null)
  const formatTokenRef = useRef(0)

  useEffect(() => {
    document.documentElement.className = `theme-${appTheme}`
    try {
      localStorage.setItem(THEME_KEY, appTheme)
    } catch {
      // 忽略存储失败；当前会话仍然使用这个主题。
    }
  }, [appTheme])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => window.api.onSemanticReady(() => setSemanticTick((value) => value + 1)), [])

  useEffect(() => {
    void Promise.all([window.api.listBooks(), window.api.getSettings(), window.api.getAppInfo()])
      .then(([nextBooks, nextSettings, info]) => {
        setBooks(nextBooks)
        setSettings(nextSettings)
        setAppInfo(info)
      })
      .catch((err: unknown) => setToast({ kind: 'error', text: messageOf(err) }))
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    function upsert(task: BackgroundTask): void {
      setBackgroundTasks((current) => {
        const exists = current.some((item) => item.id === task.id)
        return exists ? current.map((item) => (item.id === task.id ? task : item)) : [task, ...current].slice(0, 6)
      })
    }
    function patch(id: string, update: Partial<BackgroundTask>): void {
      setBackgroundTasks((current) => current.map((task) => (task.id === id ? { ...task, ...update } : task)))
    }
    const offNotesProgress = window.api.onBookGenerationProgress((event) => {
      const id = `notes:${event.bookId}`
      upsert({
        id,
        kind: 'notes',
        title: '整本生成',
        detail: event.title ? `${event.title}${event.message ? ` · ${event.message}` : ''}` : '正在准备',
        done: event.done,
        total: event.total,
        status: 'running',
      })
    })
    const offNotesDone = window.api.onBookGenerationDone((event) => {
      patch(`notes:${event.bookId}`, {
        status: event.cancelled ? 'cancelled' : event.failed.length > 0 ? 'error' : 'done',
        done: event.generated + event.skipped + event.failed.length,
        detail: event.cancelled
          ? '已取消'
          : `新生成 ${event.generated} 节${event.skipped > 0 ? ` · 跳过 ${event.skipped} 节` : ''}${event.failed.length > 0 ? ` · 失败 ${event.failed.length} 节` : ''}`,
      })
    })
    const offFormatProgress = window.api.onBookFormatProgress((event) => {
      upsert({
        id: `format:${event.bookId}`,
        kind: 'format',
        title: '整本 AI 排版',
        detail: event.title ? `${event.title}${event.message ? ` · ${event.message}` : ''}` : '正在准备',
        done: event.done,
        total: event.total,
        status: 'running',
      })
    })
    const offFormatDone = window.api.onBookFormatDone((event) => {
      patch(`format:${event.bookId}`, {
        status: event.cancelled ? 'cancelled' : event.failed.length > 0 ? 'error' : 'done',
        done: event.formatted + event.skipped + event.failed.length,
        detail: event.cancelled
          ? '已取消'
          : `完成 ${event.formatted} 节${event.skipped > 0 ? ` · 跳过 ${event.skipped} 节` : ''}${event.failed.length > 0 ? ` · 失败 ${event.failed.length} 节` : ''}`,
      })
    })
    return () => {
      offNotesProgress()
      offNotesDone()
      offFormatProgress()
      offFormatDone()
    }
  }, [])

  const refreshNotes = useCallback(async (bookId: string, chapterId: string | null) => {
    const [chapterNotes, all] = await Promise.all([
      chapterId ? window.api.listNotes(bookId, chapterId) : Promise.resolve([]),
      window.api.listNotes(bookId),
    ])
    setNotes(chapterNotes)
    setAllNotes(all)
  }, [])

  const openChapter = useCallback(
    async (bookId: string, meta: ChapterMeta, chapterList: ChapterMeta[]) => {
      void window.api.cancelGeneration()
      formatTokenRef.current += 1
      setLoadingChapter(true)
      setError(null)
      setGenerating(false)
      setPartial(null)
      setFormatBusy(false)
      setFormatError(null)
      setFormatNote(null)
      setFormatMessages([])
      setExpandingNoteId(null)
      try {
        const content = await window.api.getChapter(meta.id)
        setChapter(content)
        await refreshNotes(bookId, meta.id)
        await window.api.setProgress(bookId, meta.id)
        const visibleChapters = chapterList.filter((item) => !item.hidden)
        const position = visibleChapters.findIndex((item) => item.id === meta.id)
        const progress = visibleChapters.length === 0 ? 0 : position >= 0 ? (position + 1) / visibleChapters.length : 0
        setBook((current) =>
          current && current.id === bookId
            ? { ...current, currentChapterId: meta.id, currentChapterIdx: meta.idx, progress }
            : current,
        )
        setBooks((current) =>
          current.map((item) =>
            item.id === bookId ? { ...item, currentChapterId: meta.id, currentChapterIdx: meta.idx, progress } : item,
          ),
        )
      } catch (err) {
        setToast({ kind: 'error', text: messageOf(err) })
      } finally {
        setLoadingChapter(false)
      }
    },
    [refreshNotes],
  )

  const openBook = useCallback(
    async (bookId: string) => {
      try {
        const opened = await window.api.openBook(bookId)
        setBook(opened.book)
        setChapters(opened.chapters)
        setReaderStyle({ ...opened.style, theme: appTheme })
        setSuggestions([])
        setClassifyMode(null)
        setClassifyError(null)
        setOrganizeOpen(false)
        if (opened.chapters.length > 0 && opened.chapters.every((item) => item.classifiedBy === null)) {
          setToast({
            kind: 'info',
            text: '这本书还没有整理过目录。点左侧「整理」可以识别目录、版权页、广告等无关页面。',
          })
        }
        const visible = opened.chapters.filter((item) => !item.hidden)
        const target =
          visible.find((item) => item.id === opened.book.currentChapterId) ??
          visible.find((item) => item.kind === 'content') ??
          visible[0] ??
          null
        if (target) await openChapter(opened.book.id, target, opened.chapters)
        else {
          setChapter(null)
          setNotes([])
          setAllNotes([])
          setToast({ kind: 'info', text: '这本书的章节都被隐藏了，打开「整理」可以恢复。' })
        }
      } catch (err) {
        setToast({ kind: 'error', text: messageOf(err) })
      }
    },
    [openChapter, appTheme],
  )

  const refreshBook = useCallback(
    async (bookId: string) => {
      const opened = await window.api.openBook(bookId)
      setBook(opened.book)
      setChapters(opened.chapters)
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
        setNotes([])
        setAllNotes([])
        return
      }
      if (target.id !== chapter?.id) await openChapter(bookId, target, opened.chapters)
      else await refreshNotes(bookId, target.id)
    },
    [chapter?.id, openChapter, refreshNotes],
  )

  const reparseBook = useCallback(async () => {
    if (!book) return
    const confirmed = await confirmDialog({
      title: '重新解析目录',
      message:
        '重新解析会用新的章节切分替换目录。已有笔记会先按原文引用、再按章节标题重新归属；匹配不上的笔记会保留，但不再显示在章节里。继续？',
      confirmLabel: '继续解析',
      danger: true,
    })
    if (!confirmed) return
    try {
      const updated = await window.api.reparseBook(book.id)
      setBooks((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      await openBook(updated.id)
      setToast({ kind: 'info', text: '已重新解析目录，笔记已尽量保留。' })
    } catch (err) {
      setToast({ kind: 'error', text: messageOf(err) })
    }
  }, [book, openBook])

  const importFile = useCallback(async (): Promise<BookSummary | null> => {
    setImporting(true)
    try {
      return await window.api.importBook()
    } finally {
      setImporting(false)
    }
  }, [])

  const handleImported = useCallback(
    async (imported: BookSummary) => {
      setBooks((current) => [imported, ...current.filter((item) => item.id !== imported.id)])
      const hiddenNote =
        imported.hiddenChapterCount > 0 ? `，自动隐藏了 ${imported.hiddenChapterCount} 个疑似目录/版权页` : ''
      setToast({
        kind: 'info',
        text: `已导入《${imported.title}》，共 ${imported.chapterCount} 节${hiddenNote}`,
      })
      setImportOpen(false)
      await openBook(imported.id)
    },
    [openBook],
  )

  const handleHighlightsImported = useCallback(
    async (result: HighlightImportResult) => {
      setBooks(await window.api.listBooks())
      setToast({
        kind: 'info',
        text: `已导入 ${result.books.length} 本书的 ${result.highlights} 条划线。`,
      })
      setImportOpen(false)
      if (result.books.length === 1 && result.books[0]) await openBook(result.books[0].id)
    },
    [openBook],
  )

  const handleMerged = useCallback(
    async (merged: BookSummary) => {
      try {
        setBooks(await window.api.listBooks())
        setMergeOpen(false)
        setToast({ kind: 'info', text: `已合并为《${merged.title}》。` })
        await openBook(merged.id)
      } catch (err) {
        setToast({ kind: 'error', text: messageOf(err) })
      }
    },
    [openBook],
  )

  const handleSplit = useCallback(
    async (newBook: BookSummary) => {
      try {
        setBooks(await window.api.listBooks())
        setSplitOpen(false)
        setToast({ kind: 'info', text: `已拆出《${newBook.title}》。` })
        if (book) await refreshBook(book.id)
      } catch (err) {
        setToast({ kind: 'error', text: messageOf(err) })
      }
    },
    [book, refreshBook],
  )

  const deleteBook = useCallback(
    async (bookId: string) => {
      try {
        await window.api.deleteBook(bookId)
        setBooks((current) => current.filter((item) => item.id !== bookId))
        if (book?.id === bookId) {
          setBook(null)
          setChapters([])
          setChapter(null)
          setNotes([])
          setAllNotes([])
        }
      } catch (err) {
        setToast({ kind: 'error', text: messageOf(err) })
      }
    },
    [book?.id],
  )

  useEffect(() => {
    const offPartial = window.api.onGenerationPartial((event) => {
      if (event.chapterId !== chapter?.id) return
      setGenerating(true)
      setPartial(event.partial)
      setError(null)
    })
    const offDone = window.api.onGenerationDone((event) => {
      if (event.chapterId === chapter?.id) {
        setGenerating(false)
        setPartial(null)
        setNotes(event.notes)
        setChapter((current) =>
          current && current.id === event.chapterId ? { ...current, noteReport: event.report } : current,
        )
      }
      if (book) {
        void window.api
          .listNotes(book.id)
          .then((items) => {
            setAllNotes(items)
            setBooks((current) =>
              current.map((item) => (item.id === book.id ? { ...item, noteCount: items.length } : item)),
            )
          })
          .catch(() => undefined)
      }
    })
    const offError = window.api.onGenerationError((event) => {
      if (event.chapterId !== chapter?.id) return
      setGenerating(false)
      setPartial(null)
      setError(event.message)
    })
    const offFormatted = window.api.onChapterFormatted((event) => {
      if (event.chapterId !== chapter?.id) return
      setChapter((current) =>
        current && current.id === event.chapterId
          ? { ...current, formattedHtml: event.html, removed: event.removed }
          : current,
      )
      setReaderStyle((current) => ({ ...current, ...event.style }))
    })
    const offBookDone = window.api.onBookGenerationDone((event) => {
      if (event.bookId !== book?.id) return
      setToast({
        kind: event.failed.length > 0 ? 'error' : 'info',
        text: event.cancelled
          ? '整本生成已取消。'
          : `整本生成完成：新生成 ${event.generated} 节${event.failed.length > 0 ? `，失败 ${event.failed.length} 节` : ''}。`,
      })
      void window.api
        .listNotes(event.bookId)
        .then((items) => {
          setAllNotes(items)
          setBooks((current) =>
            current.map((item) => (item.id === event.bookId ? { ...item, noteCount: items.length } : item)),
          )
        })
        .catch(() => undefined)
    })
    return () => {
      offPartial()
      offDone()
      offError()
      offBookDone()
      offFormatted()
    }
  }, [chapter?.id, book?.id])

  useEffect(() => {
    if (!pendingNoteId) return
    if (!notes.some((note) => note.id === pendingNoteId)) return
    setFocusNote({ id: pendingNoteId, key: Date.now() })
    setPendingNoteId(null)
  }, [notes, pendingNoteId])

  const generate = useCallback(async () => {
    if (!chapter) return
    setError(null)
    setGenerating(true)
    setPartial(null)
    try {
      await window.api.generateNotes(chapter.id)
    } catch (err) {
      setGenerating(false)
      setPartial(null)
      setError(messageOf(err))
    }
  }, [chapter])

  const cancelGeneration = useCallback(async () => {
    await window.api.cancelGeneration()
    setGenerating(false)
    setPartial(null)
  }, [])

  const createNote = useCallback(
    async (draft: NoteDraft): Promise<Note> => {
      const created = await window.api.createNote(draft)
      if (book) await refreshNotes(book.id, chapter?.id ?? null)
      setFocusNote({ id: created.id, key: Date.now() })
      return created
    },
    [book, chapter?.id, refreshNotes],
  )

  const saveTutorNote = useCallback(
    async (title: string, content: string): Promise<void> => {
      if (!book || !chapter) throw new Error('先打开一章。')
      await createNote({
        bookId: book.id,
        chapterId: chapter.id,
        kind: 'thought',
        title,
        content,
      })
    },
    [book, chapter, createNote],
  )

  const saveLabReport = useCallback(
    async (title: string, markdown: string, targetBookId: string, targetChapterId: string): Promise<void> => {
      const ownerId = targetBookId || book?.id || books[0]?.id
      if (!ownerId) throw new Error('还没有导入书。')
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
      setToast({ kind: 'info', text: '已存为笔记。' })
    },
    [book, books, chapter?.id, refreshNotes],
  )

  const saveMarginNote = useCallback(
    async (markdown: string): Promise<void> => {
      if (!chapter || !marginQuote) throw new Error('先选中一段原文。')
      await createNote({
        bookId: chapter.bookId,
        chapterId: chapter.id,
        kind: 'thought',
        title: `AI 边注 · ${marginQuote.slice(0, 16)}`,
        content: markdown,
        quote: marginQuote,
      })
      setToast({ kind: 'info', text: '边注已保存。' })
    },
    [chapter, marginQuote, createNote],
  )

  const startRenameBook = useCallback((target: BookSummary) => {
    setRenameTarget({ kind: 'book', bookId: target.id, value: target.title })
  }, [])

  const startRenameChapter = useCallback((target: ChapterMeta) => {
    setRenameTarget({ kind: 'chapter', chapterId: target.id, value: target.title })
  }, [])

  const startRenamePart = useCallback(
    (partIndex: number, title: string) => {
      if (!book) return
      setRenameTarget({ kind: 'part', bookId: book.id, partIndex, value: title })
    },
    [book],
  )

  const saveRename = useCallback(
    async (value: string): Promise<void> => {
      if (!renameTarget) return
      const title = value.replace(/\s+/g, ' ').trim()
      if (!title) throw new Error('标题不能为空。')
      if (renameTarget.kind === 'book') {
        const updated = await window.api.renameBook(renameTarget.bookId, title)
        setBooks((current) => current.map((item) => (item.id === updated.id ? updated : item)))
        setBook((current) => (current?.id === updated.id ? updated : current))
        return
      }
      if (renameTarget.kind === 'chapter') {
        await window.api.renameChapter(renameTarget.chapterId, title)
        setChapters((current) =>
          current.map((item) => (item.id === renameTarget.chapterId ? { ...item, title } : item)),
        )
        setChapter((current) => (current?.id === renameTarget.chapterId ? { ...current, title } : current))
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
    [renameTarget],
  )

  const updateNote = useCallback(    async (noteId: string, patch: NotePatch) => {
      await window.api.updateNote(noteId, patch)
      if (book) await refreshNotes(book.id, chapter?.id ?? null)
    },
    [book, chapter?.id, refreshNotes],
  )

  const removeNote = useCallback(
    async (noteId: string) => {
      await window.api.deleteNote(noteId)
      if (book) await refreshNotes(book.id, chapter?.id ?? null)
    },
    [book, chapter?.id, refreshNotes],
  )

  const expandNote = useCallback(async (noteId: string) => {
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
      setToast({ kind: 'error', text: messageOf(err) })
    } finally {
      setExpandingNoteId(null)
    }
  }, [])

  const handleQuote = useCallback(
    async (quote: string) => {
      if (!book || !chapter) return
      try {
        const created = await window.api.createNote({
          bookId: book.id,
          chapterId: chapter.id,
          kind: 'highlight',
          content: '',
          quote,
        })
        await refreshNotes(book.id, chapter.id)
        setFocusNote({ id: created.id, key: Date.now() })
      } catch (err) {
        setToast({ kind: 'error', text: messageOf(err) })
      }
    },
    [book, chapter, refreshNotes],
  )

  const formatCurrentChapter = useCallback(
    async (instruction?: string) => {
      if (!chapter) return
      const chapterId = chapter.id
      const token = ++formatTokenRef.current
      setFormatBusy(true)
      setFormatError(null)
      setFormatNote(null)
      if (instruction?.trim()) {
        setFormatMessages((previous) => [...previous, { role: 'user', text: instruction.trim() }])
      }
      try {
        const result = await window.api.formatChapter(chapterId, instruction)
        if (token !== formatTokenRef.current) return
        setChapter((current) =>
          current && current.id === chapterId
            ? { ...current, formattedHtml: result.html, removed: result.removed }
            : current,
        )
        setReaderStyle(result.style)
        setFormatNote(result.note)
        if (instruction?.trim()) {
          setFormatMessages((previous) => [...previous, { role: 'ai', text: result.note }])
        }
      } catch (err) {
        if (token !== formatTokenRef.current) return
        setFormatError(messageOf(err))
      } finally {
        if (token === formatTokenRef.current) setFormatBusy(false)
      }
    },
    [chapter],
  )

  const resetChapterFormat = useCallback(async () => {
    if (!chapter) return
    const chapterId = chapter.id
    formatTokenRef.current += 1
    setFormatBusy(false)
    setFormatError(null)
    setFormatNote(null)
    setFormatMessages([])
    try {
      await window.api.resetChapterFormat(chapterId)
      setChapter((current) =>
        current && current.id === chapterId ? { ...current, formattedHtml: null, removed: [] } : current,
      )
    } catch (err) {
      setFormatError(messageOf(err))
    }
  }, [chapter])

  const changeAppTheme = useCallback((theme: ReaderStyle['theme']) => {
    setAppTheme(theme)
    setReaderStyle((current) => ({ ...current, theme }))
  }, [])

  const updateReaderStyle = useCallback(
    (patch: Partial<ReaderStyle>) => {
      setReaderStyle((current) => {
        const next = { ...current, ...patch }
        if (book) {
          if (styleSaveTimer.current) window.clearTimeout(styleSaveTimer.current)
          styleSaveTimer.current = window.setTimeout(() => {
            void window.api.saveStyle(book.id, next)
          }, 250)
        }
        return next
      })
    },
    [book?.id],
  )

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

  const openOrganize = useCallback(() => setOrganizeOpen(true), [])

  const classifyChaptersForBook = useCallback(async () => {
    if (!book) return
    setClassifying(true)
    setClassifyError(null)
    try {
      const result = await window.api.classifyChapters(book.id)
      setSuggestions(result.suggestions)
      setClassifyMode(result.mode)
      setClassifyError(result.error ?? null)
    } catch (err) {
      setClassifyError(messageOf(err))
    } finally {
      setClassifying(false)
    }
  }, [book])

  const applyChapterFlags = useCallback(
    async (flags: ChapterFlag[]) => {
      try {
        await window.api.applyChapterFlags(flags)
        if (book) await refreshBook(book.id)
      } catch (err) {
        setToast({ kind: 'error', text: messageOf(err) })
      }
    },
    [book, refreshBook],
  )

  const deleteChapterList = useCallback(
    async (chapterIds: string[]) => {
      try {
        await window.api.deleteChapters(chapterIds)
        if (book) await refreshBook(book.id)
      } catch (err) {
        setToast({ kind: 'error', text: messageOf(err) })
      }
    },
    [book, refreshBook],
  )

  const chapterTitles = useMemo(
    () => Object.fromEntries(chapters.map((item) => [item.id, item.title])) as Record<string, string>,
    [chapters],
  )

  const noteCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const note of allNotes) {
      if (note.chapterId) counts[note.chapterId] = (counts[note.chapterId] ?? 0) + 1
    }
    return counts
  }, [allNotes])

  const noteTags = useMemo(
    () => Array.from(new Set(notes.flatMap((note) => note.tags))).slice(0, 12),
    [notes],
  )

  const relatedQuery = useMemo(() => {
    const condensed = notes.find((note) => note.kind === 'condensed')
    const cards = notes
      .filter((note) => note.kind === 'point' || note.kind === 'claim')
      .map((note) => `${note.title}\n${note.content}`)
    // 读薄稿可能很长，语义查询优先带上短小、概念密集的卡片。
    return [condensed?.content.slice(0, 900), ...cards].filter(Boolean).join('\n').slice(0, 1800)
  }, [notes])

  const echoExcerpt = useMemo(() => {
    const condensed = notes.find((note) => note.kind === 'condensed')
    if (condensed) return condensed.content
    return notes
      .filter((note) => note.kind === 'point' || note.kind === 'claim')
      .map((note) => `**${note.title}**\n${note.content}`)
      .join('\n\n')
  }, [notes])

  useEffect(() => {
    if (!book || notes.length === 0) {
      setCrossBookNotes([])
      return
    }
    let cancelled = false
    void window.api
      .listRelatedNotes(book.id, noteTags, relatedQuery)
      .then((items) => {
        if (!cancelled) setCrossBookNotes(items)
      })
      .catch(() => {
        if (!cancelled) setCrossBookNotes([])
      })
    return () => {
      cancelled = true
    }
  }, [book?.id, noteTags, relatedQuery, semanticTick])

  const openRelatedNote = useCallback(
    async (related: RelatedNote) => {
      if (!book) return
      try {
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

        const opened = await window.api.openBook(related.bookId)
        setBook(opened.book)
        setChapters(opened.chapters)
        setReaderStyle({ ...opened.style, theme: appTheme })
        const meta = related.chapterId
          ? opened.chapters.find((item) => item.id === related.chapterId)
          : null
        if (meta) {
          await openChapter(opened.book.id, meta, opened.chapters)
          setPendingNoteId(related.id)
        } else {
          const target =
            opened.chapters.find((item) => !item.hidden && item.kind === 'content') ??
            opened.chapters.find((item) => !item.hidden)
          if (target) await openChapter(opened.book.id, target, opened.chapters)
        }
      } catch (err) {
        setToast({ kind: 'error', text: messageOf(err) })
      }
    },
    [book, chapter?.id, chapters, openChapter, appTheme],
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
      try {
        if (book?.id === result.bookId) {
          const meta = chapters.find((item) => item.id === result.chapterId)
          if (meta) await openChapter(book.id, meta, chapters)
          if (result.type === 'note') setPendingNoteId(result.id)
          return
        }

        const opened = await window.api.openBook(result.bookId)
        setBook(opened.book)
        setChapters(opened.chapters)
        setReaderStyle({ ...opened.style, theme: appTheme })
        const meta = result.chapterId
          ? opened.chapters.find((item) => item.id === result.chapterId)
          : null
        if (meta) {
          await openChapter(opened.book.id, meta, opened.chapters)
        } else {
          const target =
            opened.chapters.find((item) => !item.hidden && item.kind === 'content') ??
            opened.chapters.find((item) => !item.hidden)
          if (target) await openChapter(opened.book.id, target, opened.chapters)
        }
        if (result.type === 'note') setPendingNoteId(result.id)
      } catch (err) {
        setToast({ kind: 'error', text: messageOf(err) })
      }
    },
    [book, chapters, openBook, openChapter, appTheme],
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
    [openSearchResult],
  )

  const openMapBook = useCallback(
    async (bookId: string) => {
      setMainView('reader')
      await openBook(bookId)
    },
    [openBook],
  )

  function leaveReader(): void {
    void window.api.cancelGeneration()
    setGenerating(false)
    setPartial(null)
    setBook(null)
    setMainView('reader')
    setOrganizeOpen(false)
  }

  function openLab(): void {
    setLabMounted(true)
    setLabFocus(null)
    setMainView('lab')
  }

  function openRelationGraph(bookId?: string): void {
    setLabMounted(true)
    setLabFocus({ tool: 'relation-graph', bookId, key: Date.now() })
    setMainView('lab')
  }

  async function openCompose(bookId?: string): Promise<void> {
    if (bookId && book?.id !== bookId) await openBook(bookId)
    setMainView('compose')
  }

  function shareNote(note: Note): void {
    if (!book) return
    setShareTarget({
      note: {
        id: note.id,
        title: noteDisplayTitle(note),
        content: note.content,
        quote: note.quote,
        tags: note.tags,
        bookTitle: book.title,
        chapterTitle: note.chapterId ? chapterTitles[note.chapterId] ?? null : null,
        kind: note.kind,
      },
    })
  }

  function shareLibraryNote(note: LibraryNote): void {
    setShareTarget({
      note: {
        id: note.id,
        title: noteDisplayTitle(note),
        content: note.content,
        quote: note.quote,
        tags: note.tags,
        bookTitle: note.bookTitle,
        chapterTitle: note.chapterTitle,
        kind: note.kind,
      },
    })
  }

  function shareDeck(notes: LibraryNote[]): void {
    setShareTarget({
      notes: notes.map((note) => ({
        id: note.id,
        title: noteDisplayTitle(note),
        content: note.content,
        quote: note.quote,
        tags: note.tags,
        bookTitle: note.bookTitle,
        chapterTitle: note.chapterTitle,
        kind: note.kind,
      })),
      initialTemplate: 'deck',
    })
  }

  async function shareCurrentBook(): Promise<void> {
    if (!book) return
    try {
      const all = await window.api.listNotes(book.id)
      const points = all.filter((note) => note.kind === 'point' || note.kind === 'claim')
      const fallback = all.filter((note) => note.kind === 'summary' || note.kind === 'condensed' || note.kind === 'thought')
      const cards = (points.length > 0 ? points : fallback).slice(0, 4).map((note) => {
        const title = noteDisplayTitle(note).slice(0, 60)
        const detail = titleRepeatsContent(note) ? note.role ?? note.quote ?? '' : note.content
        return {
          title,
          content: detail.replace(/\s+/g, ' ').trim().slice(0, 120),
        }
      })
      setShareTarget({
        book: {
          title: book.title,
          author: book.author,
          chapterCount: chapters.filter((chapter) => !chapter.hidden).length,
          noteCount: all.length,
          cards,
        },
        initialTemplate: 'book',
      })
    } catch (err) {
      setToast({ kind: 'error', text: messageOf(err) })
    }
  }

  return (
    <div className="app">
      <TopBar
        book={book}
        settings={settings}
        importing={importing}
        onLibrary={leaveReader}
        onImport={() => setImportOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onReparse={() => void reparseBook()}
        onSearch={() => setSearchOpen(true)}
        onNotes={() => setMainView('notes')}
        notesActive={mainView === 'notes'}
        onMap={() => setMainView('map')}
        mapActive={mainView === 'map'}
        onLab={openLab}
        labActive={mainView === 'lab'}
        onCompose={() => void openCompose(book?.id)}
        composeActive={mainView === 'compose'}
        onContent={() => {
          setContentFocusId(null)
          setMainView('content')
        }}
        contentActive={mainView === 'content'}
        onRenameBook={book ? () => startRenameBook(book) : undefined}
      />

      <TaskCenter
        tasks={backgroundTasks}
        onCancel={(task) => {
          if (task.kind === 'notes') void window.api.cancelGeneration()
          else void window.api.cancelFormat()
        }}
        onDismiss={(id) => setBackgroundTasks((current) => current.filter((task) => task.id !== id))}
      />

      {toast ? (
        <div className={`toast ${toast.kind}`}>
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="关闭提示">
            ×
          </button>
        </div>
      ) : null}

      {mainView === 'lab' ? null : mainView === 'notes' ? (
        <NotesLibrary
          books={books}
          onBack={() => setMainView('reader')}
          onOpen={(note) => void openLibraryNote(note)}
          onShare={shareLibraryNote}
          onShareDeck={shareDeck}
        />
      ) : mainView === 'map' ? (
        <KnowledgeMap
          onBack={() => setMainView('reader')}
          onOpenNote={(node) => void openMapNote(node)}
          onOpenBook={(bookId) => void openMapBook(bookId)}
          onOpenRelation={openRelationGraph}
        />
      ) : mainView === 'content' ? (
        <ContentView
          books={books}
          initialItemId={contentFocusId}
          onBack={() => setMainView('reader')}
          onOpenSource={(bookId, chapterId) => {
            setMainView('reader')
            void openSearchResult({
              type: chapterId ? 'chapter' : 'book',
              id: chapterId ?? bookId,
              bookId,
              bookTitle: '',
              chapterId,
              chapterTitle: null,
              title: '',
              snippet: '',
              updatedAt: null,
            })
          }}
          onAppliedSource={(bookId, chapterId) => {
            if (book?.id !== bookId) return
            const meta = chapters.find((item) => item.id === chapterId)
            if (meta) void openChapter(book.id, meta, chapters)
          }}
        />
      ) : mainView === 'compose' && book ? (
        <BookCompose
          key={book.id}
          book={book}
          chapters={chapters}
          onBack={() => setMainView('reader')}
          onOpenChapter={(chapterId) => {
            const meta = chapters.find((item) => item.id === chapterId)
            setMainView('reader')
            if (meta) void openChapter(book.id, meta, chapters)
          }}
          onShareBook={() => void shareCurrentBook()}
          onSplitBook={() => setSplitOpen(true)}
        />
      ) : book ? (
        <div className="workspace">
          <ChapterList
            chapters={chapters}
            currentId={chapter?.id ?? null}
            noteCounts={noteCounts}
            progress={book.progress}
            onSelect={(meta) => void openChapter(book.id, meta, chapters)}
            onOrganize={openOrganize}
            onDelete={(meta) => void deleteChapterList([meta.id])}
            onRename={startRenameChapter}
            onRenamePart={startRenamePart}
          />
          <Reader
            chapter={chapter}
            loading={loadingChapter}
            style={readerStyle}
            bookTitle={book?.title ?? ''}
            scrollTarget={scrollTarget}
            echoes={crossBookNotes}
            excerpt={echoExcerpt}
            onQuote={(quote) => void handleQuote(quote)}
            onOpenFormat={() => setSideTab('format')}
            onOpenEcho={(echo) => void openRelatedNote(echo)}
            onListen={() => {
              if (chapter) setListen({ title: chapter.title, text: chapter.text })
            }}
            onRenameChapter={() => {
              if (chapter) startRenameChapter(chapter)
            }}
            onMarginNote={(quote) => setMarginQuote(quote)}
          />
          <aside className="side-panel">
            <div className="side-tabs">
              <button
                type="button"
                className={`side-tab${sideTab === 'notes' ? ' active' : ''}`}
                onClick={() => setSideTab('notes')}
              >
                笔记
              </button>
              <button
                type="button"
                className={`side-tab${sideTab === 'chat' ? ' active' : ''}`}
                onClick={() => setSideTab('chat')}
              >
                问答
              </button>
              <button
                type="button"
                className={`side-tab${sideTab === 'feynman' ? ' active' : ''}`}
                onClick={() => setSideTab('feynman')}
              >
                自测
              </button>
              <button
                type="button"
                className={`side-tab${sideTab === 'format' ? ' active' : ''}`}
                onClick={() => setSideTab('format')}
              >
                排版
              </button>
            </div>
            {sideTab === 'notes' ? (
              <NotesPanel
                chapter={chapter}
                bookTitle={book?.title ?? ''}
                author={book?.author ?? ''}
                notes={notes}
                allNotes={allNotes}
                chapterTitles={chapterTitles}
                generating={generating}
                partial={partial}
                error={error}
                report={chapter?.noteReport ?? null}
                generationMode={settings?.generationMode ?? 'standard'}
                crossBookNotes={crossBookNotes}
                onOpenRelated={(note) => void openRelatedNote(note)}
                focusNoteId={focusNote?.id ?? null}
                focusKey={focusNote?.key ?? 0}
                expandingNoteId={expandingNoteId}
                onGenerate={() => void generate()}
                onCancel={() => void cancelGeneration()}
                onCreate={createNote}
                onUpdate={updateNote}
                onDelete={removeNote}
                onExpand={(noteId) => void expandNote(noteId)}
                onJumpQuote={(quote) => setScrollTarget({ quote, key: Date.now() })}
                onOpenNote={(note) => void openNote(note)}
                onListen={(text) => setListen({ title: `朗读 · ${chapter?.title ?? ''}`, text })}
                onShare={shareNote}
              />
            ) : sideTab === 'chat' ? (
              <ChatPanel
                key={chapter?.id ?? 'no-chapter'}
                chapter={chapter}
                bookTitle={book?.title ?? ''}
                onJumpQuote={(quote) => setScrollTarget({ quote, key: Date.now() })}
                onSave={(text) => saveTutorNote(`问答 · ${chapter?.title ?? ''}`, text)}
              />
            ) : sideTab === 'feynman' ? (
              <FeynmanPanel
                key={chapter?.id ?? 'no-chapter'}
                chapter={chapter}
                bookTitle={book?.title ?? ''}
                hasNotes={notes.some(
                  (note) => note.kind === 'condensed' || note.kind === 'point' || note.kind === 'claim',
                )}
                onSave={(text) => saveTutorNote(`我的理解 · ${chapter?.title ?? ''}`, text)}
              />
            ) : (
              <FormatPanel
                chapter={chapter}
                style={readerStyle}
                busy={formatBusy}
                error={formatError}
                note={formatNote}
                messages={formatMessages}
                demo={settings?.demo ?? false}
                onFormat={(instruction) => void formatCurrentChapter(instruction)}
                onReset={() => void resetChapterFormat()}
                onStyleChange={updateReaderStyle}
              />
            )}
          </aside>
        </div>
      ) : (
        <Library
          books={books}
          importing={importing}
          onOpen={(bookId) => void openBook(bookId)}
          onImport={() => setImportOpen(true)}
          onDelete={(bookId) => void deleteBook(bookId)}
          onRename={startRenameBook}
          onCompose={(bookId) => void openCompose(bookId)}
          onMerge={() => setMergeOpen(true)}
        />
      )}

      {labMounted ? (
        <div className={`lab-shell${mainView === 'lab' ? ' is-active' : ''}`}>
          <LabView
            books={books}
            initialTool={labFocus?.tool}
            initialBookId={labFocus?.bookId}
            focusKey={labFocus?.key}
            onBack={() => setMainView('reader')}
            onSaveReport={saveLabReport}
            onListen={(title, text) => setListen({ title, text })}
          />
        </div>
      ) : null}

      {settings ? (
        <SettingsDialog
          open={settingsOpen}
          settings={settings}
          appInfo={appInfo}
          theme={appTheme}
          onThemeChange={changeAppTheme}
          onClose={() => setSettingsOpen(false)}
          onSaved={(saved) => {
            setSettings(saved)
            setToast({ kind: 'info', text: saved.demo ? '已切换到演示模式' : `已切换到 ${saved.model}` })
          }}
        />
      ) : null}

      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpen={(result) => void openSearchResult(result)}
      />

      {listen ? <ListenPanel title={listen.title} text={listen.text} onClose={() => setListen(null)} /> : null}

      {marginQuote && chapter ? (
        <MarginNoteDialog
          chapter={chapter}
          quote={marginQuote}
          onSave={saveMarginNote}
          onClose={() => setMarginQuote(null)}
        />
      ) : null}

      {renameTarget ? (
        <RenameDialog
          open
          title={
            renameTarget.kind === 'book'
              ? '重命名书名'
              : renameTarget.kind === 'chapter'
                ? '重命名章节'
                : '重命名分篇'
          }
          label={renameTarget.kind === 'book' ? '书名' : renameTarget.kind === 'chapter' ? '章节名' : '分篇名'}
          value={renameTarget.value}
          onSave={saveRename}
          onClose={() => setRenameTarget(null)}
        />
      ) : null}

      {shareTarget ? (
        <ShareDialog
          note={shareTarget.note ?? null}
          book={shareTarget.book ?? null}
          notes={shareTarget.notes ?? null}
          initialTemplate={shareTarget.initialTemplate}
          onClose={() => setShareTarget(null)}
        />
      ) : null}

      <OrganizeDialog
        open={organizeOpen}
        chapters={chapters}
        suggestions={suggestions}
        mode={classifyMode}
        error={classifyError}
        busy={classifying}
        onClose={() => setOrganizeOpen(false)}
        onClassify={() => void classifyChaptersForBook()}
        onApply={applyChapterFlags}
        onDelete={deleteChapterList}
      />

      <MergeBooksDialog
        open={mergeOpen}
        books={books}
        onClose={() => setMergeOpen(false)}
        onMerged={(merged) => void handleMerged(merged)}
      />

      <SplitBookDialog
        open={splitOpen}
        book={book}
        chapters={chapters}
        onClose={() => setSplitOpen(false)}
        onSplit={(newBook) => void handleSplit(newBook)}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onFileImport={importFile}
        onImported={(imported) => void handleImported(imported)}
        onHighlightsImported={(result) => void handleHighlightsImported(result)}
      />

      <ConfirmHost />
    </div>
  )
}
