import { bridge } from '../lib/bridge.js'
import { useEffect, useState, type JSX } from 'react'

import type { TrashedBook } from '../../shared/types.js'
import { t } from '../lib/i18n.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import { confirmDialog } from './ConfirmDialog.js'
import { SkeletonRows } from './Skeleton.js'

interface BookTrashDialogProps {
  open: boolean
  onClose(): void
  onChanged(): void
}

function deletedLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function BookTrashDialog({ open, onClose, onChanged }: BookTrashDialogProps): JSX.Element | null {
  const [books, setBooks] = useState<TrashedBook[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose, 'button')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void bridge
      .listTrashedBooks()
      .then((items) => {
        if (!cancelled) setBooks(items)
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

  async function restore(item: TrashedBook): Promise<void> {
    if (busy) return
    setBusy(item.id)
    setError(null)
    try {
      const book = await bridge.restoreTrashedBook(item.id)
      if (!book) throw new Error(t('这本书已经存在，无法恢复。'))
      setBooks((current) => current.filter((entry) => entry.id !== item.id))
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function purge(item: TrashedBook): Promise<void> {
    if (busy) return
    const confirmed = await confirmDialog({
      title: t('彻底删除书籍'),
      message: `${t('彻底删除')}《${item.title}》${t('及其')} ${item.chapterCount} ${t('节、')}${item.noteCount} ${t('条笔记？删除后无法恢复。')}`,
      confirmLabel: t('彻底删除'),
      danger: true,
    })
    if (!confirmed) return
    setBusy(item.id)
    setError(null)
    try {
      await bridge.purgeTrashedBook(item.id)
      setBooks((current) => current.filter((entry) => entry.id !== item.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function empty(): Promise<void> {
    if (busy || books.length === 0) return
    const confirmed = await confirmDialog({
      title: t('清空书籍回收站'),
      message: `${t('彻底删除')} ${books.length} ${t('本书及其章节、笔记？删除后无法恢复。')}`,
      confirmLabel: t('清空'),
      danger: true,
    })
    if (!confirmed) return
    setBusy('empty')
    setError(null)
    try {
      await bridge.emptyBookTrash()
      setBooks([])
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
        aria-label={t('最近删除的书籍')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{t('书籍回收站')}</h2>
            <p className="trash-hint">{t('删除的书籍、章节和笔记会保留 30 天，恢复后文件和笔记一起回来。')}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={Boolean(busy)} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        {loading ? (
          <div className="trash-loading" role="status" aria-busy="true">
            <span className="sr-only">{t('正在加载…')}</span>
            <SkeletonRows rows={3} />
          </div>
        ) : null}
        {!loading && books.length === 0 ? <p className="trash-empty">{t('回收站是空的。')}</p> : null}

        {books.length > 0 ? (
          <div className="trash-list">
            {books.map((item) => (
              <article key={item.id} className="trash-row">
                <div className="trash-row-main">
                  <div className="trash-row-head">
                    <strong>{item.title}</strong>
                    <span className="kind-badge">{item.format.toUpperCase()}</span>
                  </div>
                  <p className="trash-row-meta">
                    {item.author || t('未知作者')} · {item.chapterCount} {t('节')} · {item.noteCount} {t('条笔记')} · {t('删除于')} {deletedLabel(item.deletedAt)}
                  </p>
                </div>
                <div className="trash-row-actions">
                  <button type="button" className="text-button" onClick={() => void restore(item)} disabled={Boolean(busy)}>
                    {busy === item.id ? t('处理中…') : t('恢复')}
                  </button>
                  <button type="button" className="text-button muted" onClick={() => void purge(item)} disabled={Boolean(busy)}>
                    {t('彻底删除')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        <div className="trash-foot">
          <span className="muted">{books.length > 0 ? `${books.length} ${t('本书')}` : ''}</span>
          <button type="button" className="ghost-button small" onClick={() => void empty()} disabled={books.length === 0 || Boolean(busy)}>
            {busy === 'empty' ? t('清理中…') : t('清空回收站')}
          </button>
        </div>
      </div>
    </div>
  )
}
