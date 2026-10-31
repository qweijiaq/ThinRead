import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'

import type {
  BookComposeOptions,
  BookComposeProgress,
  BookComposeResult,
  BookFormatDoneEvent,
  BookFormatProgress,
  BookGenerationDoneEvent,
  BookGenerationProgress,
  BookGenre,
  BookSummary,
  ChapterMeta,
  LabArtifact,
  Note,
} from '../../shared/types.js'
import { onContentCurrent } from '../lib/content-events.js'
import { confirmDialog } from './ConfirmDialog.js'
import { PublishDialog } from './PublishDialog.js'
import { Select } from './Select.js'
import { todayStamp } from '../lib/export.js'
import { BOOK_GENRE_OPTIONS, bookGenreLabel } from '../lib/genres.js'
import { Markdown } from './Markdown.js'

interface BookComposeProps {
  book: BookSummary
  chapters: ChapterMeta[]
  onBack(): void
  onOpenChapter(chapterId: string): void
  onShareBook(): void
  onSplitBook(): void
}

interface GenerationView {
  running: boolean
  done: number
  total: number
  title: string
  status: BookGenerationProgress['status'] | null
  message: string
}

const EMPTY_GENERATION: GenerationView = {
  running: false,
  done: 0,
  total: 0,
  title: '',
  status: null,
  message: '',
}

function parseComposeArtifact(artifact: LabArtifact | null): BookComposeResult | null {
  if (!artifact) return null
  try {
    const parsed = JSON.parse(artifact.content) as Partial<BookComposeResult>
    if (typeof parsed.markdown === 'string' && parsed.markdown.trim()) {
      return {
        title: typeof parsed.title === 'string' ? parsed.title : artifact.title,
        markdown: parsed.markdown,
        sourceChapters: Number(parsed.sourceChapters) || 0,
        sourceChars: Number(parsed.sourceChars) || 0,
        outputChars: Number(parsed.outputChars) || parsed.markdown.length,
        durationMs: Number(parsed.durationMs) || 0,
        usage: parsed.usage,
        promptVersion: typeof parsed.promptVersion === 'string' ? parsed.promptVersion : undefined,
        model: typeof parsed.model === 'string' ? parsed.model : '',
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : artifact.createdAt,
        options: parsed.options ?? { length: 'tight', voice: 'calm' },
      }
    }
  } catch {
    // 旧版本只存了 Markdown 正文。
  }
  return {
    title: artifact.title,
    markdown: artifact.content,
    sourceChapters: 0,
    sourceChars: 0,
    outputChars: artifact.content.length,
    durationMs: 0,
    model: '',
    createdAt: artifact.createdAt,
    options: { length: 'tight', voice: 'calm' },
  }
}

function versionLabel(artifact: LabArtifact): string {
  const date = new Date(artifact.createdAt)
  const stamp = Number.isNaN(date.getTime())
    ? artifact.createdAt
    : `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${stamp} · ${artifact.title}`
}

export function BookCompose({
  book,
  chapters,
  onBack,
  onOpenChapter,
  onShareBook,
  onSplitBook,
}: BookComposeProps): JSX.Element {
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
  const [history, setHistory] = useState<LabArtifact[]>([])
  const [selectedVersion, setSelectedVersion] = useState('')
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [busyAction, setBusyAction] = useState<'copy' | 'markdown' | 'html' | 'save' | null>(null)
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

  useEffect(() => {
    let cancelled = false
    setLoadingNotes(true)
    void window.api
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
        window.api.getLabArtifact('book-compose', scope),
        window.api.listLabArtifacts('book-compose', 40),
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

  useEffect(
    () =>
      onContentCurrent((detail) => {
        if (detail.tool === 'book-compose' && detail.scope === `book:${book.id}`) setComposeTick((value) => value + 1)
      }),
    [book.id],
  )

  useEffect(() => {
    const offPartial = window.api.onGenerationPartial((event) => {
      const phase = event.partial.progress?.phase
      const label =
        phase === 'condense'
          ? '正在把这一章读薄'
          : phase === 'cards'
            ? '正在提炼核心卡片'
            : phase === 'expand'
              ? '正在做有限延伸'
              : 'AI 正在读这一章'
      setGeneration((current) => (current.running ? { ...current, message: label } : current))
    })
    const offProgress = window.api.onBookGenerationProgress((event) => {
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
    const offDone = window.api.onBookGenerationDone((event) => {
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
    const offCompose = window.api.onBookComposeProgress((event) => {
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
    const confirmed = await confirmDialog({
      title: '整本 AI 排版',
      message: '会逐章用 AI 整理正文、清理广告和乱码，并覆盖已有 AI 排版结果；原文仍可随时还原。继续？',
      confirmLabel: '开始排版',
      danger: false,
    })
    if (!confirmed) return
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
      message: '正在准备排版',
    })
    try {
      await window.api.formatBook(book.id)
    } catch (err) {
      setFormatting(false)
      setFormatProgress(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function cancelFormat(): Promise<void> {
    await window.api.cancelFormat()
    setFormatting(false)
    setFormatProgress(null)
  }

  async function changeGenre(next: BookGenre): Promise<void> {
    const previous = genre
    setGenre(next)
    try {
      await window.api.setBookGenre(book.id, next)
      setNotice(`书籍类型已改为「${bookGenreLabel(next)}」，之后生成的笔记、成稿和关系图会使用它。`)
    } catch (err) {
      setGenre(previous)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function generateBook(onlyMissing: boolean): Promise<void> {
    setError(null)
    setGenerationResult(null)
    setGeneration({
      running: true,
      done: 0,
      total: onlyMissing ? missing : visible.length,
      title: '',
      status: null,
      message: onlyMissing ? '正在准备生成未完成的章节' : '正在准备重新生成整本书',
    })
    try {
      await window.api.generateBookNotes(book.id, { onlyMissing })
    } catch (err) {
      autoComposeRef.current = false
      setGeneration((current) => ({ ...current, running: false }))
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function cancelGeneration(): Promise<void> {
    autoComposeRef.current = false
    await window.api.cancelGeneration()
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
      message: '正在收齐读薄稿',
    })
    try {
      const next = await window.api.composeBook(book.id, composeOptionsRef.current)
      setResult(next)
      setArticle(next.markdown)
      setDirty(false)
      setNotice('整本成稿已生成并保存。')
      await loadCompose()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('取消')) setNotice('已取消合并。')
      else setError(message)
    } finally {
      setComposing(false)
      setComposeProgress(null)
    }
  }

  async function cancelCompose(): Promise<void> {
    await window.api.cancelBookCompose()
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
      await window.api.saveLabArtifact({
        tool: 'book-compose',
        scope: `book:${book.id}`,
        title: next.title,
        content: JSON.stringify(next),
      })
      setResult(next)
      setDirty(false)
      setNotice('修改已保存为新版本。')
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
      await window.api.copyText(article)
      setNotice('整本笔记已复制，可以直接贴到博客编辑器。')
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
      const saved = await window.api.saveMarkdown(name, article)
      if (saved.saved) setNotice(`已导出到 ${saved.path}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  async function exportHtml(): Promise<void> {
    if (!article.trim()) return
    setBusyAction('html')
    setError(null)
    try {
      const { bookDescription, buildBookBlogHtml, bookHtmlFilename } = await import('../lib/blog-export.js')
      const { renderPublishCover } = await import('../lib/publish-cover.js')
      const date = todayStamp()
      const html = buildBookBlogHtml({
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
      const saved = await window.api.saveHtml(bookHtmlFilename(book.title), html)
      if (saved.saved) setNotice(`分享页已导出到 ${saved.path}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  function oneClick(): void {
    if (composing || generation.running || loadingNotes) return
    if (missing > 0) {
      autoComposeRef.current = true
      setNotice(`正在先补 ${missing} 节读薄稿，完成后会自动合并全文。`)
      void generateBook(true)
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
            ← 回到阅读
          </button>
          <h1>{book.title}</h1>
          <p>
            {bookGenreLabel(genre)} · {visible.length} 节 · 已生成 {generatedChapters} 节 · {totalCards} 张卡片
            {sourceChars > 0 ? ` · 读薄稿 ${sourceChars.toLocaleString()} 字` : ''}
          </p>
        </div>
        <div className="compose-head-actions">
          <button
            type="button"
            className="ghost-button small"
            onClick={() => setChaptersCollapsed((value) => !value)}
            aria-pressed={chaptersCollapsed}
          >
            {chaptersCollapsed ? '展开章节' : '收起章节'}
          </button>
          <button type="button" className="ghost-button small" onClick={onSplitBook}>
            拆分本书
          </button>
          <button type="button" className="ghost-button small" onClick={onShareBook}>
            分享这本书
          </button>
        </div>
      </div>

      {error ? <div className="inline-error">{error}</div> : null}
      {notice ? <div className="inline-notice">{notice}</div> : null}

      <div className={`compose-grid${chaptersCollapsed ? ' is-chapters-collapsed' : ''}`}>
        <section className="compose-chapters">
          <div className="compose-section-head">
            <div>
              <h2>整本生成</h2>
              <p>逐章读薄，保留人工修改；已有读薄稿的章节默认跳过。</p>
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
              {generation.running ? '生成中…' : missing > 0 ? `生成未完成章节 · ${missing}` : '全部章节已生成'}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                void confirmDialog({
                  title: '重新生成整本书',
                  message: '重新生成整本书会替换所有未人工修改的 AI 笔记，确定继续？',
                  confirmLabel: '重新生成',
                  danger: true,
                }).then((confirmed) => {
                  if (confirmed) void generateBook(false)
                })
              }}
              disabled={generation.running || visible.length === 0}
            >
              整本重新生成
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void formatBook()}
              disabled={formatting || generation.running || visible.length === 0}
            >
              {formatting ? '整本排版中…' : '整本 AI 排版'}
            </button>
          </div>

          {generation.running || generation.status ? (
            <div className="compose-progress-card">
              <div className="compose-progress-head">
                <span>
                  {generation.running ? '正在生成' : '上次生成'}
                  {generation.total > 0 ? ` · ${generation.done}/${generation.total}` : ''}
                </span>
                {generation.running ? (
                  <button type="button" className="text-button muted" onClick={() => void cancelGeneration()}>
                    取消
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
                  新生成 {generationResult.generated} 节
                  {generationResult.existing > 0 ? `，已有读薄稿 ${generationResult.existing} 节` : ''}
                  {generationResult.skipped > 0 ? `，跳过 ${generationResult.skipped} 节` : ''}
                  {generationResult.failed.length > 0 ? `，失败 ${generationResult.failed.length} 节` : ''}
                </p>
              ) : null}
              {generationResult?.failed.length ? (
                <details className="compose-failures">
                  <summary>查看失败章节</summary>
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
                  整本 AI 排版
                  {formatProgress && formatProgress.total > 0 ? ` · ${formatProgress.done}/${formatProgress.total}` : ''}
                </span>
                {formatting ? (
                  <button type="button" className="text-button muted" onClick={() => void cancelFormat()}>
                    取消
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
                  : formatProgress?.message || '正在排版章节'}
              </p>
              {formatResult && !formatResult.cancelled ? (
                <p className="compose-progress-line">
                  完成 {formatResult.formatted} 节，跳过 {formatResult.skipped} 节
                  {formatResult.failed.length > 0 ? `，失败 ${formatResult.failed.length} 节` : ''}
                </p>
              ) : null}
              {formatResult?.failed.length ? (
                <details className="compose-failures">
                  <summary>查看排版失败章节</summary>
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
            {loadingNotes ? <p className="muted">正在读取笔记…</p> : null}
            {visible.map((chapter, index) => {
              const condensed = condensedByChapter.get(chapter.id)
              const cards = cardsByChapter.get(chapter.id)?.length ?? 0
              return (
                <button
                  key={chapter.id}
                  type="button"
                  className={`compose-chapter-row${condensed ? ' is-ready' : ''}`}
                  onClick={() => onOpenChapter(chapter.id)}
                  title={condensed ? '打开这一章' : '打开这一章并生成笔记'}
                >
                  <span className="compose-chapter-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="compose-chapter-main">
                    <span className="compose-chapter-title">{chapter.isPart ? `${chapter.title}（篇首页）` : chapter.title}</span>
                    <span className="compose-chapter-meta">
                      {chapter.partTitle && !chapter.isPart ? `${chapter.partTitle} · ` : ''}
                      {chapter.chars.toLocaleString()} 字
                      {cards > 0 ? ` · ${cards} 张卡片` : ''}
                      {condensed ? ` · 读薄稿 ${condensed.content.length.toLocaleString()} 字` : ''}
                    </span>
                  </span>
                  <span className={`compose-chapter-state${condensed ? ' ready' : ''}`}>
                    {condensed ? '已读薄' : '待生成'}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="compose-article">
          <div className="compose-section-head">
            <div>
              <h2>整本成稿</h2>
              <p>把所有读薄稿合成一篇完整文章，统一语气、补过渡、去掉 AI 味。</p>
            </div>
            {history.length > 1 ? (
              <Select
                className="compose-history"
                value={selectedVersion}
                onChange={(value) => void selectVersion(value)}
                ariaLabel="成稿历史"
                options={history.map((artifact) => ({ value: artifact.id, label: versionLabel(artifact) }))}
              />
            ) : null}
          </div>

          <div className="compose-options">
            <label>
              书籍类型
              <Select
                value={genre}
                onChange={(value) => void changeGenre(value as BookGenre)}
                disabled={composing}
                ariaLabel="书籍类型"
                options={BOOK_GENRE_OPTIONS}
              />
            </label>
            <label>
              篇幅
              <Select
                value={composeOptions.length}
                onChange={(value) =>
                  setComposeOptions((current) => ({ ...current, length: value as BookComposeOptions['length'] }))
                }
                disabled={composing}
                ariaLabel="篇幅"
                options={[
                  { value: 'tight', label: '精炼版' },
                  { value: 'full', label: '完整版' },
                ]}
              />
            </label>
            <label>
              语气
              <Select
                value={composeOptions.voice}
                onChange={(value) =>
                  setComposeOptions((current) => ({ ...current, voice: value as BookComposeOptions['voice'] }))
                }
                disabled={composing}
                ariaLabel="语气"
                options={[
                  { value: 'calm', label: '克制准确' },
                  { value: 'personal', label: '读者视角' },
                  { value: 'sharp', label: '有判断' },
                ]}
              />
            </label>
            <button
              type="button"
              className="primary-button"
              onClick={() => void compose()}
              disabled={composing || generatedChapters === 0 || generation.running}
            >
              {composing ? '正在合并…' : result ? '重新合并全文' : '合并整本书'}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={oneClick}
              disabled={composing || generation.running || loadingNotes || generatedChapters + missing === 0}
              title="先补全未生成的章节，再自动合并成一篇"
            >
              一键成稿
            </button>
          </div>

          {missing > 0 ? (
            <p className="compose-warning">还有 {missing} 节没有读薄稿；现在合并只会使用已生成的 {generatedChapters} 节。</p>
          ) : null}
          {sourceChars > 0 ? (
            <p className="compose-target-hint">
              当前读薄稿 {sourceChars.toLocaleString()} 字，
              {composeOptions.length === 'tight'
                ? `精炼版目标约 ${Math.round(sourceChars * 0.55).toLocaleString()} 字`
                : `完整版目标约 ${Math.round(sourceChars * 0.82).toLocaleString()} 字`}
              。
            </p>
          ) : null}

          {composing ? (
            <div className="compose-progress-card">
              <div className="compose-progress-head">
                <span>{composeProgress?.message ?? '正在合并整本书'}</span>
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
                    {result.sourceChapters} 章 · {result.sourceChars.toLocaleString()} → {result.outputChars.toLocaleString()} 字
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
                    {editing ? '预览' : '编辑'}
                  </button>
                  {dirty ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void saveArticle()}
                      disabled={busyAction === 'save'}
                    >
                      {busyAction === 'save' ? '保存中…' : '保存修改'}
                    </button>
                  ) : null}
                </div>
              </div>

              {editing ? (
                <textarea
                  className="compose-editor"
                  value={article}
                  onChange={(event) => {
                    setArticle(event.target.value)
                    setDirty(true)
                  }}
                  spellCheck={false}
                />
              ) : (
                <div className="compose-preview">
                  <Markdown text={article} />
                </div>
              )}

              <div className="compose-export-actions">
                <button type="button" className="ghost-button small" onClick={() => void copyArticle()} disabled={busyAction === 'copy'}>
                  {busyAction === 'copy' ? '已复制' : '复制全文'}
                </button>
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={() => void exportMarkdown()}
                  disabled={busyAction === 'markdown'}
                >
                  {busyAction === 'markdown' ? '导出中…' : '导出 .md'}
                </button>
                <button type="button" className="ghost-button small" onClick={() => void exportHtml()} disabled={busyAction === 'html'}>
                  {busyAction === 'html' ? '导出中…' : '导出博客分享页'}
                </button>
                <button type="button" className="ghost-button small" onClick={() => setPublishOpen(true)}>
                  发布包
                </button>
                <button type="button" className="ghost-button small" onClick={onShareBook}>
                  分享卡
                </button>
              </div>
            </div>
          ) : (
            <div className="compose-empty">
              <p className="compose-empty-title">还没有整本成稿</p>
              <p>
                先把章节读薄，再合并。合并会把所有读薄稿按主题重排，补上导语和过渡，做一次去 AI 味的润色，
                输出一篇可以直接发博客的长文。
              </p>
            </div>
          )}
        </section>
      </div>

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
