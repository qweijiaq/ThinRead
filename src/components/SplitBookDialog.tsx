import { useEffect, useMemo, useState, type JSX } from 'react'
import { useDialogFocus } from '../lib/useDialogFocus.js'

import type { BookSummary, ChapterMeta } from '../../shared/types.js'
import { Select } from './Select.js'

interface SplitBookDialogProps {
  open: boolean
  book: BookSummary | null
  chapters: ChapterMeta[]
  onClose(): void
  onSplit(book: BookSummary): void
}

export function SplitBookDialog({ open, book, chapters, onClose, onSplit }: SplitBookDialogProps): JSX.Element | null {
  const options = useMemo(
    () =>
      chapters.slice(1).map((chapter, index) => ({
        value: chapter.id,
        label: `${String(index + 2).padStart(2, '0')} · ${chapter.title}`,
      })),
    [chapters],
  )
  const [fromChapterId, setFromChapterId] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setFromChapterId(options[0]?.value ?? '')
    setTitle(book ? `${book.title} · 下篇` : '')
    setError(null)
  }, [open, book?.id, options])

  const dialogRef = useDialogFocus<HTMLDivElement>(open, () => { if (!busy) onClose() }, 'select')
  if (!open || !book) return null

  async function split(): Promise<void> {
    if (!book || !fromChapterId || busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.api.splitBook(book.id, fromChapterId, title.trim() || `${book.title} · 下篇`)
      onSplit(next)
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
        className="split-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="拆分书籍"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="import-head">
          <div>
            <h2>拆分书籍</h2>
            <p>从选中的章节开始，把后面的章节和笔记移到一本新书。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭">
            ×
          </button>
        </div>
        {options.length === 0 ? (
          <p className="import-hint">这本书只有一章，暂时无法拆分。</p>
        ) : (
          <>
            <label className="import-field">
              新书从哪一章开始
              <Select value={fromChapterId} onChange={setFromChapterId} options={options} ariaLabel="拆分位置" />
            </label>
            <label className="import-field">
              新书书名
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <p className="import-hint">原书保留前面的章节；两本书共用同一份章节和笔记数据，之后可以分别改名。</p>
            <div className="merge-actions">
              <span className="muted">原书：{book.title}</span>
              <button type="button" className="primary-button" onClick={() => void split()} disabled={busy || !fromChapterId}>
                {busy ? '正在拆分…' : '拆分成两本'}
              </button>
            </div>
          </>
        )}
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
      </div>
    </div>
  )
}
