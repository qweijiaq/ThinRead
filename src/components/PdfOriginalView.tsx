import { bridge } from '../lib/bridge.js'
import { useEffect, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import type { PdfAnnotation, PdfAnnotationColor } from '../../shared/types.js'
import { t } from '../lib/i18n.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'

interface PdfOriginalViewProps {
  bookId: string
  chapterId: string | null
  title: string
  initialPage: number
  onClose(): void
}

const MIN_ZOOM = 0.4
const MAX_ZOOM = 3

function clampPage(value: number, total: number): number {
  return Math.min(Math.max(1, Math.round(value) || 1), Math.max(1, total))
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

interface DraftRect {
  x: number
  y: number
  width: number
  height: number
}

const COLOR_ORDER: PdfAnnotationColor[] = ['yellow', 'green', 'blue']

/** 用 PDF.js 显示原始版式；文字重排和 AI 功能仍走原来的章节视图。 */
export function PdfOriginalView({ bookId, chapterId, title, initialPage, onClose }: PdfOriginalViewProps): JSX.Element {
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose, 'button')
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const dragRef = useRef<{ startX: number; startY: number } | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(Math.max(1, initialPage))
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)
  const [loading, setLoading] = useState(true)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [annotating, setAnnotating] = useState(false)
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([])
  const [draft, setDraft] = useState<DraftRect | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [color, setColor] = useState<PdfAnnotationColor>('yellow')
  const [savingNote, setSavingNote] = useState(false)
  const [showList, setShowList] = useState(false)
  const [allAnnotations, setAllAnnotations] = useState<PdfAnnotation[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let opened: PDFDocumentProxy | null = null
    void (async () => {
      try {
        const [bytes, position] = await Promise.all([
          bridge.readBookFile(bookId),
          chapterId ? bridge.getReadingPosition(chapterId).catch(() => null) : Promise.resolve(null),
        ])
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
        opened = await pdfjs.getDocument({
          data: bytes,
          useSystemFonts: true,
        }).promise
        if (cancelled) {
          void opened.destroy()
          return
        }
        docRef.current = opened
        setDoc(opened)
        setPage(clampPage(position?.page ?? initialPage, opened.numPages))
        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
      docRef.current = null
      void opened?.destroy()
    }
  }, [bookId, chapterId, initialPage])

  useEffect(() => {
    if (!doc || !chapterId) return
    void bridge.saveReadingPage(chapterId, bookId, page).catch(() => undefined)
  }, [bookId, chapterId, doc, page])

  useEffect(() => {
    let cancelled = false
    setSelectedId(null)
    setDraft(null)
    void bridge
      .listPdfAnnotations(bookId, page)
      .then((rows) => {
        if (!cancelled) setAnnotations(rows)
      })
      .catch(() => {
        if (!cancelled) setAnnotations([])
      })
    return () => {
      cancelled = true
    }
  }, [bookId, page])

  useEffect(() => {
    refreshAll()
  }, [bookId])

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0
      if (next > 0) setWidth(next)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!doc || width <= 0) return
    let cancelled = false
    let task: RenderTask | null = null
    setRendering(true)
    void (async () => {
      try {
        const pdfPage = await doc.getPage(page)
        if (cancelled) return
        const base = pdfPage.getViewport({ scale: 1 })
        const fit = Math.max(0.1, (width - 36) / base.width)
        const viewport = pdfPage.getViewport({ scale: fit * zoom })
        const canvas = canvasRef.current
        if (!canvas) return
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio))
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio))
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        const context = canvas.getContext('2d')
        if (!context) return
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        task = pdfPage.render({ canvasContext: context, viewport, canvas })
        await task.promise
      } catch (err) {
        if (!cancelled && !(err instanceof Error && err.name === 'RenderingCancelledException')) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, page, zoom, width])

  const total = doc?.numPages ?? 0
  const selected = annotations.find((item) => item.id === selectedId) ?? null

  function pointOf(event: ReactMouseEvent): { x: number; y: number } | null {
    const stage = stageRef.current
    if (!stage) return null
    const rect = stage.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    }
  }

  function refreshAll(): void {
    void bridge
      .listPdfAnnotationsForBook(bookId)
      .then(setAllAnnotations)
      .catch(() => setAllAnnotations([]))
  }

  function onPointerDown(event: ReactMouseEvent): void {
    if (!annotating || event.button !== 0) return
    const point = pointOf(event)
    if (!point) return
    dragRef.current = { startX: point.x, startY: point.y }
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 })
    event.preventDefault()
  }

  function onPointerMove(event: ReactMouseEvent): void {
    const start = dragRef.current
    if (!start) return
    const point = pointOf(event)
    if (!point) return
    setDraft({
      x: Math.min(start.startX, point.x),
      y: Math.min(start.startY, point.y),
      width: Math.abs(point.x - start.startX),
      height: Math.abs(point.y - start.startY),
    })
  }

  function onPointerUp(): void {
    const start = dragRef.current
    const rect = draft
    dragRef.current = null
    if (!start || !rect) {
      setDraft(null)
      return
    }
    if (rect.width < 0.005 || rect.height < 0.005) {
      setDraft(null)
      return
    }
    void bridge
      .savePdfAnnotation({ bookId, page, ...rect, color })
      .then((saved) => {
        setAnnotations((current) => [...current, saved])
        refreshAll()
        setSelectedId(saved.id)
        setNoteDraft(saved.note)
        setDraft(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  function selectAnnotation(item: PdfAnnotation): void {
    setSelectedId(item.id)
    setNoteDraft(item.note)
    setColor(item.color)
  }

  function saveNote(): void {
    if (!selected) return
    setSavingNote(true)
    void bridge
      .updatePdfAnnotation(selected.id, { note: noteDraft, color })
      .then((updated) => {
        setAnnotations((current) => current.map((item) => (item.id === updated.id ? updated : item)))
        refreshAll()
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSavingNote(false))
  }

  function saveAsNote(): void {
    if (!selected) return
    const text = noteDraft.trim()
    void bridge
      .createNote({
        bookId,
        chapterId: chapterId ?? null,
        kind: 'highlight',
        title: `${t('PDF 标注')} · ${t('第')} ${selected.page} ${t('页')}`,
        content: text || t('PDF 标注'),
        quote: text || null,
        tags: ['PDF'],
      })
      .then(() => {
        setNotice(t('已存为笔记。'))
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  function removeAnnotation(): void {
    if (!selected) return
    void bridge
      .deletePdfAnnotation(selected.id)
      .then(() => {
        setAnnotations((current) => current.filter((item) => item.id !== selected.id))
        refreshAll()
        setSelectedId(null)
        setNoteDraft('')
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  return (
    <div className="pdf-viewer-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="pdf-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={t('PDF 原版阅读')}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' && page > 1) {
            event.preventDefault()
            setPage((current) => Math.max(1, current - 1))
          } else if (event.key === 'ArrowRight' && page < total) {
            event.preventDefault()
            setPage((current) => Math.min(total, current + 1))
          } else if (event.key === '+' || event.key === '=') {
            event.preventDefault()
            setZoom((current) => Math.min(MAX_ZOOM, current + 0.1))
          } else if (event.key === '-') {
            event.preventDefault()
            setZoom((current) => Math.max(MIN_ZOOM, current - 0.1))
          } else if (event.key === 'Escape') {
            if (selectedId) {
              event.preventDefault()
              setSelectedId(null)
            }
          }
        }}
      >
        <div className="pdf-toolbar">
          <div className="pdf-toolbar-title">
            <strong>{t('原版 PDF')}</strong>
            <span>{title}</span>
          </div>
          <div className="pdf-toolbar-controls">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>
              {t('上一页')}
            </button>
            <label>
              <span className="sr-only">{t('页码')}</span>
              <input
                type="number"
                min={1}
                max={total || 1}
                value={page}
                onChange={(event) => setPage(clampPage(Number(event.target.value), total))}
              />
            </label>
            <span className="pdf-page-total">/ {total || '—'}</span>
            <button type="button" onClick={() => setPage((current) => Math.min(total, current + 1))} disabled={page >= total}>
              {t('下一页')}
            </button>
            <span className="pdf-toolbar-divider" />
            <button type="button" onClick={() => setZoom((current) => Math.max(MIN_ZOOM, current - 0.1))} aria-label={t('缩小')}>
              −
            </button>
            <span className="pdf-zoom">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((current) => Math.min(MAX_ZOOM, current + 0.1))} aria-label={t('放大')}>
              ＋
            </button>
            <button type="button" className="ghost-button small" onClick={() => setZoom(1)}>
              {t('适应宽度')}
            </button>
            <span className="pdf-toolbar-divider" />
            <button
              type="button"
              className={`ghost-button small${annotating ? ' is-active' : ''}`}
              aria-pressed={annotating}
              onClick={() => {
                setAnnotating((current) => !current)
                setSelectedId(null)
                setDraft(null)
              }}
            >
              {t('标注')}{annotations.length > 0 ? ` · ${annotations.length}` : ''}
            </button>
            <button
              type="button"
              className={`ghost-button small${showList ? ' is-active' : ''}`}
              aria-pressed={showList}
              onClick={() => {
                setShowList((current) => !current)
                refreshAll()
              }}
            >
              {t('标注列表')}{allAnnotations.length > 0 ? ` · ${allAnnotations.length}` : ''}
            </button>
            <button type="button" className="ghost-button small" onClick={onClose}>
              {t('关闭')}
            </button>
          </div>
        </div>
        {showList ? (
          <aside className="pdf-annotation-list" aria-label={t('标注列表')}>
            <div className="pdf-annotation-list-head">
              <strong>{t('标注列表')}</strong>
              <button type="button" className="icon-button" onClick={() => setShowList(false)} aria-label={t('关闭')}>
                ×
              </button>
            </div>
            {allAnnotations.length === 0 ? (
              <p className="muted">{t('还没有标注。')}</p>
            ) : (
              <ul>
                {allAnnotations.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`pdf-annotation-list-item is-${item.color}`}
                      onClick={() => {
                        setPage(item.page)
                        setSelectedId(item.id)
                        setNoteDraft(item.note)
                        setColor(item.color)
                        setShowList(false)
                      }}
                    >
                      <span className="pdf-annotation-list-page">
                        {t('第')} {item.page} {t('页')}
                      </span>
                      <span className="pdf-annotation-list-note">{item.note || t('无备注')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        ) : null}
        <div className="pdf-canvas-wrap" ref={wrapRef}>
          {loading ? <p className="pdf-status">{t('正在打开 PDF…')}</p> : null}
          {error ? <p className="inline-error" role="alert">{error}</p> : null}
          <div className="pdf-page-stage" ref={stageRef}>
            <canvas ref={canvasRef} className="pdf-canvas" aria-label={t('PDF 第 {page} 页').replace('{page}', String(page))} />
            <div
              className={`pdf-annotation-layer${annotating ? ' is-annotating' : ''}`}
              onMouseDown={onPointerDown}
              onMouseMove={onPointerMove}
              onMouseUp={onPointerUp}
              onMouseLeave={() => {
                if (dragRef.current) onPointerUp()
              }}
            >
              {annotations.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`pdf-annotation is-${item.color}${selectedId === item.id ? ' is-selected' : ''}`}
                  style={{
                    left: `${item.x * 100}%`,
                    top: `${item.y * 100}%`,
                    width: `${item.width * 100}%`,
                    height: `${item.height * 100}%`,
                  }}
                  aria-label={item.note ? `${t('标注')}：${item.note}` : t('PDF 标注')}
                  onClick={(event) => {
                    event.stopPropagation()
                    selectAnnotation(item)
                  }}
                />
              ))}
              {draft ? (
                <div
                  className={`pdf-annotation is-${color} is-draft`}
                  style={{
                    left: `${draft.x * 100}%`,
                    top: `${draft.y * 100}%`,
                    width: `${draft.width * 100}%`,
                    height: `${draft.height * 100}%`,
                  }}
                />
              ) : null}
            </div>
          </div>
          {rendering && !loading ? <span className="pdf-rendering">{t('正在渲染…')}</span> : null}
        </div>

        {selected ? (
          <div className="pdf-annotation-editor" role="group" aria-label={t('PDF 标注')}>
            <div className="pdf-annotation-editor-head">
              <strong>
                {t('第')} {selected.page} {t('页')} · {t('标注')}
              </strong>
              <div className="pdf-annotation-colors" role="group" aria-label={t('标注颜色')}>
                {COLOR_ORDER.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`pdf-annotation-color is-${value}${color === value ? ' is-active' : ''}`}
                    aria-label={value === 'yellow' ? t('黄色') : value === 'green' ? t('绿色') : t('蓝色')}
                    aria-pressed={color === value}
                    onClick={() => setColor(value)}
                  />
                ))}
              </div>
            </div>
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder={t('给这块标注写一句备注…')}
              rows={3}
            />
            {notice ? <p className="field-hint" role="status">{notice}</p> : null}
            <div className="pdf-annotation-editor-actions">
              <button type="button" className="ghost-button small danger" onClick={removeAnnotation}>
                {t('删除标注')}
              </button>
              <span />
              <button type="button" className="ghost-button small" onClick={saveAsNote}>
                {t('存为笔记')}
              </button>
              <button type="button" className="ghost-button small" onClick={() => setSelectedId(null)}>
                {t('取消')}
              </button>
              <button type="button" className="primary-button small" onClick={saveNote} disabled={savingNote}>
                {savingNote ? t('保存中…') : t('保存')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
