import { useEffect, useState, type JSX } from 'react'

import type { DoclingProgressEvent } from '../../shared/types.js'
import { t } from '../lib/i18n.js'

interface DeepParseOverlayProps {
  open: boolean
  title: string
  startedAt: number
  progress: DoclingProgressEvent | null
  onCancel?(): void
}

function phaseLabel(progress: DoclingProgressEvent | null): string {
  if (!progress) return t('正在准备 Docling…')
  if (progress.phase === 'pages') {
    if (progress.total && progress.total > 0) {
      return `${t('正在分析版面')} ${progress.done ?? 0} / ${progress.total} ${t('页')}`
    }
    return t('正在分析版面')
  }
  switch (progress.phase) {
    case 'initialize':
      return t('正在加载版面模型…')
    case 'build':
      return t('正在识别段落、表格和图表…')
    case 'assemble':
      return t('正在组装章节…')
    case 'enrich':
      return t('正在处理图表和表格…')
    case 'done':
      return t('正在写入书籍…')
    default:
      return t('正在解析…')
  }
}

function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function DeepParseOverlay({ open, title, startedAt, progress, onCancel }: DeepParseOverlayProps): JSX.Element | null {
  const [now, setNow] = useState(Date.now())
  const [cancelling, setCancelling] = useState(false)
  useEffect(() => {
    if (!open) {
      setCancelling(false)
      return
    }
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [open])
  if (!open) return null

  const percent =
    progress?.phase === 'pages' && progress.total && progress.total > 0
      ? Math.min(100, Math.round(((progress.done ?? 0) / progress.total) * 100))
      : null

  return (
    <div className="modal-backdrop deep-parse-backdrop">
      <div className="modal deep-parse-modal" role="dialog" aria-modal="true" aria-label={t('正在深度解析 PDF')}>
        <div className="deep-parse-head">
          <div>
            <h2>{t('正在深度解析 PDF')}</h2>
            <p className="modal-subtitle">{title}</p>
          </div>
          <span className="deep-parse-time">{elapsedLabel(now - startedAt)}</span>
        </div>
        <p className="deep-parse-phase">{phaseLabel(progress)}</p>
        <div className={`deep-parse-bar${percent === null ? ' is-indeterminate' : ''}`}>
          <span style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
        <p className="deep-parse-hint">
          {t('Docling 会重新分析版面、表格和图表。一本几百页的书通常需要 1–3 分钟，请不要关闭应用。')}
        </p>
        {onCancel ? (
          <div className="deep-parse-actions">
            <button
              type="button"
              className="ghost-button"
              disabled={cancelling}
              onClick={() => {
                setCancelling(true)
                onCancel()
              }}
            >
              {cancelling ? t('正在取消…') : t('取消解析')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
