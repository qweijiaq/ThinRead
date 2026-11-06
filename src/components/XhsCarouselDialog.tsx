import { useEffect, useMemo, useRef, useState, type JSX } from 'react'

import type { ChapterMeta, Note, XhsCoverageAudit } from '../../shared/types.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import { t, useLocale } from '../lib/i18n.js'
import { Select } from './Select.js'
import {
  planXhsCarousel,
  renderXhsPage,
  xhsPageFilename,
  type XhsCarouselPlan,
  type XhsScope,
  type XhsTheme,
} from '../lib/xhs-carousel.js'

interface XhsCarouselDialogProps {
  bookId: string
  bookTitle: string
  author: string
  chapters: ChapterMeta[]
  chapterId?: string | null
  chapterTitle?: string | null
  initialScope: XhsScope
  onClose(): void
}

export function XhsCarouselDialog({
  bookId,
  bookTitle,
  author,
  chapters,
  chapterId,
  initialScope,
  onClose,
}: XhsCarouselDialogProps): JSX.Element {
  useLocale()
  const chapterOptions = useMemo(
    () => chapters.filter((chapter) => !chapter.hidden && chapter.chars > 0),
    [chapters],
  )
  const [scope, setScope] = useState<XhsScope>(initialScope)
  const [selectedChapterId, setSelectedChapterId] = useState(
    chapterId ?? chapterOptions.find((chapter) => chapter.kind === 'content')?.id ?? chapterOptions[0]?.id ?? null,
  )
  const selectedChapter = useMemo(
    () => chapterOptions.find((chapter) => chapter.id === selectedChapterId) ?? null,
    [chapterOptions, selectedChapterId],
  )
  const [concise, setConcise] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState(initialScope === 'chapter' ? selectedChapter?.title ?? bookTitle : bookTitle)
  const [theme, setTheme] = useState<XhsTheme>('ink')
  const [brand, setBrand] = useState(() => {
    try {
      return localStorage.getItem('reading-notes-share-brand') ?? ''
    } catch {
      return ''
    }
  })
  const [plan, setPlan] = useState<XhsCarouselPlan | null>(null)
  const [previews, setPreviews] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState<'save-all' | 'save-one' | 'copy' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [audit, setAudit] = useState<XhsCoverageAudit | null>(null)
  const [auditBusy, setAuditBusy] = useState(false)
  const [supplements, setSupplements] = useState<Note[]>([])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose, 'button')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setNotes([])
    setPlan(null)
    setPreviews([])
    setNotice(null)
    setAudit(null)
    setSupplements([])
    setTitle(scope === 'chapter' ? selectedChapter?.title ?? bookTitle : bookTitle)
    const request =
      scope === 'chapter' && selectedChapterId
        ? window.api.listNotes(bookId, selectedChapterId)
        : window.api.listNotes(bookId)
    request
      .then((items) => {
        if (cancelled) return
        setNotes(items)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [bookId, selectedChapter?.title, selectedChapterId, bookTitle, scope])

  useEffect(() => {
    if (loading || error || notes.length === 0) {
      setPlan(null)
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error(t('无法创建画布。'))
      const next = planXhsCarousel({
        scope,
        bookTitle,
        author,
        chapterId: selectedChapterId,
        chapterTitle: selectedChapter?.title ?? null,
        chapters,
        notes: [...notes, ...supplements],
        title,
        brand,
        concise,
        measure: ctx,
      })
      setPlan(next)
      setIndex(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [author, bookTitle, brand, chapters, concise, error, loading, notes, scope, selectedChapter?.title, selectedChapterId, supplements, title])

  useEffect(() => {
    if (!plan || plan.totalCards === 0 || plan.pages.length === 0) {
      setPreviews([])
      return
    }
    let cancelled = false
    void (async () => {
      await document.fonts.ready
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        const urls: string[] = []
        for (let pageIndex = 0; pageIndex < plan.pages.length; pageIndex++) {
          if (cancelled) return
          renderXhsPage(canvas, plan, pageIndex, theme)
          urls.push(canvas.toDataURL('image/png'))
          // 长书可能有几十页；分帧渲染，避免一次占满主线程。
          if (pageIndex % 2 === 0) await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
        }
        if (cancelled) return
        setPreviews(urls)
        setIndex((current) => Math.min(current, Math.max(0, urls.length - 1)))
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [plan, theme])

  const currentPreview = previews[index] ?? ''
  const coverage = useMemo(() => {
    if (!plan) return null
    return { total: plan.totalCards, covered: plan.coveredCards, pages: plan.pages.length }
  }, [plan])

  function switchScope(next: XhsScope): void {
    if (next === scope) return
    setScope(next)
  }

  async function runCoverageAudit(): Promise<void> {
    if (!plan || plan.cards.length === 0 || auditBusy) return
    setAuditBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await window.api.auditXhsCoverage({
        bookId,
        chapterId: scope === 'chapter' ? selectedChapterId ?? null : null,
        cards: plan.cards.map((card) => ({
          title: card.heading,
          content: card.body || card.heading,
          chapterTitle: card.chapterTitle,
        })),
      })
      setAudit(result)
      setNotice(result.note)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAuditBusy(false)
    }
  }

  function addMissingToPlan(): void {
    if (!audit) return
    const now = new Date().toISOString()
    const additions: Note[] = audit.missing.map((item) => ({
      id: item.id,
      bookId,
      chapterId: item.chapterId ?? (scope === 'chapter' ? selectedChapterId ?? null : null),
      kind: 'point',
      title: item.point.slice(0, 60),
      content: item.point,
      quote: item.evidence || null,
      quoteVerified: false,
      author: 'ai',
      edited: false,
      tags: [t('覆盖补漏')],
      section: null,
      importance: 3,
      role: t('AI 覆盖检查补漏'),
      divergences: [],
      createdAt: now,
      updatedAt: now,
    }))
    setSupplements((current) => {
      const ids = new Set(current.map((note) => note.id))
      return [...current, ...additions.filter((note) => !ids.has(note.id))]
    })
    setNotice(`${t('已把')} ${additions.length} ${t('条补漏加入图文，重新生成预览即可看到。')}`)
  }

  async function saveAll(): Promise<void> {
    if (!plan || plan.totalCards === 0 || previews.length === 0 || busy) return
    setBusy('save-all')
    setError(null)
    setNotice(null)
    try {
      const result = await window.api.saveImages(
        previews.map((dataUrl, pageIndex) => ({ dataUrl, name: xhsPageFilename(plan, pageIndex) })),
        `${plan.title} - 小红书`,
      )
      if (result.saved) setNotice(`${t('已保存')} ${result.count} ${t('张到')} ${result.path}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function saveCurrent(): Promise<void> {
    if (!plan || !currentPreview || busy) return
    setBusy('save-one')
    setError(null)
    setNotice(null)
    try {
      const result = await window.api.saveImage(currentPreview, xhsPageFilename(plan, index))
      if (result.saved) setNotice(`${t('已保存到')} ${result.path}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function copyCurrent(): Promise<void> {
    if (!currentPreview || busy) return
    setBusy('copy')
    setError(null)
    setNotice(null)
    try {
      await window.api.copyImage(currentPreview)
      setNotice(`${t('第')} ${index + 1} ${t('张已复制。')}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const modalTitle =
    plan?.scope === 'book' || (scope === 'book' && !plan) ? t('整本书的小红书图文') : t('这一章的小红书图文')
  const emptyHint =
    scope === 'chapter'
      ? t('先在这一章的笔记面板生成读薄稿和核心卡片，再来做图文。')
      : t('先给至少一章生成读薄稿和核心卡片，再来做整本图文。')

  return (
    <div className="modal-backdrop xhs-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="xhs-modal"
        role="dialog"
        aria-modal="true"
        aria-label={modalTitle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="xhs-head">
          <div>
            <p className="xhs-kicker">XHS CAROUSEL / 3:4</p>
            <h2>{modalTitle}</h2>
            <p>{loading ? t('正在读取知识点…') : coverage ? `${coverage.total} ${t('个知识点')} · ${coverage.pages} ${t('页')}` : t('还没有可排的知识点')}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        <div className="xhs-layout">
          <div className="xhs-preview-pane">
            {loading ? (
              <div className="xhs-empty">{t('正在整理知识点…')}</div>
            ) : error ? (
              <div className="xhs-empty error-text">{error}</div>
            ) : !plan || plan.totalCards === 0 || plan.pages.length === 0 ? (
              <div className="xhs-empty">
                <strong>{t('还没有核心知识点')}</strong>
                <span>{emptyHint}</span>
              </div>
            ) : (
              <>
                <div className="xhs-preview-frame">
                  {currentPreview ? <img src={currentPreview} alt={`${t('小红书图文第')} ${index + 1} ${t('页')}`} /> : <span>{t('正在排版…')}</span>}
                </div>
                <div className="xhs-pager">
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={() => setIndex((current) => Math.max(0, current - 1))}
                    disabled={index === 0}
                  >
                    {t('上一张')}
                  </button>
                  <span>
                    {String(index + 1).padStart(2, '0')} / {String(previews.length).padStart(2, '0')}
                  </span>
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={() => setIndex((current) => Math.min(previews.length - 1, current + 1))}
                    disabled={index >= previews.length - 1}
                  >
                    {t('下一张')}
                  </button>
                </div>
                <div className="xhs-preview-actions">
                  <button
                    type="button"
                    className="primary-button small"
                    onClick={() => void copyCurrent()}
                    disabled={busy !== null || !currentPreview}
                  >
                    {busy === 'copy' ? t('复制中…') : t('复制当前页')}
                  </button>
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={() => void saveCurrent()}
                    disabled={busy !== null || !currentPreview}
                  >
                    {busy === 'save-one' ? t('保存中…') : t('保存当前页')}
                  </button>
                </div>
                {notice ? <div className="inline-notice" role="status" aria-live="polite">{notice}</div> : null}
                {error ? <div className="inline-error" role="alert">{error}</div> : null}
                <div className="xhs-thumbs" aria-label={t('小红书图文页')}>
                  {previews.map((url, pageIndex) => (
                    <button
                      key={pageIndex}
                      type="button"
                      className={`xhs-thumb${pageIndex === index ? ' active' : ''}`}
                      onClick={() => setIndex(pageIndex)}
                      aria-label={`${t('第')} ${pageIndex + 1} ${t('页')}`}
                    >
                      <img src={url} alt="" />
                      <span>{String(pageIndex + 1).padStart(2, '0')}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="xhs-controls">
            {chapterOptions.length > 0 ? (
              <div className="xhs-control-group">
                <span className="xhs-control-label">{t('范围')}</span>
                <div className="share-segmented">
                  <button
                    type="button"
                    className={scope === 'chapter' ? 'active' : ''}
                    onClick={() => switchScope('chapter')}
                  >
                    {t('这一章')}
                  </button>
                  <button
                    type="button"
                    className={scope === 'book' ? 'active' : ''}
                    onClick={() => switchScope('book')}
                  >
                    {t('整本书')}
                  </button>
                </div>
                {scope === 'chapter' ? (
                  <Select
                    className="xhs-chapter-select"
                    value={selectedChapterId ?? ''}
                    onChange={(value) => {
                      setSelectedChapterId(value)
                      if (scope !== 'chapter') setScope('chapter')
                    }}
                    ariaLabel={t('选择章节')}
                    options={chapterOptions.map((chapter) => ({ value: chapter.id, label: chapter.title }))}
                  />
                ) : null}
              </div>
            ) : null}

            <div className="xhs-control-group">
              <span className="xhs-control-label">{t('篇幅')}</span>
              <div className="share-segmented">
                <button type="button" className={!concise ? 'active' : ''} onClick={() => setConcise(false)}>
                  {t('全部')}
                </button>
                <button type="button" className={concise ? 'active' : ''} onClick={() => setConcise(true)}>
                  {t('精简 3 条')}
                </button>
              </div>
            </div>

            <label className="share-field">
              {t('封面标题')}
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={bookTitle} />
            </label>
            <label className="share-field">
              {t('署名 / 品牌（可选）')}
              <input
                value={brand}
                onChange={(event) => {
                  setBrand(event.target.value)
                  try {
                    localStorage.setItem('reading-notes-share-brand', event.target.value)
                  } catch {
                    // 忽略存储失败。
                  }
                }}
                placeholder={t('例如 @你的名字')}
              />
            </label>

            <div className="xhs-control-group">
              <span className="xhs-control-label">{t('主题')}</span>
              <div className="share-segmented compact">
                <button type="button" className={theme === 'paper' ? 'active' : ''} onClick={() => setTheme('paper')}>
                  {t('纸')}
                </button>
                <button type="button" className={theme === 'ink' ? 'active' : ''} onClick={() => setTheme('ink')}>
                  {t('墨')}
                </button>
                <button type="button" className={theme === 'sage' ? 'active' : ''} onClick={() => setTheme('sage')}>
                  {t('苔绿')}
                </button>
              </div>
            </div>

            {coverage ? (
              <div className={`xhs-coverage${coverage.total > 0 && coverage.covered === coverage.total ? ' complete' : ''}`}>
                <strong>{coverage.covered} / {coverage.total}</strong>
                <span>{t('知识点已覆盖')}</span>
              </div>
            ) : null}

            {plan?.warnings.length ? (
              <div className="xhs-warnings">
                {plan.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}

            <div className="xhs-audit">
              <div className="xhs-audit-head">
                <strong>{t('原书覆盖检查')}</strong>
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={() => void runCoverageAudit()}
                  disabled={auditBusy || !plan || plan.cards.length === 0}
                >
                  {auditBusy ? t('检查中…') : t('用 AI 检查漏点')}
                </button>
              </div>
              <p className="share-hint">
                {t('覆盖报告只统计已有卡片。开启 AI 检查会对照原章正文找出可能的漏点，补漏卡只用于本次图文，不写入笔记。')}
              </p>
              {audit ? (
                <div className="xhs-audit-result">
                  <span>
                    {audit.checkedChapters} {t('节')} · {audit.missing.length} {t('个疑似漏点')}
                  </span>
                  {audit.missing.slice(0, 8).map((item) => (
                    <div key={item.id} className="xhs-audit-item">
                      <em>{item.chapterTitle ?? t('未分章')}</em>
                      <span>{item.point}</span>
                    </div>
                  ))}
                  {audit.missing.length > 0 ? (
                    <button type="button" className="text-button" onClick={addMissingToPlan}>
                      {t('把')} {audit.missing.length} {t('条补漏加入本次图文')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <p className="share-hint">
              {t('每一张卡片只出现一次；长卡片会自动续页，不截断正文。整本书会按章节顺序编排。')}
            </p>

            <button
              type="button"
              className="primary-button"
              onClick={() => void saveAll()}
              disabled={busy !== null || !plan || plan.totalCards === 0 || previews.length === 0}
            >
              {busy === 'save-all' ? t('保存中…') : `${t('保存全部')} ${previews.length || 0} ${t('张 PNG')}`}
            </button>
            {notice ? <div className="inline-notice" role="status" aria-live="polite">{notice}</div> : null}
          </div>
        </div>

        <canvas ref={canvasRef} className="share-canvas" aria-hidden="true" />
      </div>
    </div>
  )
}
