import { useEffect, useState, type JSX } from 'react'

import type { TrashedChapter } from '../../shared/types.js'
import { t } from '../lib/i18n.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import { confirmDialog } from './ConfirmDialog.js'

interface ChapterTrashDialogProps {
  open: boolean
  onClose(): void
  onChanged(): void
}

function deletedLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function ChapterTrashDialog({ open, onClose, onChanged }: ChapterTrashDialogProps): JSX.Element | null {
  const [chapters, setChapters] = useState<TrashedChapter[]>([])
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
      .listTrashedChapters()
      .then((items) => {
        if (!cancelled) setChapters(items)
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

  async function restore(item: TrashedChapter): Promise<void> {
    if (busy) return
    setBusy(item.id)
    setError(null)
    try {
      const chapter = await window.api.restoreTrashedChapter(item.id)
      if (!chapter) throw new Error(t('原书已经不存在，无法恢复这个章节。'))
      setChapters((current) => current.filter((entry) => entry.id !== item.id))
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function purge(item: TrashedChapter): Promise<void> {
    if (busy) return
    const confirmed = await confirmDialog({
      title: t('彻底删除章节'),
      message: `${t('彻底删除')}「${item.title}」${t('及其')} ${item.noteCount} ${t('条笔记？删除后无法恢复。')}`,
      confirmLabel: t('彻底删除'),
      danger: true,
    })
    if (!confirmed) return
    setBusy(item.id)
    setError(null)
    try {
      await window.api.purgeTrashedChapter(item.id)
      setChapters((current) => current.filter((entry) => entry.id !== item.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function empty(): Promise<void> {
    if (busy || chapters.length === 0) return
    const confirmed = await confirmDialog({
      title: t('清空章节回收站'),
      message: `${t('彻底删除')} ${chapters.length} ${t('个章节及其笔记？删除后无法恢复。')}`,
      confirmLabel: t('清空'),
      danger: true,
    })
    if (!confirmed) return
    setBusy('empty')
    setError(null)
    try {
      await window.api.emptyChapterTrash()
      setChapters([])
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
        aria-label={t('最近删除的章节')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{t('章节回收站')}</h2>
            <p className="trash-hint">{t('删除的章节、笔记、书签和标记会保留 30 天。')}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={Boolean(busy)} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        {loading ? <p className="trash-empty">{t('正在加载…')}</p> : null}
        {!loading && chapters.length === 0 ? <p className="trash-empty">{t('回收站是空的。')}</p> : null}

        {chapters.length > 0 ? (
          <div className="trash-list">
            {chapters.map((item) => (
              <article key={item.id} className="trash-row">
                <div className="trash-row-main">
                  <div className="trash-row-head">
                    <strong>{item.title}</strong>
                  </div>
                  <p className="trash-row-meta">
                    {item.bookTitle} · {item.noteCount} {t('条笔记')} · {t('删除于')} {deletedLabel(item.deletedAt)}
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
          <span className="muted">{chapters.length > 0 ? `${chapters.length} ${t('个章节')}` : ''}</span>
          <button type="button" className="ghost-button small" onClick={() => void empty()} disabled={chapters.length === 0 || Boolean(busy)}>
            {busy === 'empty' ? t('清理中…') : t('清空回收站')}
          </button>
        </div>
      </div>
    </div>
  )
}
