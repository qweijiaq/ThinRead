import { bridge } from '../lib/bridge.js'
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'

import { countUnit, t, useLocale } from '../lib/i18n.js'
import type {
  AiJobSnapshot,
  BookComposeOptions,
  BookComposeProgress,
  BookComposeResult,
  BookFormatDoneEvent,
  BookFormatProgress,
  BookGenerationDoneEvent,
  BookGenre,
  BookSummary,
  ChapterMeta,
  LabArtifact,
  Note,
} from '../../shared/types.js'
import { onContentCurrent } from '../lib/content-events.js'
import { confirmDialog, confirmOptionDialog } from './ConfirmDialog.js'
import { CompareModelDialog } from './CompareModelDialog.js'
import { PublishDialog } from './PublishDialog.js'
import { Select } from './Select.js'
import { TextDiffDialog } from './TextDiffDialog.js'
import { contentToMarkdown } from '../lib/content-view.js'
import { EMPTY_GENERATION, parseComposeArtifact, versionLabel, type GenerationView } from '../lib/book-compose.js'
import { todayStamp } from '../lib/export.js'
import { BOOK_GENRE_OPTIONS, bookGenreLabel } from '../lib/genres.js'
import { Markdown } from './Markdown.js'

interface BookComposeProps {
  book: BookSummary
  chapters: ChapterMeta[]
  onBack(): void
  onOpenChapter(chapterId: string): void
  onShareBook(): void
  onOpenXhsBook(): void
  onSplitBook(): void
  compareModels?: string[]
}

export function BookCompose({
  book,
  chapters,
  onBack,
  onOpenChapter,
  onShareBook,
  onOpenXhsBook,
  onSplitBook,
  compareModels = [],
}: BookComposeProps): JSX.Element {
  useLocale()
  const visible = useMemo(() => chapters.filter((chapter) => !chapter.hidden), [chapters])

  const [notes, setNotes] = useState<Note[]>([])
  const [loadingNotes, setLoadingNotes] = useState(true)
  const [notesTick, setNotesTick] = useState(0)
  const [composeTick, setComposeTick] = useState(0)
  const [generation, setGeneration] = useState<GenerationView>(EMPTY_GENERATION)
  const [generationResult, setGenerationResult] = useState<BookGenerationDoneEvent | null>(null)
  const [formatting, setFormatting] = useState(false)
  const [formatProgress, setFormatProgress] = useState<BookFormatProgress | null>(null)
  const [formatResult, setFormatResult] = useState<BookFormatDoneEvent | null>(null)
  const [composeOptions, setComposeOptions] = useState<BookComposeOptions>({ length: 'tight', voice: 'calm' })
  const [genre, setGenre] = useState<BookGenre>(book.genre ?? 'auto')
  const [composing, setComposing] = useState(false)
  const [composeProgress, setComposeProgress] = useState<BookComposeProgress | null>(null)
  const [result, setResult] = useState<BookComposeResult | null>(null)
  const [article, setArticle] = useState('')
  const [selection, setSelection] = useState({ start: 0, end: 0, text: '' })
  const [sectionRewrite, setSectionRewrite] = useState<{
    start: number
    end: number
    before: string
    after: string
  } | null>(null)
  const [rewriting, setRewriting] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareBusy, setCompareBusy] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [compareDiff, setCompareDiff] = useState<{ before: string; after: string } | null>(null)
  const [history, setHistory] = useState<LabArtifact[]>([])
  const [selectedVersion, setSelectedVersion] = useState('')
  const latestVersionId = history[0]?.id ?? ''
  const selectedIsHistorical = Boolean(selectedVersion && latestVersionId && selectedVersion !== latestVersionId)
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [busyAction, setBusyAction] = useState<'copy' | 'markdown' | 'html' | 'pdf' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [chaptersCollapsed, setChaptersCollapsed] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const autoComposeRef = useRef(false)
  const composeOptionsRef = useRef(composeOptions)

  useEffect(() => {
    composeOptionsRef.current = composeOptions
  }, [composeOptions])

  useEffect(() => {
    setSelection({ start: 0, end: 0, text: '' })
  }, [editing])

  useEffect(() => {
    setGenre(book.genre ?? 'auto')
  }, [book.genre, book.id])

  const condensedByChapter = useMemo(() => {
    const map = new Map<string, Note>()
    for (const note of notes) {
      if (note.kind === 'condensed' && note.chapterId && note.content.trim()) map.set(note.chapterId, note)
    }
    return map
  }, [notes])

  const cardsByChapter = useMemo(() => {
    const map = new Map<string, Note[]>()
    for (const note of notes) {
      if ((note.kind === 'point' || note.kind === 'claim') && note.chapterId) {
        const list = map.get(note.chapterId) ?? []
        list.push(note)
        map.set(note.chapterId, list)
      }
    }
    return map
  }, [notes])

  const missing = visible.filter((chapter) => !condensedByChapter.has(chapter.id)).length
  const generatedChapters = visible.length - missing
  const totalCards = notes.filter((note) => note.kind === 'point' || note.kind === 'claim').length
  const sourceChars = [...condensedByChapter.values()].reduce((sum, note) => sum + note.content.length, 0)
  const pendingChapters = visible.filter((chapter) => !condensedByChapter.has(chapter.id))
  const pendingChars = pendingChapters.reduce((sum, chapter) => sum + chapter.chars, 0)
  const mergeBatches = Math.max(1, Math.ceil(sourceChars / 7000) + 1)

  useEffect(() => {
    let cancelled = false
    setLoadingNotes(true)
    void bridge
      .listNotes(book.id)
      .then((items) => {
        if (!cancelled) setNotes(items)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoadingNotes(false)
      })
    return () => {
      cancelled = true
    }
  }, [book.id, notesTick])

  const loadCompose = useCallback(async (): Promise<void> => {
    const scope = `book:${book.id}`
    try {
      const [latest, versions] = await Promise.all([
        bridge.getLabArtifact('book-compose', scope),
        bridge.listLabArtifacts('book-compose', 40),
      ])
      const scoped = versions.filter((artifact) => artifact.scope === scope)
      setHistory(scoped)
      const parsed = parseComposeArtifact(latest)
      setResult(parsed)
      setArticle(parsed?.markdown ?? '')
      setSelectedVersion(latest?.id ?? scoped[0]?.id ?? '')
      setDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [book.id])

  useEffect(() => {
    void loadCompose()
  }, [loadCompose, composeTick])

  // 成书合并任务保存在主进程：切走再回来时重新接上进度或结果。
  useEffect(() => {
    let cancelled = false
    const apply = (job: AiJobSnapshot | null, announce: boolean): void => {
      if (!job) return
      if (job.status === 'running') {
        setComposing(true)
        setComposeProgress(
          job.composeProgress ?? {
            stage: 'rewrite',
            done: job.done,
            total: job.total,
            message: job.detail,
          },
        )
        return
      }
      setComposing(false)
      setComposeProgress(null)
      if (job.status === 'done') {
        if (announce) {
          setNotice(t('整本成稿已生成并保存。'))
          void loadCompose()
        }
        return
      }
      if (job.status === 'error' && job.error && Date.now() - Date.parse(job.updatedAt) < 10 * 60 * 1000) {
        setError(job.error)
      }
    }
    void bridge
      .getBookAiJobs(book.id)
      .then((jobs) => {
        if (!cancelled) apply(jobs.compose, false)
      })
      .catch(() => undefined)
    const off = bridge.onAiJobUpdate((job) => {
      if (job.kind !== 'compose' || job.bookId !== book.id) return
      apply(job, true)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [book.id, loadCompose])

  // 整本生成/排版也可能在切走期间继续跑，回来后恢复进度卡片。
  useEffect(() => {
    let cancelled = false
    void bridge
      .listBackgroundTasks()
      .then((records) => {
        if (cancelled) return
        const running = records.filter((record) => record.bookId === book.id && record.status === 'running')
        const notesTask = running.find((record) => record.kind === 'notes')
        if (notesTask) {
          setGeneration({
            running: true,
            done: notesTask.done,
            total: notesTask.total,
            title: '',
            status: null,
            message: t('正在继续整本生成'),
          })
        }
        const formatTask = running.find((record) => record.kind === 'format')
        if (formatTask) {
          setFormatting(true)
          setFormatProgress({
            bookId: book.id,
            chapterId: '',
            title: '',
            index: formatTask.done,
            total: formatTask.total,
            status: 'start',
            done: formatTask.done,
            message: t('正在继续整本排版'),
          })
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [book.id])

  useEffect(
    () =>
      onContentCurrent((detail) => {
        if (detail.tool === 'book-compose' && detail.scope === `book:${book.id}`) setComposeTick((value) => value + 1)
      }),
    [book.id],
  )

  useEffect(() => {
    const offPartial = bridge.onGenerationPartial((event) => {
      const phase = event.partial.progress?.phase
      const label =
        phase === 'condense'
          ? t('正在把这一章读薄')
          : phase === 'cards'
            ? t('正在提炼核心卡片')
            : phase === 'expand'
              ? t('正在做有限延伸')
              : t('AI 正在读这一章')
      setGeneration((current) => (current.running ? { ...current, message: label } : current))
    })
    const offProgress = bridge.onBookGenerationProgress((event) => {
      if (event.bookId !== book.id) return
      setGeneration({
        running: true,
        done: event.done,
        total: event.total,
        title: event.title,
        status: event.status,
        message: event.message ?? '',
      })
      if (event.status === 'done' || event.status === 'skipped') setNotesTick((value) => value + 1)
    })
    const offDone = bridge.onBookGenerationDone((event) => {
      if (event.bookId !== book.id) return
      setGeneration((current) => ({ ...current, running: false }))
      setGenerationResult(event)
      setNotesTick((value) => value + 1)
      if (autoComposeRef.current) {
        autoComposeRef.current = false
        if (!event.cancelled && event.failed.length === 0) {
          window.setTimeout(() => void compose(true), 350)
        }
      }
    })
    const offCompose = bridge.onBookComposeProgress((event) => {
      setComposeProgress(event)
    })
    return () => {
      offPartial()
      offProgress()
      offDone()
      offCompose()
    }
  }, [book.id])

  async function formatBook(): Promise<void> {
    const result = await confirmOptionDialog({
      title: t('整本 AI 排版'),
      message: t('会逐章用 AI 整理正文、清理广告和乱码，并覆盖已有 AI 排版结果；原文仍可随时还原。继续？'),
      confirmLabel: t('开始排版'),
      danger: false,
      checkboxLabel: t('忽略参考文献 / 注释 / 索引'),
      checkboxDefault: false,
    })
    if (!result.confirmed) return
    setError(null)
    setFormatResult(null)
    setFormatting(true)
    setFormatProgress({
      bookId: book.id,
      chapterId: '',
      title: '',
      index: 0,
      total: 0,
      status: 'start',
      done: 0,
      message: t('正在准备排版'),
    })
    try {
      await bridge.formatBook(book.id, { skipReferences: result.checked })
    } catch (err) {
      setFormatting(false)
      setFormatProgress(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function cancelFormat(): Promise<void> {
    await bridge.cancelFormat({ bookId: book.id })
    setFormatting(false)
    setFormatProgress(null)
  }

  async function changeGenre(next: BookGenre): Promise<void> {
    const previous = genre
    setGenre(next)
    try {
      await bridge.setBookGenre(book.id, next)
      setNotice(`${t('书籍类型已改为')}「${t(bookGenreLabel(next))}」${t('，之后生成的笔记、成稿和关系图会使用它。')}`)
    } catch (err) {
      setGenre(previous)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function generateBook(
    onlyMissing: boolean,
    options?: { skipConfirm?: boolean },
  ): Promise<boolean> {
    const count = onlyMissing ? missing : visible.length
    if (!options?.skipConfirm) {
      const message = onlyMissing
        ? `${t('本次会为')} ${count} ${t('节生成读薄稿，预计')} ${count} ${t('次章节请求。读薄、回查、卡片和延伸都会消耗 token，长书可能持续十几分钟；建议先跑一章确认质量。')}`
        : `${t('本次会为')} ${count} ${t('节重新生成读薄稿，预计')} ${count} ${t('次章节请求，并替换所有未人工修改的 AI 笔记。读薄、回查、卡片和延伸都会消耗 token，长书可能持续十几分钟；建议先跑一章确认质量。')}`
      const confirmed = await confirmDialog({
        title: onlyMissing ? t('生成未完成章节') : t('整本重新生成'),
        message,
        confirmLabel: t('继续生成'),
        danger: !onlyMissing,
      })
      if (!confirmed) return false
    }
    setError(null)
    setGenerationResult(null)
    setGeneration({
      running: true,
      done: 0,
      total: onlyMissing ? missing : visible.length,
      title: '',
      status: null,
      message: onlyMissing ? t('正在准备生成未完成的章节') : t('正在准备重新生成整本书'),
    })
    try {
      await bridge.generateBookNotes(book.id, { onlyMissing })
    } catch (err) {
      autoComposeRef.current = false
      setGeneration((current) => ({ ...current, running: false }))
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
    return true
  }

  async function cancelGeneration(): Promise<void> {
    autoComposeRef.current = false
    await bridge.cancelGeneration({ bookId: book.id })
    setGeneration((current) => ({ ...current, running: false }))
  }

  async function compose(force = false): Promise<void> {
    if (composing || (!force && generatedChapters === 0)) return
    setComposing(true)
    setError(null)
    setNotice(null)
    setComposeProgress({
      stage: 'collect',
      done: 0,
      total: 0,
      message: t('正在收齐读薄稿'),
    })
    try {
      const next = await bridge.composeBook(book.id, composeOptionsRef.current)
      setResult(next)
      setArticle(next.markdown)
      setDirty(false)
      setNotice(t('整本成稿已生成并保存。'))
      await loadCompose()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('取消') || message.toLowerCase().includes('cancel')) setNotice(t('已取消合并。'))
      else setError(message)
    } finally {
      setComposing(false)
      setComposeProgress(null)
    }
  }

  async function cancelCompose(): Promise<void> {
    await bridge.cancelBookCompose({ bookId: book.id })
    setComposing(false)
    setComposeProgress(null)
  }

  async function selectVersion(id: string): Promise<void> {
    setSelectedVersion(id)
    const artifact = history.find((item) => item.id === id)
    if (!artifact) return
    const parsed = parseComposeArtifact(artifact)
    setResult(parsed)
    setArticle(parsed?.markdown ?? '')
    setEditing(false)
    setDirty(false)
  }

  async function saveArticle(): Promise<void> {
    if (!result) return
    setBusyAction('save')
    setError(null)
    try {
      const next = { ...result, markdown: article, outputChars: article.length }
      await bridge.saveLabArtifact({
        tool: 'book-compose',
        scope: `book:${book.id}`,
        title: next.title,
        content: JSON.stringify(next),
      })
      setResult(next)
      setDirty(false)
      setNotice(t('修改已保存为新版本。'))
      await loadCompose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  async function rewriteSelection(): Promise<void> {
    const text = selection.text.trim()
    if (text.length < 20) {
      setNotice(t('先选中一段文字再重写。'))
      return
    }
    setRewriting(true)
    setError(null)
    setNotice(null)
    try {
      const rewritten = await bridge.rewriteComposeSection({
        bookId: book.id,
        fullText: article,
        start: selection.start,
        end: selection.end,
      })
      if (rewritten.demo && rewritten.text.trim() === selection.text.trim()) {
        setNotice(t('演示模式只预览流程，不会真正改写。'))
        return
      }
      setSectionRewrite({
        start: selection.start,
        end: selection.end,
        before: article.slice(selection.start, selection.end),
        after: rewritten.text,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRewriting(false)
    }
  }

  function applySectionRewrite(): void {
    if (!sectionRewrite) return
    const next = `${article.slice(0, sectionRewrite.start)}${sectionRewrite.after}${article.slice(sectionRewrite.end)}`
    setArticle(next)
    setDirty(true)
    setSectionRewrite(null)
    setSelection({ start: 0, end: 0, text: '' })
    setNotice(t('已应用按段改写；保存后会成为新版本。'))
  }

  async function compareWithModel(model: string): Promise<void> {
    setCompareBusy(true)
    setCompareError(null)
    try {
      const result = await bridge.compareBookCompose({
        bookId: book.id,
        model,
        options: composeOptions,
      })
      setCompareOpen(false)
      setCompareDiff({
        before: contentToMarkdown(result.base),
        after: contentToMarkdown(result.compare),
      })
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : String(err))
    } finally {
      setCompareBusy(false)
    }
  }

  async function restoreSelectedVersion(): Promise<void> {
    if (!result || !selectedIsHistorical) return
    setBusyAction('save')
    setError(null)
    try {
      const next = { ...result, markdown: article, outputChars: article.length }
      await bridge.saveLabArtifact({
        tool: 'book-compose',
        scope: `book:${book.id}`,
        title: next.title,
        content: JSON.stringify(next),
      })
      setNotice(t('已恢复为当前版本。'))
      await loadCompose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  async function copyArticle(): Promise<void> {
    if (!article.trim()) return
    setBusyAction('copy')
    setError(null)
    try {
      await bridge.copyText(article)
      setNotice(t('整本笔记已复制，可以直接贴到博客编辑器。'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  async function exportMarkdown(): Promise<void> {
    if (!article.trim()) return
    setBusyAction('markdown')
    setError(null)
    try {
      const name = `${book.title} 整本读书笔记.md`.replace(/[\\/:*?"<>|#%{}]/g, ' ').replace(/\s+/g, ' ').trim()
      const saved = await bridge.saveMarkdown(name, article)
      if (saved.saved) setNotice(`${t('已导出到')} ${saved.path}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  async function buildShareHtml(): Promise<string> {
    const { bookDescription, buildBookBlogHtml } = await import('../lib/blog-export.js')
    const { renderPublishCover } = await import('../lib/publish-cover.js')
    const date = todayStamp()
    return buildBookBlogHtml({
      bookTitle: book.title,
      author: book.author,
      markdown: article,
      date,
      coverSrc: renderPublishCover({
        title: result?.title || book.title,
        author: book.author,
        date,
        description: bookDescription(article, 140),
      }),
    })
  }

  async function exportHtml(): Promise<void> {
    if (!article.trim()) return
    setBusyAction('html')
    setError(null)
    try {
      const { bookHtmlFilename } = await import('../lib/blog-export.js')
      const html = await buildShareHtml()
      const saved = await bridge.saveHtml(bookHtmlFilename(book.title), html)
      if (saved.saved) setNotice(`${t('分享页已导出到')} ${saved.path}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  async function exportPdf(): Promise<void> {
    if (!article.trim()) return
    setBusyAction('pdf')
    setError(null)
    try {
      const { bookPdfFilename } = await import('../lib/blog-export.js')
      const html = await buildShareHtml()
      const saved = await bridge.savePdf(bookPdfFilename(book.title), html)
      if (saved.saved) setNotice(`${t('排版 PDF 已导出到')} ${saved.path}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  async function oneClick(): Promise<void> {
    if (composing || generation.running || loadingNotes) return
    if (missing > 0) {
      const confirmed = await confirmDialog({
        title: t('一键成稿'),
        message: `${t('本次会先补')} ${missing} ${t('节读薄稿，然后自动合并全文；章节生成和合并都会消耗 token，长书可能持续十几分钟。建议先跑一章确认质量。')}`,
        confirmLabel: t('继续生成'),
      })
      if (!confirmed) return
      autoComposeRef.current = true
      setNotice(`${t('正在先补')} ${missing} ${t('节读薄稿，完成后会自动合并全文。')}`)
      void generateBook(true, { skipConfirm: true })
      return
    }
    void compose()
  }

  const progressPercent = generation.total > 0 ? Math.round((generation.done / generation.total) * 100) : 0

  return (
    <main className="compose-view">
      <div className="compose-head">
        <div>
          <button type="button" className="text-button muted" onClick={onBack}>
            {t('← 回到阅读')}
          </button>
          <h1>{book.title}</h1>
          <p>
            {t(bookGenreLabel(genre))} · {visible.length} {countUnit(visible.length, t('节'), t('节一'))} · {t('已生成')} {generatedChapters} {countUnit(generatedChapters, t('节'), t('节一'))} · {totalCards} {countUnit(totalCards, t('张卡片'), t('张卡片一'))}
            {sourceChars > 0 ? ` · ${t('读薄稿')} ${sourceChars.toLocaleString()} ${t('字')}` : ''}
          </p>
        </div>
        <div className="compose-head-actions">
          <button
            type="button"
            className="ghost-button small"
            onClick={() => setChaptersCollapsed((value) => !value)}
            aria-pressed={chaptersCollapsed}
          >
            {chaptersCollapsed ? t('展开章节') : t('收起章节')}
          </button>
          <button type="button" className="ghost-button small" onClick={onSplitBook}>
            {t('拆分本书')}
          </button>
          <button type="button" className="ghost-button small" onClick={onShareBook}>
            {t('分享这本书')}
          </button>
          <button type="button" className="ghost-button small" onClick={onOpenXhsBook}>
            {t('小红书图文')}
          </button>
        </div>
      </div>

      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      {notice ? <div className="inline-notice" role="status" aria-live="polite">{notice}</div> : null}

      <div className={`compose-grid${chaptersCollapsed ? ' is-chapters-collapsed' : ''}`}>
        <section className="compose-chapters">
          <div className="compose-section-head">
            <div>
              <h2>{t('整本生成')}</h2>
              <p>{t('逐章读薄，保留人工修改；已有读薄稿的章节默认跳过。')}</p>
            </div>
            <span className="compose-stat">{generatedChapters}/{visible.length}</span>
          </div>

          <div className="compose-generate-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => void generateBook(true)}
              disabled={generation.running || loadingNotes || missing === 0}
            >
              {generation.running ? t('生成中…') : missing > 0 ? `${t('生成未完成章节')} · ${missing}` : t('全部章节已生成')}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void generateBook(false)}
              disabled={generation.running || visible.length === 0}
            >
              {t('整本重新生成')}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void formatBook()}
              disabled={formatting || generation.running || visible.length === 0}
            >
              {formatting ? t('整本排版中…') : t('整本 AI 排版')}
            </button>
          </div>

          {generation.running || generation.status ? (
            <div className="compose-progress-card">
              <div className="compose-progress-head">
                <span>
                  {generation.running ? t('正在生成') : t('上次生成')}
                  {generation.total > 0 ? ` · ${generation.done}/${generation.total}` : ''}
                </span>
                {generation.running ? (
                  <button type="button" className="text-button muted" onClick={() => void cancelGeneration()}>
                    {t('取消')}
                  </button>
                ) : null}
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <p className="compose-progress-line">
                {generation.title ? `${generation.title}${generation.message ? ` · ${generation.message}` : ''}` : generation.message}
              </p>
              {generationResult && !generationResult.cancelled ? (
                <p className="compose-progress-line">
                  {t('新生成')} {generationResult.generated} {t('节')}
                  {generationResult.existing > 0 ? `${t('，已有读薄稿')} ${generationResult.existing} ${t('节')}` : ''}
                  {generationResult.skipped > 0 ? `${t('，跳过')} ${generationResult.skipped} ${t('节')}` : ''}
                  {generationResult.failed.length > 0 ? `${t('，失败')} ${generationResult.failed.length} ${t('节')}` : ''}
                </p>
              ) : null}
              {generationResult?.failed.length ? (
                <details className="compose-failures">
                  <summary>{t('查看失败章节')}</summary>
                  <ul>
                    {generationResult.failed.map((item) => (
                      <li key={item.chapterId}>
                        <strong>{item.title}</strong>
                        <span>{item.message}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}

          {formatting || formatProgress || formatResult ? (
            <div className="compose-progress-card">
              <div className="compose-progress-head">
                <span>
                  {t('整本 AI 排版')}
                  {formatProgress && formatProgress.total > 0 ? ` · ${formatProgress.done}/${formatProgress.total}` : ''}
                </span>
                {formatting ? (
                  <button type="button" className="text-button muted" onClick={() => void cancelFormat()}>
                    {t('取消')}
                  </button>
                ) : null}
              </div>
              {formatProgress && formatProgress.total > 0 ? (
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.round((formatProgress.done / formatProgress.total) * 100)}%` }}
                  />
                </div>
              ) : null}
              <p className="compose-progress-line">
                {formatProgress?.title
                  ? `${formatProgress.title}${formatProgress.message ? ` · ${formatProgress.message}` : ''}`
                  : formatProgress?.message || t('正在排版章节')}
              </p>
              {formatResult && !formatResult.cancelled ? (
                <p className="compose-progress-line">
                  {t('完成')} {formatResult.formatted} {t('节，跳过')} {formatResult.skipped} {t('节')}
                  {formatResult.failed.length > 0 ? `${t('，失败')} ${formatResult.failed.length} ${t('节')}` : ''}
                </p>
              ) : null}
              {formatResult?.failed.length ? (
                <details className="compose-failures">
                  <summary>{t('查看排版失败章节')}</summary>
                  <ul>
                    {formatResult.failed.map((item) => (
                      <li key={item.chapterId}>
                        <strong>{item.title}</strong>
                        <span>{item.message}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}

          <div className="compose-chapter-list">
            {loadingNotes ? <p className="muted">{t('正在读取笔记…')}</p> : null}
            {visible.map((chapter, index) => {
              const condensed = condensedByChapter.get(chapter.id)
              const cards = cardsByChapter.get(chapter.id)?.length ?? 0
              return (
                <button
                  key={chapter.id}
                  type="button"
                  className={`compose-chapter-row${condensed ? ' is-ready' : ''}`}
                  onClick={() => onOpenChapter(chapter.id)}
                  title={condensed ? t('打开这一章') : t('打开这一章并生成笔记')}
                >
                  <span className="compose-chapter-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="compose-chapter-main">
                    <span className="compose-chapter-title">{chapter.isPart ? `${chapter.title}${t('（篇首页）')}` : chapter.title}</span>
                    <span className="compose-chapter-meta">
                      {chapter.partTitle && !chapter.isPart ? `${chapter.partTitle} · ` : ''}
                      {chapter.chars.toLocaleString()} {t('字')}
                      {cards > 0 ? ` · ${cards} ${countUnit(cards, t('张卡片'), t('张卡片一'))}` : ''}
                      {condensed ? ` · ${t('读薄稿')} ${condensed.content.length.toLocaleString()} ${t('字')}` : ''}
                    </span>
                  </span>
                  <span className={`compose-chapter-state${condensed ? ' ready' : ''}`}>
                    {condensed ? t('已读薄') : t('待生成')}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="compose-article">
          <div className="compose-section-head">
            <div>
              <h2>{t('整本成稿')}</h2>
              <p>{t('把所有读薄稿合成一篇完整文章，统一语气、补过渡、去掉 AI 味。')}</p>
            </div>
            {history.length > 1 ? (
              <Select
                className="compose-history"
                value={selectedVersion}
                onChange={(value) => void selectVersion(value)}
                ariaLabel={t('成稿历史')}
                options={history.map((artifact) => ({ value: artifact.id, label: versionLabel(artifact) }))}
              />
            ) : null}
          </div>

          <div className="compose-options">
            <label>
              {t('书籍类型')}
              <Select
                value={genre}
                onChange={(value) => void changeGenre(value as BookGenre)}
                disabled={composing}
                ariaLabel={t('书籍类型')}
                options={BOOK_GENRE_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
              />
            </label>
            <label>
              {t('篇幅')}
              <Select
                value={composeOptions.length}
                onChange={(value) =>
                  setComposeOptions((current) => ({ ...current, length: value as BookComposeOptions['length'] }))
                }
                disabled={composing}
                ariaLabel={t('篇幅')}
                options={[
                  { value: 'tight', label: t('精炼版') },
                  { value: 'full', label: t('完整版') },
                ]}
              />
            </label>
            <label>
              {t('语气')}
              <Select
                value={composeOptions.voice}
                onChange={(value) =>
                  setComposeOptions((current) => ({ ...current, voice: value as BookComposeOptions['voice'] }))
                }
                disabled={composing}
                ariaLabel={t('语气')}
                options={[
                  { value: 'calm', label: t('克制准确') },
                  { value: 'personal', label: t('读者视角') },
                  { value: 'sharp', label: t('有判断') },
                ]}
              />
            </label>
            <button
              type="button"
              className="primary-button"
              onClick={() => void compose()}
              disabled={composing || generatedChapters === 0 || generation.running}
            >
              {composing ? t('正在合并…') : result ? t('重新合并全文') : t('合并整本书')}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void oneClick()}
              disabled={composing || generation.running || loadingNotes || generatedChapters + missing === 0}
              title={t('先补全未生成的章节，再自动合并成一篇')}
            >
              {t('一键成稿')}
            </button>
          </div>

          {missing > 0 ? (
            <p className="compose-warning">
              {t('还有')} {missing} {t('节没有读薄稿；现在合并只会使用已生成的')} {generatedChapters} {t('节。')}
            </p>
          ) : null}
          {missing > 0 && generatedChapters > 0 ? (
            <p className="compose-resume">
              {t('已完成')} {generatedChapters} {t('节，还有')} {missing} {t('节未完成。已生成的笔记已经保存在本地，点「生成未完成章节」会从缺口继续，不会重跑已完成章节。')}
            </p>
          ) : null}
          <p className="compose-estimate">
            {t('预计')} {missing} {t('次章节生成')}
            {pendingChars > 0 ? ` ${t('（约')} ${pendingChars.toLocaleString()} ${t('字原文）')}` : ''} · {t('合并约')} {mergeBatches} {t('次请求。')} {t('实际 token 和费用取决于模型；长书会按章节串行执行，期间可以取消。')}
          </p>
          {sourceChars > 0 ? (
            <p className="compose-target-hint">
              {t('当前读薄稿')} {sourceChars.toLocaleString()} {t('字')} ·{' '}
              {composeOptions.length === 'tight'
                ? `${t('精炼版目标约')} ${Math.round(sourceChars * 0.55).toLocaleString()} ${t('字')}`
                : `${t('完整版目标约')} ${Math.round(sourceChars * 0.82).toLocaleString()} ${t('字')}`}
            </p>
          ) : null}

          {composing ? (
            <div className="compose-progress-card">
              <div className="compose-progress-head">
                <span>{composeProgress?.message ?? t('正在合并整本书')}</span>
                <button type="button" className="text-button muted" onClick={() => void cancelCompose()}>
                  取消
                </button>
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width: `${
                      composeProgress && composeProgress.total > 0
                        ? Math.round((composeProgress.done / composeProgress.total) * 100)
                        : 12
                    }%`,
                  }}
                />
              </div>
            </div>
          ) : null}

          {result ? (
            <div className="compose-result">
              <div className="compose-result-head">
                <div>
                  <strong>{result.title}</strong>
                  <span>
                    {result.sourceChapters} {t('章 ·')} {result.sourceChars.toLocaleString()} → {result.outputChars.toLocaleString()} {t('字')}
                    {result.durationMs > 0 ? ` · ${Math.round(result.durationMs / 1000)}s` : ''}
                    {result.usage?.totalTokens ? ` · ${result.usage.totalTokens.toLocaleString()} tokens` : ''}
                  </span>
                </div>
                <div className="compose-result-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setEditing((value) => !value)}
                  >
                    {editing ? t('预览') : t('编辑')}
                  </button>
                  {dirty ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void saveArticle()}
                      disabled={busyAction === 'save'}
                    >
                      {busyAction === 'save' ? t('保存中…') : t('保存修改')}
                    </button>
                  ) : null}
                  {selectedIsHistorical ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void restoreSelectedVersion()}
                      disabled={busyAction === 'save'}
                    >
                      {busyAction === 'save' ? t('恢复中…') : t('恢复为当前')}
                    </button>
                  ) : null}
                  {editing && selection.text.trim().length >= 20 ? (
                    <button type="button" className="text-button" onClick={() => void rewriteSelection()} disabled={rewriting}>
                      {rewriting ? t('正在重写…') : t('重写选中')}
                    </button>
                  ) : null}
                  {compareModels.length > 0 ? (
                    <button type="button" className="text-button" onClick={() => setCompareOpen(true)}>
                      {t('模型对比')}
                    </button>
                  ) : null}
                </div>
              </div>

              {editing ? (
                <>
                  <textarea
                    className="compose-editor"
                    value={article}
                    onChange={(event) => {
                      setArticle(event.target.value)
                      setDirty(true)
                    }}
                    onSelect={(event) => {
                      const target = event.currentTarget
                      const start = target.selectionStart ?? 0
                      const end = target.selectionEnd ?? 0
                      setSelection({ start, end, text: target.value.slice(start, end) })
                    }}
                    spellCheck={false}
                  />
                  <p className="field-hint">
                    {t('选中一段文字后可以只重写这一段；确认前会先显示差异。')}
                  </p>
                </>
              ) : (
                <div className="compose-preview">
                  <Markdown text={article} />
                </div>
              )}

              <div className="compose-export-actions">
                <button type="button" className="ghost-button small" onClick={() => void copyArticle()} disabled={busyAction === 'copy'}>
                  {busyAction === 'copy' ? t('已复制') : t('复制全文')}
                </button>
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={() => void exportMarkdown()}
                  disabled={busyAction === 'markdown'}
                >
                  {busyAction === 'markdown' ? t('导出中…') : t('导出 .md')}
                </button>
                <button type="button" className="ghost-button small" onClick={() => void exportHtml()} disabled={busyAction === 'html'}>
                  {busyAction === 'html' ? t('导出中…') : t('导出博客分享页')}
                </button>
                <button type="button" className="ghost-button small" onClick={() => void exportPdf()} disabled={busyAction === 'pdf'}>
                  {busyAction === 'pdf' ? t('排版中…') : t('导出排版 PDF')}
                </button>
                <button type="button" className="ghost-button small" onClick={() => setPublishOpen(true)}>
                  {t('发布包')}
                </button>
                <button type="button" className="ghost-button small" onClick={onShareBook}>
                  {t('分享卡')}
                </button>
                <button type="button" className="ghost-button small" onClick={onOpenXhsBook}>
                  {t('小红书图文')}
                </button>
              </div>
            </div>
          ) : (
            <div className="compose-empty">
              <p className="compose-empty-title">{t('还没有整本成稿')}</p>
              <p>
                {t('先把章节读薄，再合并。合并会把所有读薄稿按主题重排，补上导语和过渡，做一次去 AI 味的润色，输出一篇可以直接发博客的长文。')}
              </p>
            </div>
          )}
        </section>
      </div>

      {sectionRewrite ? (
        <TextDiffDialog
          title={t('按段重写对比')}
          before={sectionRewrite.before}
          after={sectionRewrite.after}
          applyLabel={t('应用改写')}
          onApply={applySectionRewrite}
          onClose={() => setSectionRewrite(null)}
        />
      ) : null}

      {compareOpen ? (
        <CompareModelDialog
          suggestions={compareModels}
          busy={compareBusy}
          error={compareError}
          onCompare={(model) => void compareWithModel(model)}
          onClose={() => {
            if (!compareBusy) setCompareOpen(false)
          }}
        />
      ) : null}
      {compareDiff ? (
        <TextDiffDialog
          title={t('模型对比')}
          before={compareDiff.before}
          after={compareDiff.after}
          onClose={() => setCompareDiff(null)}
        />
      ) : null}

      <PublishDialog
        open={publishOpen}
        book={book}
        title={result?.title ?? book.title}
        markdown={article}
        onClose={() => setPublishOpen(false)}
      />
    </main>
  )
}
