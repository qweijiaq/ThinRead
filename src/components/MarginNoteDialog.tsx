import { useEffect, useState, type JSX } from 'react'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import type { ChapterContent, LabReport } from '../../shared/types.js'
import { Markdown } from './Markdown.js'

interface MarginNoteDialogProps {
  chapter: ChapterContent
  quote: string
  onSave(markdown: string): Promise<void>
  onClose(): void
}

export function MarginNoteDialog({ chapter, quote, onSave, onClose }: MarginNoteDialogProps): JSX.Element {
  const [result, setResult] = useState<LabReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose, 'button')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void window.api
      .marginNote(chapter.id, quote)
      .then((value) => {
        if (!cancelled) setResult(value)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chapter.id, quote])

  async function save(): Promise<void> {
    if (!result) return
    setSaving(true)
    setError(null)
    try {
      await onSave(result.markdown)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal margin-note-modal"
        role="dialog"
        aria-modal="true"
        aria-label="AI 边注"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>AI 边注</h2>
            <p className="modal-subtitle">{chapter.title}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <blockquote className="margin-note-quote">“{quote}”</blockquote>
        {loading ? <p className="lab-empty">正在读上下文…</p> : null}
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        {result ? (
          <div className="margin-note-result">
            <Markdown text={result.markdown} />
          </div>
        ) : null}
        <div className="modal-footer">
          <span className="modal-meta">边注会保存为一条带原文引用的笔记</span>
          <div className="modal-footer-actions">
            <button type="button" className="ghost-button" onClick={onClose}>
              关闭
            </button>
            <button type="button" className="primary-button" onClick={() => void save()} disabled={!result || saving || saved}>
              {saved ? '已保存' : saving ? '保存中…' : '存为笔记'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
