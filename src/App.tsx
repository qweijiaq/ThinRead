import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'

import { useBookshelf, type BookshelfActions } from './hooks/useBookshelf.js'
import { useFormatPanel } from './hooks/useFormatPanel.js'
import { useTasks } from './hooks/useTasks.js'
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
import type {
  AppInfo,
  LabToolId,
  ReaderStyle,
  RelatedNote,
  SettingsView,
} from '../shared/types.js'
import { ConfirmHost, confirmDialog } from './components/ConfirmDialog.js'
import { ChapterList } from './components/ChapterList.js'
import { ChatPanel } from './components/ChatPanel.js'
import { FeynmanPanel } from './components/FeynmanPanel.js'
import { FormatPanel } from './components/FormatPanel.js'
import { ImportDialog } from './components/ImportDialog.js'
import { MergeBooksDialog } from './components/MergeBooksDialog.js'
import { Library } from './components/Library.js'
import { ListenPanel } from './components/ListenPanel.js'
import { MarginNoteDialog } from './components/MarginNoteDialog.js'
import { NotesPanel } from './components/NotesPanel.js'
import { ChapterTrashDialog } from './components/ChapterTrashDialog.js'
import { OrganizeDialog } from './components/OrganizeDialog.js'
import { Reader } from './components/Reader.js'
import { RenameDialog } from './components/RenameDialog.js'
import { SearchDialog } from './components/SearchDialog.js'
import { ShareDialog } from './components/ShareDialog.js'
import { SettingsDialog } from './components/SettingsDialog.js'
import { OnboardingDialog, SAMPLE_BOOK } from './components/OnboardingDialog.js'
import { ManualView } from './components/ManualView.js'
import { SplitBookDialog } from './components/SplitBookDialog.js'
import { TaskCenter } from './components/TaskCenter.js'
import { TopBar } from './components/TopBar.js'
import { messageOf } from './lib/errors.js'
import { isoWeekLabel } from './lib/week.js'

const BookCompose = lazy(async () => ({ default: (await import('./components/BookCompose.js')).BookCompose }))
const ContentView = lazy(async () => ({ default: (await import('./components/ContentView.js')).ContentView }))
const KnowledgeMap = lazy(async () => ({ default: (await import('./components/KnowledgeMap.js')).KnowledgeMap }))
const LabView = lazy(async () => ({ default: (await import('./components/LabView.js')).LabView }))
const NotesLibrary = lazy(async () => ({ default: (await import('./components/NotesLibrary.js')).NotesLibrary }))
const StatsView = lazy(async () => ({ default: (await import('./components/StatsView.js')).StatsView }))
const WeeklyReviewsView = lazy(async () => ({ default: (await import('./components/WeeklyReviewsView.js')).WeeklyReviewsView }))
const XhsCarouselDialog = lazy(async () => ({ default: (await import('./components/XhsCarouselDialog.js')).XhsCarouselDialog }))

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
  const { notes, allNotes, setNotes, setAllNotes, refreshNotes, resetNotes, patchNote } = useNoteStore()
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [booksLoaded, setBooksLoaded] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [sampleBookId, setSampleBookId] = useState<string | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
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
  const handleBooksChanged = useCallback(() => {
    void window.api
      .listBooks()
      .then(setBooks)
      .catch(() => undefined)
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
    const imported = await window.api.importText(SAMPLE_BOOK)
    setBooks((current) => [imported, ...current.filter((item) => item.id !== imported.id)])
    setSampleBookId(imported.id)
  }, [setBooks])

  const { tasks: backgroundTasks, setTasks: setBackgroundTasks } = useTasks({
    notify: setToast,
    onBooksChanged: handleBooksChanged,
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
    contentFocusId,
    setContentFocusId,
    leaveReader,
    openLab,
    openCompose,
  } = useViews({ bookId: book?.id ?? null, openBook, clearBook, resetGeneration, resetOrganize })
  const [manualReturn, setManualReturn] = useState<MainView>('reader')
  const openSampleBook = useCallback(async () => {
    if (!sampleBookId) return
    await openBook(sampleBookId)
    setMainView('reader')
    finishOnboarding()
  }, [finishOnboarding, openBook, sampleBookId, setMainView])
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

  useEffect(() => window.api.onSemanticReady(() => setSemanticTick((value) => value + 1)), [])

  useEffect(() => {
    if (mainView !== 'reader' || !book) setReaderFocus(false)
  }, [book, mainView])

  const toggleReaderFocus = useCallback(() => setReaderFocus((value) => !value), [])

  useEffect(() => {
    void Promise.all([window.api.listBooks(), window.api.getSettings(), window.api.getAppInfo()])
      .then(([nextBooks, nextSettings, info]) => {
        setBooks(nextBooks)
        setSettings(nextSettings)
        setAppInfo(info)
        setBooksLoaded(true)
      })
      .catch((err: unknown) => setToast({ kind: 'error', text: messageOf(err) }))
      .finally(() => setBooksLoaded(true))
  }, [])

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
    const confirmed = await confirmDialog({
      title: t('重新解析目录'),
      message:
        t('重新解析会用新的章节切分替换目录。已有笔记会先按原文引用、再按章节标题重新归属；匹配不上的笔记会保留，但不再显示在章节里。继续？'),
      confirmLabel: t('继续解析'),
      danger: true,
    })
    if (!confirmed) return
    try {
      const updated = await window.api.reparseBook(book.id)
      setBooks((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      await openBook(updated.id)
      setToast({ kind: 'info', text: t('已重新解析目录，笔记已尽量保留。') })
    } catch (err) {
      setToast({ kind: 'error', text: messageOf(err) })
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
                    detail: t('正在重试失败章节'),
                    done: 0,
                    total: retry.chapterIds.length,
                    failures: [],
                    retry: undefined,
                  }
                : item,
            ),
          )
          const resume = task.status === 'paused'
          const run =
            retry.kind === 'notes'
              ? window.api.generateBookNotes(retry.bookId, { onlyMissing: resume, chapterIds: retry.chapterIds })
              : window.api.formatBook(retry.bookId, { onlyMissing: resume, chapterIds: retry.chapterIds })
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
          if (task.kind === 'notes') void window.api.cancelGeneration()
          else if (task.kind === 'format') void window.api.cancelFormat()
          else void window.api.cancelOcrImport()
        }}
        onDismiss={(id) => setBackgroundTasks((current) => current.filter((task) => task.id !== id))}
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
          <WeeklyReviewsView books={books} onBack={() => setMainView('stats')} />
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
              const ownerId = book?.id ?? books[0]?.id
              if (!ownerId) throw new Error(t('还没有导入书。'))
              const title = `${t('每周复盘')} · ${isoWeekLabel()}`
              const existing = (await window.api.listNotes(ownerId)).find((note) => note.title === title)
              if (existing) {
                await window.api.updateNote(existing.id, { title, content: markdown })
              } else {
                await window.api.createNote({
                  bookId: ownerId,
                  chapterId: null,
                  kind: 'summary',
                  title,
                  content: markdown,
                })
              }
              if (book?.id === ownerId) await refreshNotes(ownerId, chapter?.id ?? null)
              setToast({ kind: 'info', text: t('已存为笔记。') })
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
      ) : mainView === 'compose' && book ? (
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
          />
        </Suspense>
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
            bookmarks={bookmarks}
            onOpenBookmark={(bookmark) => void openBookmark(bookmark)}
            onDeleteBookmark={(id) => void deleteReaderBookmark(id)}
          />
          <Reader
            chapter={chapter}
            loading={loadingChapter}
            style={readerStyle}
            bookTitle={book?.title ?? ''}
            scrollTarget={scrollTarget}
            echoes={crossBookNotes}
            excerpt={echoExcerpt}
            marks={readerMarks}
            onCreateMark={(style, text) => void createReaderMark(style, text)}
            onClearMarks={(ids) => void clearReaderMarks(ids)}
            onOpenFormat={() => setSideTab('format')}
            onOpenEcho={(echo) => void openRelatedNote(echo)}
            onListen={() => {
              if (chapter) setListen({ title: chapter.title, text: chapter.text })
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
          />
          <aside className="side-panel">
            <div className="side-tabs">
              <button
                type="button"
                className={`side-tab${sideTab === 'notes' ? ' active' : ''}`}
                onClick={() => setSideTab('notes')}
              >
                {t('笔记')}
              </button>
              <button
                type="button"
                className={`side-tab${sideTab === 'chat' ? ' active' : ''}`}
                onClick={() => setSideTab('chat')}
              >
                {t('问答')}
              </button>
              <button
                type="button"
                className={`side-tab${sideTab === 'feynman' ? ' active' : ''}`}
                onClick={() => setSideTab('feynman')}
              >
                {t('自测')}
              </button>
              <button
                type="button"
                className={`side-tab${sideTab === 'format' ? ' active' : ''}`}
                onClick={() => setSideTab('format')}
              >
                {t('排版')}
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
                marks={readerMarks}
                crossBookNotes={crossBookNotes}
                onOpenRelated={openRelatedNote}
                focusNoteId={focusNote?.id ?? null}
                focusKey={focusNote?.key ?? 0}
                expandingNoteId={expandingNoteId}
                onGenerate={generate}
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
          onSettings={() => setSettingsOpen(true)}
          onStats={() => setMainView('stats')}
          demo={settings?.demo ?? false}
        />
      )}

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
            />
          </Suspense>
        </div>
      ) : null}

      {onboardingOpen ? (
        <OnboardingDialog
          hasSample={Boolean(sampleBookId)}
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
          onClose={() => setSettingsOpen(false)}
          onSaved={(saved) => {
            setSettings(saved)
            setToast({ kind: 'info', text: saved.demo ? t('已切换到演示模式') : `${t('已切换到')} ${saved.model}` })
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

      <ChapterTrashDialog
        open={chapterTrashOpen}
        onClose={() => setChapterTrashOpen(false)}
        onChanged={() => {
          if (book) void refreshBook(book.id)
          void window.api.listBooks().then(setBooks).catch(() => undefined)
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

      <ConfirmHost />
    </div>
  )
}
