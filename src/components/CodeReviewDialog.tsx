import { useState, type JSX } from 'react'

import { t } from '../lib/i18n.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import { Markdown } from './Markdown.js'

interface CodeReviewDialogProps {
  open: boolean
  loading: boolean
  code: string
  language: string
  review: string
  error: string | null
  model: string
  onClose(): void
}

export function CodeReviewDialog({
  open,
  loading,
  code,
  language,
  review,
  error,
  model,
  onClose,
}: CodeReviewDialogProps): JSX.Element | null {
  const [copied, setCopied] = useState(false)
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose, 'button')
  if (!open) return null

  async function copyReview(): Promise<void> {
    if (!review) return
    await window.api.copyText(review)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal code-review-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('代码检查')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{t('代码检查')}</h2>
            <p className="modal-subtitle">
              {language ? `${language.toUpperCase()} · ` : ''}
              {loading ? t('正在检查代码…') : model ? `${t('使用')} ${model}` : ''}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        <details className="code-review-source">
          <summary>{t('查看这段代码')}</summary>
          <pre>
            <code>{code.slice(0, 12_000)}</code>
          </pre>
        </details>

        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        {loading ? (
          <div className="code-review-loading">
            <span className="code-review-spinner" aria-hidden="true" />
            <p>{t('正在检查语法、符号、拼写和缺漏字符，通常需要十几秒。')}</p>
          </div>
        ) : (
          <div className="code-review-body markdown">
            <Markdown text={review} />
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="text-button" onClick={() => void copyReview()} disabled={!review || loading}>
            {copied ? t('已复制') : t('复制检查结果')}
          </button>
          <div className="modal-footer-actions">
            <button type="button" className="primary-button" onClick={onClose}>
              {t('关闭')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
