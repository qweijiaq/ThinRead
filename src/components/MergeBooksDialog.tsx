import { useEffect, useMemo, useState, type JSX } from 'react'
import { useDialogFocus } from '../lib/useDialogFocus.js'

import type { BookSummary } from '../../shared/types.js'
import { Checkbox } from './Checkbox.js'

interface MergeBooksDialogProps {
  open: boolean
  books: BookSummary[]
  onClose(): void
  onMerged(book: BookSummary): void
}

export function MergeBooksDialog({ open, books, onClose, onMerged }: MergeBooksDialogProps): JSX.Element | null {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setTitle('')
    setAuthor('')
    setError(null)
  }, [open])

  const chosen = useMemo(() => books.filter((book) => selected.has(book.id)), [books, selected])

  const dialogRef = useDialogFocus<HTMLDivElement>(open, () => { if (!busy) onClose() }, 'input')
  if (!open) return null

  async function merge(): Promise<void> {
    if (chosen.length < 2 || busy) return
    setBusy(true)
    setError(null)
    try {
      const merged = await window.api.mergeBooks(
        chosen.map((book) => book.id),
        title.trim() || chosen[0]!.title,
        author.trim() || chosen[0]!.author,
      )
      onMerged(merged)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        ref={dialogRef}
        className="merge-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="合并书籍"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="import-head">
          <div>
            <h2>合并书籍</h2>
            <p>把多本书的章节和笔记按顺序并入第一本选中的书。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="merge-list">
          {books.map((book) => (
            <div key={book.id} className={`merge-row${selected.has(book.id) ? ' is-selected' : ''}`}>
              <Checkbox
                checked={selected.has(book.id)}
                onChange={(checked) => {
                  setSelected((current) => {
                    const next = new Set(current)
                    if (checked) next.add(book.id)
                    else next.delete(book.id)
                    return next
                  })
                }}
                ariaLabel={`选择《${book.title}》`}
              />
              <div className="merge-row-main">
                <strong>{book.title}</strong>
                <span>{book.author || '未知作者'} · {book.chapterCount} 节 · {(book.totalChars / 10000).toFixed(1)} 万字</span>
              </div>
            </div>
          ))}
        </div>

        <div className="merge-fields">
          <label className="import-field">
            合并后的书名
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={chosen[0]?.title ?? '默认使用第一本书的书名'} />
          </label>
          <label className="import-field">
            作者
            <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder={chosen[0]?.author || '可选'} />
          </label>
        </div>
        <p className="import-hint">合并会移动章节和笔记，其他选中的书会从书架移除；原文件不再单独保留。</p>
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        <div className="merge-actions">
          <span className="muted">已选 {chosen.length} 本</span>
          <button type="button" className="primary-button" onClick={() => void merge()} disabled={busy || chosen.length < 2}>
            {busy ? '正在合并…' : '合并书籍'}
          </button>
        </div>
      </div>
    </div>
  )
}
