import { useEffect, useRef, useState, type JSX } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

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

/** 用 PDF.js 显示原始版式；文字重排和 AI 功能仍走原来的章节视图。 */
export function PdfOriginalView({ bookId, chapterId, title, initialPage, onClose }: PdfOriginalViewProps): JSX.Element {
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose, 'button')
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(Math.max(1, initialPage))
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)
  const [loading, setLoading] = useState(true)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let opened: PDFDocumentProxy | null = null
    void (async () => {
      try {
        const [bytes, position] = await Promise.all([
          window.api.readBookFile(bookId),
          chapterId ? window.api.getReadingPosition(chapterId).catch(() => null) : Promise.resolve(null),
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
    void window.api.saveReadingPage(chapterId, bookId, page).catch(() => undefined)
  }, [bookId, chapterId, doc, page])

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

  return (
    <div className="pdf-viewer-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="pdf-viewer"
        role="dialog"
        aria-modal="true"
        aria-label="PDF 原版阅读"
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
          }
        }}
      >
        <div className="pdf-toolbar">
          <div className="pdf-toolbar-title">
            <strong>原版 PDF</strong>
            <span>{title}</span>
          </div>
          <div className="pdf-toolbar-controls">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>
              上一页
            </button>
            <label>
              <span className="sr-only">页码</span>
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
              下一页
            </button>
            <span className="pdf-toolbar-divider" />
            <button type="button" onClick={() => setZoom((current) => Math.max(MIN_ZOOM, current - 0.1))} aria-label="缩小">
              −
            </button>
            <span className="pdf-zoom">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((current) => Math.min(MAX_ZOOM, current + 0.1))} aria-label="放大">
              ＋
            </button>
            <button type="button" className="ghost-button small" onClick={() => setZoom(1)}>
              适应宽度
            </button>
            <button type="button" className="ghost-button small" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        <div className="pdf-canvas-wrap" ref={wrapRef}>
          {loading ? <p className="pdf-status">正在打开 PDF…</p> : null}
          {error ? <p className="inline-error" role="alert">{error}</p> : null}
          <canvas ref={canvasRef} className="pdf-canvas" aria-label={`PDF 第 ${page} 页`} />
          {rendering && !loading ? <span className="pdf-rendering">正在渲染…</span> : null}
        </div>
      </div>
    </div>
  )
}
