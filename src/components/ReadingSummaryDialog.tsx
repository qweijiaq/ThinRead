import { useCallback, useEffect, useState, type JSX } from 'react'

import type { SessionSummary } from '../../shared/types.js'
import { t } from '../lib/i18n.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import { Markdown } from './Markdown.js'

interface ReadingSummaryDialogProps {
  chapterId: string
  bookTitle: string
  chapterTitle: string
  minutes: number
  onSave(title: string, markdown: string): Promise<void>
  onClose(): void
}

export function ReadingSummaryDialog({
  chapterId,
  bookTitle,
  chapterTitle,
  minutes,
  onSave,
  onClose,
}: ReadingSummaryDialogProps): JSX.Element {
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose, 'button')
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSaved(false)
    try {
      setSummary(await window.api.generateSessionSummary({ chapterId, minutes }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [chapterId, minutes])

  useEffect(() => {
    void load()
    return () => {
      void window.api.cancelSessionSummary()
    }
  }, [load])

  async function save(): Promise<void> {
    if (!summary || saving || saved) return
    setSaving(true)
    setError(null)
    try {
      await onSave(summary.title, summary.markdown)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function copy(): Promise<void> {
    if (!summary) return
    try {
      await window.api.copyText(summary.markdown)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal reading-summary-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('阅读小结')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{t('阅读小结')}</h2>
            <p className="modal-subtitle">
              {bookTitle} · {chapterTitle} · {t('约')} {minutes} {t('分钟')}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        <p className="reading-summary-hint">
          {t('把这次阅读里读到的、没想通的、下一步要做的留下。')}
        </p>

        {loading ? <p className="lab-empty">{t('正在整理这次阅读…')}</p> : null}
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        {summary ? (
          <div className="reading-summary-body">
            <Markdown text={summary.markdown} />
          </div>
        ) : null}

        <div className="modal-footer">
          <span className="modal-meta">{t('小结会保存为当前章节的一条笔记，不会修改正文。')}</span>
          <div className="modal-footer-actions">
            <button type="button" className="text-button" onClick={() => void copy()} disabled={!summary}>
              {copied ? t('已复制') : t('复制全文')}
            </button>
            <button type="button" className="ghost-button" onClick={() => void load()} disabled={loading}>
              {loading ? t('正在生成…') : t('重新生成')}
            </button>
            <button type="button" className="ghost-button" onClick={onClose}>
              {t('关闭')}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => void save()}
              disabled={!summary || saving || saved}
            >
              {saved ? t('已保存') : saving ? t('保存中…') : t('存为笔记')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
