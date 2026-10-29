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
  Note,
  NoteDraft,
  NotePatch,
  ReaderStyle,
  RelatedNote,
  SearchResult,
  SettingsView,
} from '../shared/types.js'
import { ChapterList } from './components/ChapterList.js'
import { FormatPanel } from './components/FormatPanel.js'
import type { FormatMessage } from './components/FormatPanel.js'
import { Library } from './components/Library.js'
import { NotesPanel } from './components/NotesPanel.js'
import { OrganizeDialog } from './components/OrganizeDialog.js'
import { Reader } from './components/Reader.js'
import { SearchDialog } from './components/SearchDialog.js'
import { SettingsDialog } from './components/SettingsDialog.js'
import { TopBar } from './components/TopBar.js'

function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

const THEME_KEY = 'reading-notes-theme'

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
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [loadingChapter, setLoadingChapter] = useState(false)
  const [importing, setImporting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [partial, setPartial] = useState<GeneratePartial | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [focusNote, setFocusNote] = useState<{ id: string; key: number } | null>(null)
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null)
  const [scrollTarget, setScrollTarget] = useState<{ quote: string; key: number } | null>(null)
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<ChapterSuggestion[]>([])
  const [classifyMode, setClassifyMode] = useState<ClassifyResult['mode'] | null>(null)
  const [classifyError, setClassifyError] = useState<string | null>(null)
  const [classifying, setClassifying] = useState(false)
  const [sideTab, setSideTab] = useState<'notes' | 'format'>('notes')
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
    const confirmed = window.confirm(
      '重新解析会用新的章节切分替换目录。已有笔记会先按原文引用、再按章节标题重新归属；匹配不上的笔记会保留，但不再显示在章节里。继续？',
    )
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

  const importBook = useCallback(async () => {
    setImporting(true)
    try {
      const imported = await window.api.importBook()
      if (!imported) return
      setBooks((current) => [imported, ...current.filter((item) => item.id !== imported.id)])
      const hiddenNote =
        imported.hiddenChapterCount > 0 ? `，自动隐藏了 ${imported.hiddenChapterCount} 个疑似目录/版权页` : ''
      setToast({
        kind: 'info',
        text: `已导入《${imported.title}》，共 ${imported.chapterCount} 节${hiddenNote}`,
      })
      await openBook(imported.id)
    } catch (err) {
      setToast({ kind: 'error', text: messageOf(err) })
    } finally {
      setImporting(false)
    }
  }, [openBook])

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
      if (book) void window.api.listNotes(book.id).then(setAllNotes).catch(() => undefined)
    })
    const offError = window.api.onGenerationError((event) => {
      if (event.chapterId !== chapter?.id) return
      setGenerating(false)
      setPartial(null)
      setError(event.message)
    })
    return () => {
      offPartial()
      offDone()
      offError()
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

  const updateNote = useCallback(
    async (noteId: string, patch: NotePatch) => {
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

  function leaveReader(): void {
    void window.api.cancelGeneration()
    setGenerating(false)
    setPartial(null)
    setBook(null)
    setOrganizeOpen(false)
  }

  return (
    <div className="app">
      <TopBar
        book={book}
        settings={settings}
        importing={importing}
        onLibrary={leaveReader}
        onImport={() => void importBook()}
        onSettings={() => setSettingsOpen(true)}
        onReparse={() => void reparseBook()}
        onSearch={() => setSearchOpen(true)}
      />

      {toast ? (
        <div className={`toast ${toast.kind}`}>
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="关闭提示">
            ×
          </button>
        </div>
      ) : null}

      {book ? (
        <div className="workspace">
          <ChapterList
            chapters={chapters}
            currentId={chapter?.id ?? null}
            noteCounts={noteCounts}
            progress={book.progress}
            onSelect={(meta) => void openChapter(book.id, meta, chapters)}
            onOrganize={openOrganize}
            onDelete={(meta) => void deleteChapterList([meta.id])}
          />
          <Reader
            chapter={chapter}
            loading={loadingChapter}
            style={readerStyle}
            scrollTarget={scrollTarget}
            onQuote={(quote) => void handleQuote(quote)}
            onOpenFormat={() => setSideTab('format')}
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
          onImport={() => void importBook()}
          onDelete={(bookId) => void deleteBook(bookId)}
        />
      )}

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
    </div>
  )
}
