import { bridge } from './lib/bridge.js'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'

import { useBookshelf, type BookshelfActions } from './hooks/useBookshelf.js'
import { useCoreMode } from './hooks/useCoreMode.js'
import { useFormatPanel } from './hooks/useFormatPanel.js'
import { useTasks } from './hooks/useTasks.js'
import { useBookTranslation } from './hooks/useBookTranslation.js'
import { useTranslation } from './hooks/useTranslation.js'
import { useGeneration } from './hooks/useGeneration.js'
import { useImportFlow } from './hooks/useImportFlow.js'
import { useOrganize } from './hooks/useOrganize.js'
import { useNavigation } from './hooks/useNavigation.js'
import { useNoteActions } from './hooks/useNoteActions.js'
import { useNoteStore } from './hooks/useNoteStore.js'
import { useReaderSession } from './hooks/useReaderSession.js'
import { useReaderStyle } from './hooks/useReaderStyle.js'
import { useRename } from './hooks/useRename.js'
import { useViews, type MainView } from './hooks/useViews.js'
import { useShare } from './hooks/useShare.js'
import { useToast } from './hooks/useToast.js'
import { t, useLocale } from './lib/i18n.js'
import { hydratePreferences } from './lib/preferences.js'
import { hydrateReadingStats } from './lib/reading-stats.js'
import type {
  AppInfo,
  BookSummary,
  DoclingProgressEvent,
  LabToolId,
  ReaderStyle,
  RelatedNote,
  SettingsView,
} from '../shared/types.js'
import { PROVIDER_PRESETS } from '../shared/types.js'
import { ConfirmHost, confirmOptionDialog } from './components/ConfirmDialog.js'
import { AppLockScreen } from './components/AppLockScreen.js'
import { ChapterList } from './components/ChapterList.js'
import { ChatPanel } from './components/ChatPanel.js'
import { FeynmanPanel } from './components/FeynmanPanel.js'
import { FormatPanel } from './components/FormatPanel.js'
import { Library } from './components/Library.js'
import { ListenPanel } from './components/ListenPanel.js'
import { NotesPanel } from './components/NotesPanel.js'
import { DeepParseOverlay } from './components/DeepParseOverlay.js'
import { GenerationPreflight } from './components/GenerationPreflight.js'
import { Reader } from './components/Reader.js'
import { OnboardingDialog, SAMPLE_BOOK } from './components/OnboardingDialog.js'
import type { SearchCommandId } from './components/SearchDialog.js'
import { ManualView } from './components/ManualView.js'
import { TaskCenter } from './components/TaskCenter.js'
import { TopBar } from './components/TopBar.js'
import { messageOf } from './lib/errors.js'
import { isoWeekLabel } from './lib/week.js'

const BookCompose = lazy(async () => ({ default: (await import('./components/BookCompose.js')).BookCompose }))
const ContentView = lazy(async () => ({ default: (await import('./components/ContentView.js')).ContentView }))
const KnowledgeMap = lazy(async () => ({ default: (await import('./components/KnowledgeMap.js')).KnowledgeMap }))
const LabView = lazy(async () => ({ default: (await import('./components/LabView.js')).LabView }))
const NotesLibrary = lazy(async () => ({ default: (await import('./components/NotesLibrary.js')).NotesLibrary }))
const ReadingPlanDialog = lazy(async () => ({ default: (await import('./components/ReadingPlanDialog.js')).ReadingPlanDialog }))
const StatsView = lazy(async () => ({ default: (await import('./components/StatsView.js')).StatsView }))
const WeeklyReviewsView = lazy(async () => ({ default: (await import('./components/WeeklyReviewsView.js')).WeeklyReviewsView }))
const XhsCarouselDialog = lazy(async () => ({ default: (await import('./components/XhsCarouselDialog.js')).XhsCarouselDialog }))
const BookTrashDialog = lazy(async () => ({ default: (await import('./components/BookTrashDialog.js')).BookTrashDialog }))
const ChapterTrashDialog = lazy(async () => ({ default: (await import('./components/ChapterTrashDialog.js')).ChapterTrashDialog }))
const ImportDialog = lazy(async () => ({ default: (await import('./components/ImportDialog.js')).ImportDialog }))
const MarginNoteDialog = lazy(async () => ({ default: (await import('./components/MarginNoteDialog.js')).MarginNoteDialog }))
const MergeBooksDialog = lazy(async () => ({ default: (await import('./components/MergeBooksDialog.js')).MergeBooksDialog }))
const OrganizeDialog = lazy(async () => ({ default: (await import('./components/OrganizeDialog.js')).OrganizeDialog }))
const RenameDialog = lazy(async () => ({ default: (await import('./components/RenameDialog.js')).RenameDialog }))
const SearchDialog = lazy(async () => ({ default: (await import('./components/SearchDialog.js')).SearchDialog }))
const SettingsDialog = lazy(async () => ({ default: (await import('./components/SettingsDialog.js')).SettingsDialog }))
const ShareDialog = lazy(async () => ({ default: (await import('./components/ShareDialog.js')).ShareDialog }))
const SplitBookDialog = lazy(async () => ({ default: (await import('./components/SplitBookDialog.js')).SplitBookDialog }))

export function App(): JSX.Element {
  useLocale()
  const shelfActions = useRef<BookshelfActions>({
    appTheme: 'folio',
    refreshNotes: async () => undefined,
    resetNotes: () => undefined,
    resetChapterView: () => undefined,
    resetBookView: () => undefined,
    setStyle: () => undefined,
    refreshBookmarks: () => undefined,
    notify: () => undefined,
  })
  const {
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
    clearBook,
    loadingChapter,
    openBook,
    openBookAt,
    openChapter,
    refreshBook,
    deleteBook,
  } = useBookshelf(shelfActions)
  const { appTheme, setAppTheme, readerStyle, setReaderStyle, updateReaderStyle } = useReaderStyle(book?.id ?? null)
  const [coreMode, setCoreMode] = useCoreMode()
  const { notes, allNotes, setNotes, setAllNotes, refreshNotes, resetNotes, patchNote } = useNoteStore()
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [planBook, setPlanBook] = useState<BookSummary | null>(null)
  const [planVersion, setPlanVersion] = useState(0)
  const [booksLoaded, setBooksLoaded] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [bookTrashOpen, setBookTrashOpen] = useState(false)
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false)
  const [pendingGenerate, setPendingGenerate] = useState<{ fresh: boolean } | null>(null)
  const [deepParse, setDeepParse] = useState<{
    title: string
    startedAt: number
    progress: DoclingProgressEvent | null
  } | null>(null)
  const [sampleBookId, setSampleBookId] = useState<string | null>(null)
  const sampleBook = useMemo(() => books.find((item) => item.title === SAMPLE_BOOK.title) ?? null, [books])
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [locked, setLocked] = useState(false)
  const [toast, setToast] = useToast()
  const applyReaderStyle = useCallback(
    (style: Partial<ReaderStyle>) => setReaderStyle((current) => ({ ...current, ...style })),
    [setReaderStyle],
  )
  const {
    generating,
    partial,
    error,
    generate,
    cancelGeneration,
    resetGeneration,
  } = useGeneration({
    chapterId: chapter?.id ?? null,
    bookId: book?.id ?? null,
    setNotes,
    setAllNotes,
    setChapter,
    setBooks,
    applyStyle: applyReaderStyle,
    notify: setToast,
  })
  const preflightKey = `reading-notes-preflight:${settings?.provider ?? 'demo'}:${
    settings?.notesModel || settings?.model || ''
  }:${settings?.generationMode ?? 'standard'}`
  const requestGenerate = useCallback(
    (fresh = false) => {
      if (!chapter) return
      if (settings?.demo) {
        void generate(fresh)
        return
      }
      try {
        if (sessionStorage.getItem(preflightKey) === '1') {
          void generate(fresh)
          return
        }
      } catch {
        // sessionStorage 不可用时仍然显示预检。
      }
      setPendingGenerate({ fresh })
    },
    [chapter, generate, preflightKey, settings?.demo],
  )

  const handleBooksChanged = useCallback(() => {
    void bridge
      .listBooks()
      .then(setBooks)
      .catch(() => undefined)
  }, [setBooks])

  // 后台排版/读薄结束时同步书架总字数、已读字数和笔记数，避免切回书架看到旧数字。
  useEffect(() => {
    let timer: number | undefined
    const schedule = (): void => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void bridge
          .listBooks()
          .then(setBooks)
          .catch(() => undefined)
      }, 500)
    }
    const offFormatted = bridge.onChapterFormatted(schedule)
    const offGenerated = bridge.onGenerationDone(schedule)
    return () => {
      offFormatted()
      offGenerated()
      if (timer) window.clearTimeout(timer)
    }
  }, [setBooks])

  const finishOnboarding = useCallback(() => {
    try {
      localStorage.setItem('reading-notes-onboarding-done', '1')
    } catch {
      // 本地标记写入失败时，下次仍会显示引导。
    }
    setOnboardingOpen(false)
  }, [])

  useEffect(() => {
    if (!booksLoaded || books.length > 0) return
    try {
      if (localStorage.getItem('reading-notes-onboarding-done') === '1') return
    } catch {
      // 存储不可用时仍然显示。
    }
    setOnboardingOpen(true)
  }, [books.length, booksLoaded])

  const importSampleBook = useCallback(async () => {
    const existing = books.find((item) => item.title === SAMPLE_BOOK.title)
    if (existing) {
      setSampleBookId(existing.id)
      return
    }
    const imported = await bridge.importText(SAMPLE_BOOK)
    setBooks((current) => [imported, ...current.filter((item) => item.id !== imported.id)])
    setSampleBookId(imported.id)
  }, [books, setBooks])

  const backgroundViewRef = useRef<{ mainView: MainView; chapterId: string | null; bookId: string | null }>({
    mainView: 'reader',
    chapterId: null,
    bookId: null,
  })
  const { tasks: backgroundTasks, setTasks: setBackgroundTasks } = useTasks({
    notify: setToast,
    onBooksChanged: handleBooksChanged,
    isJobVisible: (job) => {
      const view = backgroundViewRef.current
      if (job.kind === 'compose') return view.mainView === 'compose' && view.bookId === job.bookId
      return view.mainView === 'reader' && view.chapterId === job.chapterId
    },
  })
  const {
    busy: formatBusy,
    error: formatError,
    note: formatNote,
    messages: formatMessages,
    formatCurrentChapter,
    resetChapterFormat,
    resetFormatState,
  } = useFormatPanel({
    chapterId: chapter?.id ?? null,
    setChapter,
    setStyle: setReaderStyle,
  })
  const {
    translating,
    showTranslation,
    progress: translationProgress,
    hasTranslation,
    toggle: toggleTranslation,
    retranslate: retranslateChapter,
  } = useTranslation({ chapter, setChapter, notify: setToast })
  const {
    info: bookTranslation,
    running: bookTranslationRunning,
    progress: bookTranslationProgress,
    translateBook: translateWholeBook,
  } = useBookTranslation(book?.id ?? null, setToast)
  const {
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
  } = useOrganize({ bookId: book?.id ?? null, refreshBook, notify: setToast })
  const {
    importing,
    importOpen,
    setImportOpen,
    mergeOpen,
    setMergeOpen,
    splitOpen,
    setSplitOpen,
    importFile,
    handleImported,
    handleOcrStarted,
    handleHighlightsImported,
    handleMerged,
    handleSplit,
  } = useImportFlow({
    bookId: book?.id ?? null,
    openBook,
    refreshBook,
    setBooks,
    setTasks: setBackgroundTasks,
    notify: setToast,
  })
  const {
    bookmarks,
    positionTarget,
    setPositionTarget,
    listen,
    setListen,
    marginQuote,
    setMarginQuote,
    focusNote,
    setFocusNote,
    setPendingNoteId,
    scrollTarget,
    setScrollTarget,
    sideTab,
    setSideTab,
    chatSeed,
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
  } = useReaderSession({
    book,
    chapter,
    chapters,
    notes,
    setReaderMarks,
    openChapter,
    notify: setToast,
  })

  useEffect(() => {
    if (!coreMode) return
    setSideTab((current) => (current === 'feynman' ? 'notes' : current))
  }, [coreMode, setSideTab])

  useEffect(() => {
    return bridge.onDoclingProgress((event) => {
      setDeepParse((current) => (current ? { ...current, progress: event } : current))
    })
  }, [])
  const { renameTarget, setRenameTarget, startRenameBook, startRenameChapter, startRenamePart, saveRename } =
    useRename({ bookId: book?.id ?? null, setBooks, setBook, setChapters, setChapter })
  const {
    settingsOpen,
    setSettingsOpen,
    searchOpen,
    setSearchOpen,
    mainView,
    setMainView,
    labMounted,
    composeMountedBookId,
    contentFocusId,
    setContentFocusId,
    leaveReader,
    openLab,
    openCompose,
  } = useViews({ bookId: book?.id ?? null, openBook, clearBook, resetGeneration, resetOrganize })
  backgroundViewRef.current = {
    mainView,
    chapterId: chapter?.id ?? null,
    bookId: book?.id ?? null,
  }
  const [manualReturn, setManualReturn] = useState<MainView>('reader')
  const openSampleBook = useCallback(async () => {
    const targetId = sampleBookId ?? sampleBook?.id
    if (!targetId) return
    await openBook(targetId)
    setMainView('reader')
    finishOnboarding()
  }, [finishOnboarding, openBook, sampleBook, sampleBookId, setMainView])
  const openManual = useCallback(() => {
    setManualReturn(mainView === 'manual' ? 'reader' : mainView)
    setSettingsOpen(false)
    setMainView('manual')
  }, [mainView, setMainView, setSettingsOpen])
  const {
    expandingNoteId,
    setExpandingNoteId,
    createNote,
    saveTutorNote,
    saveLabReport,
    saveMarginNote,
    updateNote,
    removeNote,
    expandNote,
  } = useNoteActions({
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
    notify: setToast,
  })
  const { openRelatedNote, openSearchResult, openLibraryNote, openMapNote, openMapBook } = useNavigation({
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
    notify: setToast,
  })
  const [crossBookNotes, setCrossBookNotes] = useState<RelatedNote[]>([])
  const [readerFocus, setReaderFocus] = useState(false)
  const [labTool, setLabTool] = useState<LabToolId>('library-research')
  const [semanticTick, setSemanticTick] = useState(0)

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

  useEffect(() => bridge.onSemanticReady(() => setSemanticTick((value) => value + 1)), [])
  useEffect(() => bridge.onAppNotice((notice) => setToast(notice)), [])

  useEffect(() => {
    if (mainView !== 'reader' || !book) setReaderFocus(false)
  }, [book, mainView])

  const toggleReaderFocus = useCallback(() => setReaderFocus((value) => !value), [])

  const loadAppData = useCallback(async () => {
    await Promise.all([hydrateReadingStats(), hydratePreferences()])
    const [nextBooks, nextSettings] = await Promise.all([bridge.listBooks(), bridge.getSettings()])
    setBooks(nextBooks)
    setSettings(nextSettings)
    setBooksLoaded(true)
  }, [setBooks])

  useEffect(() => {
    void bridge
      .getAppInfo()
      .then((info) => {
        setAppInfo(info)
        if (info.lockEnabled) {
          setLocked(true)
          setBooksLoaded(true)
          return
        }
        void loadAppData().catch((err: unknown) => {
          setToast({ kind: 'error', text: messageOf(err) })
          setBooksLoaded(true)
        })
      })
      .catch((err: unknown) => {
        setToast({ kind: 'error', text: messageOf(err) })
        void loadAppData().catch(() => setBooksLoaded(true))
      })
  }, [loadAppData, setToast])

  const unlockApp = useCallback(
    async (passcode: string): Promise<boolean> => {
      const ok = await bridge.verifyAppLock(passcode)
      if (!ok) return false
      await loadAppData()
      setLocked(false)
      return true
    },
    [loadAppData],
  )

  const resetChapterView = useCallback(() => {
    resetGeneration()
    resetFormatState()
    setExpandingNoteId(null)
    setPositionTarget(null)
    setReaderMarks([])
  }, [resetFormatState, resetGeneration, setPositionTarget, setReaderMarks])

  const resetBookView = useCallback(() => {
    resetOrganize()
  }, [resetOrganize])

  // 这些动作依赖 generation / format / notes / session，用 ref 交给 useBookshelf，避免 hook 初始化顺序耦合。
  shelfActions.current = {
    appTheme,
    refreshNotes,
    resetNotes,
    resetChapterView,
    resetBookView,
    setStyle: setReaderStyle,
    refreshBookmarks: (bookId: string) => {
      void refreshBookmarks(bookId)
    },
    notify: setToast,
  }

  const reparseBook = useCallback(async () => {
    if (!book) return
    const docling = book.format === 'pdf' ? await bridge.getDoclingStatus().catch(() => null) : null
    const result = await confirmOptionDialog({
      title: t('重新解析目录'),
      message:
        t('重新解析会用新的章节切分替换目录。已有笔记会先按原文引用、再按章节标题重新归属；匹配不上的笔记会保留，但不再显示在章节里。继续？'),
      confirmLabel: t('继续解析'),
      danger: true,
      checkboxLabel: t('忽略参考文献 / 注释 / 索引'),
      checkboxDefault: false,
      ...(book.format === 'pdf' && docling?.available
        ? {
            secondCheckboxLabel: t('使用 Docling 深度解析（较慢，版面和图片更完整）'),
            secondCheckboxDefault: false,
          }
        : {}),
    })
    if (!result.confirmed) return
    const deep = result.secondChecked
    if (deep) {
      setDeepParse({ title: book.title, startedAt: Date.now(), progress: null })
    }
    try {
      const updated = await bridge.reparseBook(book.id, {
        skipReferences: result.checked,
        deepPdf: deep,
      })
      setBooks((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      await openBook(updated.id)
      setToast({
        kind: 'info',
        text: result.checked
          ? t('已重新解析目录并忽略参考文献，笔记已尽量保留。')
          : t('已重新解析目录，笔记已尽量保留。'),
      })
    } catch (err) {
      setToast({ kind: 'error', text: messageOf(err) })
    } finally {
      if (deep) setDeepParse(null)
    }
  }, [book, openBook])

  const changeAppTheme = useCallback((theme: ReaderStyle['theme']) => {
    setAppTheme(theme)
    setReaderStyle((current) => ({ ...current, theme }))
  }, [])

  const chapterTitles = useMemo(
    () => Object.fromEntries(chapters.map((item) => [item.id, item.title])) as Record<string, string>,
    [chapters],
  )
  const visibleChapters = useMemo(() => chapters.filter((item) => !item.hidden), [chapters])
  const chapterPosition = useMemo(
    () => visibleChapters.findIndex((item) => item.id === chapter?.id),
    [chapter?.id, visibleChapters],
  )
  const goToAdjacentChapter = useCallback(
    (offset: number) => {
      if (!book) return
      const next = visibleChapters[chapterPosition + offset]
      if (next) void openChapter(book.id, next, chapters)
    },
    [book, chapterPosition, chapters, openChapter, visibleChapters],
  )
  const goPrevChapter = useCallback(() => goToAdjacentChapter(-1), [goToAdjacentChapter])
  const goNextChapter = useCallback(() => goToAdjacentChapter(1), [goToAdjacentChapter])
  const {
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
  } = useShare({ book, chapter, chapters, chapterTitles, notify: setToast })

  const noteCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const note of allNotes) {
      if (note.chapterId) counts[note.chapterId] = (counts[note.chapterId] ?? 0) + 1
    }
    return counts
  }, [allNotes])

  const noteTags = useMemo(
    () =>
      Array.from(
        new Set(
          notes
            .filter((note) => note.kind !== 'condensed' && note.kind !== 'summary' && note.kind !== 'question')
            .flatMap((note) => note.tags),
        ),
      ).slice(0, 12),
    [notes],
  )

  const relatedQuery = useMemo(() => {
    const cards = notes
      .filter((note) => note.kind === 'point' || note.kind === 'claim')
      .map((note) => `${note.title}\n${note.content}`)
    // 读薄稿是整章改写，不是知识点；回声只用卡片作为查询依据。
    return cards.join('\n').slice(0, 1800)
  }, [notes])

  const echoExcerpt = useMemo(
    () =>
      notes
        .filter((note) => note.kind === 'point' || note.kind === 'claim')
        .map((note) => `**${note.title}**\n${note.content}`)
        .join('\n\n'),
    [notes],
  )

  useEffect(() => {
    if (!book || notes.length === 0) {
      setCrossBookNotes([])
      return
    }
    let cancelled = false
    void bridge
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

  function runSearchCommand(action: SearchCommandId): void {
    switch (action) {
      case 'library':
        leaveReader()
        break
      case 'reader':
        setMainView('reader')
        break
      case 'notes':
        setMainView('notes')
        break
      case 'content':
        setContentFocusId(null)
        setMainView('content')
        break
      case 'compose':
        if (book) void openCompose(book.id)
        break
      case 'map':
        setMainView('map')
        break
      case 'lab':
        setLabTool('library-research')
        openLab()
        break
      case 'stats':
        setMainView('stats')
        break
      case 'weekly':
        setMainView('weekly')
        break
      case 'settings':
        setSettingsOpen(true)
        break
      case 'import':
        setImportOpen(true)
        break
      case 'manual':
        openManual()
        break
    }
  }

  return (
    <div className={`app${mainView === 'reader' && book && readerFocus ? ' is-focus' : ''}`}>
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
        onLab={() => {
          setLabTool('library-research')
          openLab()
        }}
        labActive={mainView === 'lab'}
        onCompose={() => void openCompose(book?.id)}
        composeActive={mainView === 'compose'}
        onContent={() => {
          setContentFocusId(null)
          setMainView('content')
        }}
        contentActive={mainView === 'content'}
        onManual={openManual}
        onRenameBook={book ? () => startRenameBook(book) : undefined}
        coreMode={coreMode}
        onToggleCoreMode={setCoreMode}
      />

      <TaskCenter
        tasks={backgroundTasks}
        onRetry={(task) => {
          const retry = task.retry
          if (!retry) return
          setBackgroundTasks((current) =>
            current.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    status: 'running',
                    detail: retry.kind === 'compose' ? t('正在继续成稿') : t('正在重试失败章节'),
                    done: 0,
                    total: retry.kind === 'compose' ? 1 : retry.chapterIds.length,
                    failures: [],
                    retry: undefined,
                  }
                : item,
            ),
          )
          const resume = task.status === 'paused'
          const run =
            retry.kind === 'translate'
              ? retry.chapterId
                ? bridge.translateChapter(retry.chapterId)
                : bridge.translateBook(retry.bookId, { chapterIds: retry.chapterIds })
              : retry.kind === 'compose'
              ? bridge
                  .composeBook(retry.bookId, retry.composeOptions ?? { length: 'tight', voice: 'calm' })
                  .then(() => undefined)
              : retry.chapterId
                ? retry.kind === 'notes'
                  ? bridge.generateNotes(retry.chapterId)
                  : bridge.formatChapter(retry.chapterId, undefined, retry.formatOptions).then(() => undefined)
                : retry.kind === 'notes'
                  ? bridge.generateBookNotes(retry.bookId, { onlyMissing: resume, chapterIds: retry.chapterIds })
                  : bridge.formatBook(retry.bookId, { onlyMissing: resume, chapterIds: retry.chapterIds })
          void run.catch((err: unknown) => {
            const message = messageOf(err)
            setBackgroundTasks((current) =>
              current.map((item) =>
                item.id === task.id ? { ...item, status: 'error', detail: `${t('重试失败')}：${message}` } : item,
              ),
            )
            setToast({ kind: 'error', text: message })
          })
        }}
        onCancel={(task) => {
          const target = task.chapterId
            ? { chapterId: task.chapterId }
            : task.bookId
              ? { bookId: task.bookId }
              : undefined
          if (task.kind === 'notes') void bridge.cancelGeneration(target)
          else if (task.kind === 'format') void bridge.cancelFormat(target)
          else if (task.kind === 'compose') void bridge.cancelBookCompose(target)
          else if (task.kind === 'translate') void bridge.cancelTranslation(target)
          else void bridge.cancelOcrImport()
        }}
        onDismiss={(id) => {
          void bridge.dismissAiJob(id)
          setBackgroundTasks((current) => current.filter((task) => task.id !== id))
        }}
        onOpenStats={() => setMainView('stats')}
      />

      {toast ? (
        <div className={`toast ${toast.kind}`} role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action?.onClick()
                setToast(null)
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button type="button" onClick={() => setToast(null)} aria-label={t('关闭提示')}>
            ×
          </button>
        </div>
      ) : null}

      {mainView === 'manual' ? (
        <ManualView onBack={() => setMainView(manualReturn)} />
      ) : mainView === 'lab' ? null : mainView === 'weekly' ? (
        <Suspense fallback={<div className="view-loading-shell"><p className="view-loading">{t('正在加载周复盘…')}</p></div>}>
          <WeeklyReviewsView onBack={() => setMainView('stats')} />
        </Suspense>
      ) : mainView === 'stats' ? (
        <Suspense fallback={<div className="view-loading-shell"><p className="view-loading">{t('正在加载阅读统计…')}</p></div>}>
          <StatsView
            books={books}
            onBack={() => setMainView('reader')}
            onOpenWeeklyReview={() => {
              setLabTool('weekly-review')
              openLab()
            }}
            onOpenWeeklyReviews={() => setMainView('weekly')}
            onSaveWeeklyReview={async (markdown) => {
              const week = isoWeekLabel()
              await bridge.saveWeeklyReview({
                week,
                title: `${t('每周复盘')} · ${week}`,
                content: markdown,
              })
              setToast({ kind: 'info', text: t('已存为本周复盘。') })
            }}
          />
        </Suspense>
      ) : mainView === 'notes' ? (
        <Suspense fallback={<div className="view-loading-shell"><p className="view-loading">{t('正在加载笔记库…')}</p></div>}>
          <NotesLibrary
            books={books}
            onBack={() => setMainView('reader')}
            onOpen={(note) => void openLibraryNote(note)}
            onShare={shareLibraryNote}
            onShareDeck={shareDeck}
          />
        </Suspense>
      ) : mainView === 'map' ? (
        <Suspense fallback={<div className="view-loading-shell"><p className="view-loading">{t('正在加载知识地图…')}</p></div>}>
          <KnowledgeMap
            books={books}
            onBack={() => setMainView('reader')}
            onOpenNote={(node) => void openMapNote(node)}
            onOpenBook={(bookId) => void openMapBook(bookId)}
          />
        </Suspense>
      ) : mainView === 'content' ? (
        <Suspense fallback={<div className="view-loading-shell"><p className="view-loading">{t('正在加载内容库…')}</p></div>}>
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
        </Suspense>
      ) : mainView === 'compose' ? null : book ? (
        <div className={`workspace${sidePanelCollapsed ? ' is-side-collapsed' : ''}`}>
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
            bookmarks={bookmarks}
            onOpenBookmark={(bookmark) => void openBookmark(bookmark)}
            onDeleteBookmark={(id) => void deleteReaderBookmark(id)}
          />
          <Reader
            chapter={chapter}
            loading={loadingChapter}
            style={readerStyle}
            bookTitle={book?.title ?? ''}
            bookAuthor={book?.author ?? ''}
            scrollTarget={scrollTarget}
            echoes={crossBookNotes}
            excerpt={echoExcerpt}
            translatedText={chapter?.translatedText ?? null}
            translatedHtml={chapter?.translatedHtml ?? null}
            hasTranslation={hasTranslation}
            showTranslation={showTranslation}
            translationBusy={translating}
            translationProgress={translationProgress}
            onToggleTranslation={toggleTranslation}
            onRetranslateTranslation={() => void retranslateChapter()}
            bookForeign={bookTranslation?.foreign ?? false}
            bookTranslation={bookTranslation}
            bookTranslationRunning={bookTranslationRunning}
            bookTranslationProgress={bookTranslationProgress}
            onTranslateBook={() => void translateWholeBook()}
            marks={readerMarks}
            onCreateMark={(style, text) => void createReaderMark(style, text)}
            onClearMarks={(ids) => void clearReaderMarks(ids)}
            onOpenFormat={() => setSideTab('format')}
            onOpenEcho={(echo) => void openRelatedNote(echo)}
            onListen={() => {
              if (chapter) setListen({ title: chapter.title, text: chapter.text, scope: chapter.id })
            }}
            onRenameChapter={() => {
              if (chapter) startRenameChapter(chapter)
            }}
            onMarginNote={(quote) => setMarginQuote(quote)}
            onAsk={askAboutSelection}
            onShareQuote={shareQuote}
            onListenSelection={listenSelection}
            onOpenXhs={openChapterXhs}
            positionTarget={positionTarget}
            onCreateBookmark={(input) => void createReaderBookmark(input)}
            pdfBookId={book.format === 'pdf' || book.format === 'pdf-ocr' ? book.id : undefined}
            pdfBookTitle={book.title}
            chapterIndex={chapterPosition >= 0 ? chapterPosition : undefined}
            chapterTotal={visibleChapters.length}
            onPrevChapter={goPrevChapter}
            onNextChapter={goNextChapter}
            onAdjustStyle={applyReaderStyle}
            focusMode={readerFocus}
            onToggleFocus={toggleReaderFocus}
            onNotify={setToast}
            onSaveSummary={
              chapter
                ? async (title, markdown) => {
                    await saveLabReport(title, markdown, chapter.bookId, chapter.id)
                  }
                : undefined
            }
          />
          {sidePanelCollapsed ? (
            <aside className="side-rail" aria-label={t('侧栏已收起')}>
              <button type="button" onClick={() => { setSideTab('notes'); setSidePanelCollapsed(false) }}>
                {t('本章笔记')}
              </button>
              <button type="button" onClick={() => { setSideTab('chat'); setSidePanelCollapsed(false) }}>
                {t('问答')}
              </button>
            </aside>
          ) : (
          <aside className="side-panel">
            <div className="side-tabs">
              <button
                type="button"
                className={`side-tab${sideTab === 'notes' ? ' active' : ''}`}
                onClick={() => setSideTab('notes')}
              >
                {t('本章笔记')}
              </button>
              <button
                type="button"
                className={`side-tab${sideTab === 'chat' ? ' active' : ''}`}
                onClick={() => setSideTab('chat')}
              >
                {t('问答')}
              </button>
              {!coreMode ? (
                <button
                  type="button"
                  className={`side-tab${sideTab === 'feynman' ? ' active' : ''}`}
                  onClick={() => setSideTab('feynman')}
                >
                  {t('自测')}
                </button>
              ) : null}
              <button
                type="button"
                className={`side-tab${sideTab === 'format' ? ' active' : ''}`}
                onClick={() => setSideTab('format')}
              >
                {t('排版')}
              </button>
              <button
                type="button"
                className="side-tab-collapse"
                onClick={() => setSidePanelCollapsed(true)}
                title={t('收起侧栏')}
                aria-label={t('收起侧栏')}
              >
                ›
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
                modelLabel={settings?.notesModel || settings?.model || ''}
                demo={settings?.demo ?? false}
                coreMode={coreMode}
                marks={readerMarks}
                crossBookNotes={crossBookNotes}
                onOpenRelated={openRelatedNote}
                focusNoteId={focusNote?.id ?? null}
                focusKey={focusNote?.key ?? 0}
                expandingNoteId={expandingNoteId}
                onGenerate={requestGenerate}
                onCancel={cancelGeneration}
                onCreate={createNote}
                onUpdate={updateNote}
                onDelete={removeNote}
                onExpand={expandNote}
                onJumpQuote={jumpToQuote}
                onOpenNote={openNote}
                onListen={listenChapter}
                onShare={shareNote}
                onDeleteMark={deleteReaderMark}
                onRevealMark={jumpToQuote}
                compareModels={
                  settings && settings.provider !== 'demo'
                    ? (PROVIDER_PRESETS.find((item) => item.id === settings.provider)?.suggestedModels ?? [])
                    : []
                }
              />
            ) : sideTab === 'chat' ? (
              <ChatPanel
                key={chapter?.id ?? 'no-chapter'}
                chapter={chapter}
                bookTitle={book?.title ?? ''}
                seed={chatSeed}
                onJumpQuote={(quote) => setScrollTarget({ quote, key: Date.now() })}
                onSave={(text) => saveTutorNote(`${t('问答')} · ${chapter?.title ?? ''}`, text)}
              />
            ) : sideTab === 'feynman' ? (
              <FeynmanPanel
                key={chapter?.id ?? 'no-chapter'}
                chapter={chapter}
                bookTitle={book?.title ?? ''}
                hasNotes={notes.some(
                  (note) => note.kind === 'condensed' || note.kind === 'point' || note.kind === 'claim',
                )}
                onSave={(text) => saveTutorNote(`${t('我的理解')} · ${chapter?.title ?? ''}`, text)}
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
                onFormat={(instruction, options) => void formatCurrentChapter(instruction, options)}
                onReset={() => void resetChapterFormat()}
                onStyleChange={updateReaderStyle}
              />
            )}
          </aside>
          )}
        </div>
      ) : (
        <Library
          books={books}
          importing={importing}
          onOpen={(bookId) => void openBook(bookId)}
          onImport={() => setImportOpen(true)}
          onOpenTrash={() => setBookTrashOpen(true)}
          onDelete={(bookId) => void deleteBook(bookId)}
          onRename={startRenameBook}
          onCompose={(bookId) => void openCompose(bookId)}
          onPlan={setPlanBook}
          onShelfStatus={(bookId, status) => {
            // 先乐观更新，点下去立刻看到变化；失败再回滚并提示。
            const previous = books.find((book) => book.id === bookId)?.shelfStatus
            setBooks((current) => current.map((book) => (book.id === bookId ? { ...book, shelfStatus: status } : book)))
            void bridge
              .setBookShelfStatus(bookId, status)
              .then((updated) => {
                setBooks((current) => current.map((book) => (book.id === updated.id ? updated : book)))
              })
              .catch((error) => {
                if (previous) {
                  setBooks((current) =>
                    current.map((book) => (book.id === bookId ? { ...book, shelfStatus: previous } : book)),
                  )
                }
                setToast({ kind: 'error', text: messageOf(error) })
              })
          }}
          onOpenPlan={(bookId, chapterId) => void openBookAt(bookId, chapterId)}
          planVersion={planVersion}
          onMerge={() => setMergeOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onStats={() => setMainView('stats')}
          demo={settings?.demo ?? false}
        />
      )}

      {composeMountedBookId && book && composeMountedBookId === book.id ? (
        <div className={`compose-shell${mainView === 'compose' ? ' is-active' : ''}`}>
          <Suspense fallback={<div className="view-loading-shell"><p className="view-loading">{t('正在加载成书页…')}</p></div>}>
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
              onOpenXhsBook={openBookXhs}
              onSplitBook={() => setSplitOpen(true)}
              compareModels={
                settings && settings.provider !== 'demo'
                  ? (PROVIDER_PRESETS.find((item) => item.id === settings.provider)?.suggestedModels ?? [])
                  : []
              }
            />
          </Suspense>
        </div>
      ) : null}

      {labMounted ? (
        <div className={`lab-shell${mainView === 'lab' ? ' is-active' : ''}`}>
          <Suspense fallback={<div className="view-loading-shell"><p className="view-loading">{t('正在加载工作台…')}</p></div>}>
            <LabView
              key={labTool}
              initialToolId={labTool}
              books={books}
              onBack={() => setMainView('reader')}
              onSaveReport={saveLabReport}
              onListen={(title, text) => setListen({ title, text })}
              demo={settings?.demo ?? false}
            />
          </Suspense>
        </div>
      ) : null}

      {onboardingOpen ? (
        <OnboardingDialog
          hasSample={Boolean(sampleBookId ?? sampleBook)}
          demo={settings?.demo ?? true}
          onImportSample={importSampleBook}
          onOpenSample={() => void openSampleBook()}
          onOpenImport={() => {
            finishOnboarding()
            setImportOpen(true)
          }}
          onOpenSettings={() => {
            finishOnboarding()
            setSettingsOpen(true)
          }}
          onClose={finishOnboarding}
        />
      ) : null}

      <Suspense fallback={null}>
      {settings ? (
        <SettingsDialog
          open={settingsOpen}
          settings={settings}
          appInfo={appInfo}
          theme={appTheme}
          onThemeChange={changeAppTheme}
          onOpenManual={openManual}
          onOpenOnboarding={() => {
            setSettingsOpen(false)
            setOnboardingOpen(true)
          }}
          coreMode={coreMode}
          onToggleCoreMode={setCoreMode}
          onClose={() => setSettingsOpen(false)}
          onSaved={(saved, options) => {
            setSettings(saved)
            if (!options?.silent) {
              setToast({
                kind: 'info',
                text: saved.demo ? t('已切换到演示模式') : `${t('已保存设置')} · ${saved.model}`,
              })
            }
          }}
          onTestResult={(result) => {
            setToast({ kind: result.ok ? 'info' : 'error', text: result.message })
          }}
        />
      ) : null}

      <SearchDialog
        open={searchOpen}
        hasBook={Boolean(book)}
        onClose={() => setSearchOpen(false)}
        onOpen={(result) => void openSearchResult(result)}
        onCommand={runSearchCommand}
      />

      {listen ? (
        <ListenPanel
          title={listen.title}
          text={listen.text}
          scope={listen.scope}
          demo={settings?.demo ?? false}
          onSettingsChanged={setSettings}
          onClose={() => setListen(null)}
        />
      ) : null}

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
              ? t('编辑书籍信息')
              : renameTarget.kind === 'chapter'
                ? t('重命名章节')
                : t('重命名分篇')
          }
          label={renameTarget.kind === 'book' ? t('书名') : renameTarget.kind === 'chapter' ? t('章节名') : t('分篇名')}
          value={renameTarget.value}
          secondaryLabel={renameTarget.kind === 'book' ? t('作者') : undefined}
          secondaryValue={renameTarget.kind === 'book' ? renameTarget.author : undefined}
          onSave={saveRename}
          onClose={() => setRenameTarget(null)}
        />
      ) : null}

      {planBook ? (
        <Suspense fallback={null}>
          <ReadingPlanDialog
            book={planBook}
            onOpenChapter={(chapterId) => {
              const target = planBook
              setPlanBook(null)
              setPlanVersion((value) => value + 1)
              void openBookAt(target.id, chapterId)
            }}
            onClose={() => {
              setPlanBook(null)
              setPlanVersion((value) => value + 1)
            }}
          />
        </Suspense>
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

      {xhsTarget && book ? (
        <Suspense fallback={null}>
          <XhsCarouselDialog
            bookId={book.id}
            bookTitle={book.title}
            author={book.author}
            chapters={chapters}
            chapterId={xhsTarget.chapterId ?? null}
            chapterTitle={xhsTarget.chapterId ? chapterTitles[xhsTarget.chapterId] ?? null : null}
            initialScope={xhsTarget.scope}
            onClose={() => setXhsTarget(null)}
          />
        </Suspense>
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
        onOpenTrash={() => setChapterTrashOpen(true)}
      />

      <GenerationPreflight
        open={Boolean(pendingGenerate)}
        title={chapter?.title ?? ''}
        chars={chapter?.chars ?? 0}
        model={settings?.notesModel || settings?.model || t('未配置模型')}
        provider={
          PROVIDER_PRESETS.find((item) => item.id === settings?.provider)?.label ??
          settings?.provider ??
          ''
        }
        mode={settings?.generationMode ?? 'standard'}
        images={((chapter?.formattedHtml ?? chapter?.html ?? '').match(/<img\b/gi) ?? []).length}
        pricing={settings?.aiPricing[settings?.notesModel || settings?.model || '']}
        onConfirm={(dontAsk) => {
          if (dontAsk) {
            try {
              sessionStorage.setItem(preflightKey, '1')
            } catch {
              // 忽略存储失败。
            }
          }
          const fresh = pendingGenerate?.fresh ?? false
          setPendingGenerate(null)
          void generate(fresh)
        }}
        onCancel={() => setPendingGenerate(null)}
        onOpenSettings={() => {
          setPendingGenerate(null)
          setSettingsOpen(true)
        }}
      />

      <BookTrashDialog
        open={bookTrashOpen}
        onClose={() => setBookTrashOpen(false)}
        onChanged={() => void bridge.listBooks().then(setBooks).catch(() => undefined)}
      />

      <ChapterTrashDialog
        open={chapterTrashOpen}
        onClose={() => setChapterTrashOpen(false)}
        onChanged={() => {
          if (book) void refreshBook(book.id)
          void bridge.listBooks().then(setBooks).catch(() => undefined)
        }}
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
        onOcrStarted={handleOcrStarted}
      />

      </Suspense>

      <DeepParseOverlay
        open={Boolean(deepParse)}
        title={deepParse?.title ?? ''}
        startedAt={deepParse?.startedAt ?? Date.now()}
        progress={deepParse?.progress ?? null}
      />

      <ConfirmHost />
      {locked ? <AppLockScreen onUnlock={unlockApp} /> : null}
    </div>
  )
}
