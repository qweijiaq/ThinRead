import { useMemo, useState, type JSX } from 'react'

import type { ContentItem } from '../../shared/types.js'
import { contentToMarkdown } from '../lib/content-view.js'
import { t } from '../lib/i18n.js'
import { diffStats, diffText } from '../lib/text-diff.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import { Select } from './Select.js'

interface VersionDiffDialogProps {
  current: ContentItem
  versions: ContentItem[]
  onClose(): void
}

function formatVersionTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 16).replace('T', ' ')
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function VersionDiffDialog({ current, versions, onClose }: VersionDiffDialogProps): JSX.Element {
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose, 'button')
  const others = useMemo(() => versions.filter((item) => item.id !== current.id), [versions, current.id])
  const [otherId, setOtherId] = useState(others[0]?.id ?? '')
  const other = others.find((item) => item.id === otherId) ?? others[0] ?? null
  const lines = useMemo(
    () => (other ? diffText(contentToMarkdown(other), contentToMarkdown(current)) : []),
    [current, other],
  )
  const stats = useMemo(() => diffStats(lines), [lines])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal version-diff-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('版本对比')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{t('版本对比')}</h2>
            <p className="modal-subtitle">{current.title}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        {other ? (
          <>
            <div className="version-diff-controls">
              <label>
                <span>{t('对比版本')}</span>
                <Select
                  value={other.id}
                  onChange={setOtherId}
                  ariaLabel={t('对比版本')}
                  options={others.map((item) => ({
                    value: item.id,
                    label: `${formatVersionTime(item.updatedAt)} · ${item.title}`,
                  }))}
                />
              </label>
              <span className="version-diff-stats">
                <strong className="is-add">+{stats.added}</strong>
                <strong className="is-remove">−{stats.removed}</strong>
                <span>{stats.unchanged} {t('行未变')}</span>
              </span>
            </div>
            <p className="version-diff-hint">
              {t('左侧是旧版本，右侧是当前版本；红色为删除，绿色为新增。')}
            </p>
            <div className="version-diff-body" role="region" aria-label={t('差异内容')}>
              {lines.map((line, index) => (
                <div key={index} className={`diff-line is-${line.kind}`}>
                  <span className="diff-sign">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span>
                  <span>{line.text || ' '}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="version-diff-empty">{t('没有其他版本可以对比。')}</p>
        )}

        <div className="modal-footer">
          <span className="modal-meta">{t('只比较文本内容，不修改任何版本。')}</span>
          <button type="button" className="ghost-button" onClick={onClose}>
            {t('关闭')}
          </button>
        </div>
      </div>
    </div>
  )
}
