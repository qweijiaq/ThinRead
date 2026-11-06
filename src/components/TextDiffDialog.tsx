import { useMemo, type JSX } from 'react'

import { t } from '../lib/i18n.js'
import { diffStats, diffText } from '../lib/text-diff.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'

interface TextDiffDialogProps {
  title: string
  before: string
  after: string
  applyLabel?: string
  onApply?(): void
  onClose(): void
}

export function TextDiffDialog({
  title,
  before,
  after,
  applyLabel,
  onApply,
  onClose,
}: TextDiffDialogProps): JSX.Element {
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose, 'button')
  const lines = useMemo(() => diffText(before, after), [before, after])
  const stats = useMemo(() => diffStats(lines), [lines])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal version-diff-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            <p className="modal-subtitle">{t('只比较文本内容，不修改任何版本。')}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        <div className="version-diff-controls">
          <span className="version-diff-stats">
            <strong className="is-add">+{stats.added}</strong>
            <strong className="is-remove">−{stats.removed}</strong>
            <span>{stats.unchanged} {t('行未变')}</span>
          </span>
        </div>
        <p className="version-diff-hint">
          {t('左侧是改写前，右侧是改写后；红色为删除，绿色为新增。')}
        </p>
        <div className="version-diff-body" role="region" aria-label={t('差异内容')}>
          {lines.map((line, index) => (
            <div key={index} className={`diff-line is-${line.kind}`}>
              <span className="diff-sign">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span>
              <span>{line.text || ' '}</span>
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <span className="modal-meta">{t('确认后只替换选中的片段。')}</span>
          <div className="modal-footer-actions">
            <button type="button" className="ghost-button" onClick={onClose}>
              {t('取消')}
            </button>
            {onApply ? (
              <button type="button" className="primary-button" onClick={onApply}>
                {applyLabel ?? t('应用改写')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
