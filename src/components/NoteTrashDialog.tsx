import { useEffect, useState, type JSX } from 'react'

import type { TrashedNote } from '../../shared/types.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import { confirmDialog } from './ConfirmDialog.js'

interface NoteTrashDialogProps {
  open: boolean
  onClose(): void
  onChanged(): void
}

const KIND_LABEL: Record<TrashedNote['kind'], string> = {
  condensed: '读薄稿',
  summary: '摘要',
  claim: '论点',
  point: '知识点',
  question: '问题',
  thought: '想法',
  highlight: '划线',
}

function deletedLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function NoteTrashDialog({ open, onClose, onChanged }: NoteTrashDialogProps): JSX.Element | null {
  const [notes, setNotes] = useState<TrashedNote[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose, 'button')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void window.api
      .listTrashedNotes()
      .then((items) => {
        if (!cancelled) setNotes(items)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  async function restore(item: TrashedNote): Promise<void> {
    if (busy) return
    setBusy(item.id)
    setError(null)
    try {
      const note = await window.api.restoreNote(item.id)
      if (!note) throw new Error('原书或章节已经不存在，无法恢复这条笔记。')
      setNotes((current) => current.filter((entry) => entry.id !== item.id))
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function purge(item: TrashedNote): Promise<void> {
    if (busy) return
    const confirmed = await confirmDialog({
      title: '彻底删除',
      message: `彻底删除「${item.title}」？删除后无法恢复。`,
      confirmLabel: '彻底删除',
      danger: true,
    })
    if (!confirmed) return
    setBusy(item.id)
    setError(null)
    try {
      await window.api.purgeTrashedNote(item.id)
      setNotes((current) => current.filter((entry) => entry.id !== item.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function empty(): Promise<void> {
    if (busy || notes.length === 0) return
    const confirmed = await confirmDialog({
      title: '清空回收站',
      message: `彻底删除 ${notes.length} 条笔记？删除后无法恢复。`,
      confirmLabel: '清空',
      danger: true,
    })
    if (!confirmed) return
    setBusy('empty')
    setError(null)
    try {
      await window.api.emptyNoteTrash()
      setNotes([])
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        ref={dialogRef}
        className="modal trash-modal"
        role="dialog"
        aria-modal="true"
        aria-label="最近删除的笔记"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>最近删除</h2>
            <p className="trash-hint">删除的笔记保留 30 天，之后会自动清理。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={Boolean(busy)} aria-label="关闭">
            ×
          </button>
        </div>

        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        {loading ? <p className="trash-empty">正在加载…</p> : null}
        {!loading && notes.length === 0 ? <p className="trash-empty">回收站是空的。</p> : null}

        {notes.length > 0 ? (
          <div className="trash-list">
            {notes.map((item) => (
              <article key={item.id} className="trash-row">
                <div className="trash-row-main">
                  <div className="trash-row-head">
                    <span className="kind-badge">{KIND_LABEL[item.kind]}</span>
                    <strong>{item.title}</strong>
                  </div>
                  <p className="trash-row-meta">
                    {item.bookTitle}
                    {item.chapterTitle ? ` · ${item.chapterTitle}` : ''} · 删除于 {deletedLabel(item.deletedAt)}
                  </p>
                  {item.preview ? <p className="trash-row-preview">{item.preview}</p> : null}
                </div>
                <div className="trash-row-actions">
                  <button type="button" className="text-button" onClick={() => void restore(item)} disabled={Boolean(busy)}>
                    {busy === item.id ? '处理中…' : '恢复'}
                  </button>
                  <button type="button" className="text-button muted" onClick={() => void purge(item)} disabled={Boolean(busy)}>
                    彻底删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        <div className="trash-foot">
          <span className="muted">{notes.length > 0 ? `${notes.length} 条笔记` : ''}</span>
          <button type="button" className="ghost-button small" onClick={() => void empty()} disabled={notes.length === 0 || Boolean(busy)}>
            {busy === 'empty' ? '清理中…' : '清空回收站'}
          </button>
        </div>
      </div>
    </div>
  )
}
