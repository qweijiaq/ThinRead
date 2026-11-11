import { useState, type JSX } from 'react'

import { t } from '../lib/i18n.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'

interface GenerationPreflightProps {
  open: boolean
  title: string
  chars: number
  model: string
  provider: string
  mode: 'fast' | 'standard' | 'deep'
  images: number
  pricing?: { inputPerMTokens: number; outputPerMTokens: number }
  onConfirm(dontAsk: boolean): void
  onCancel(): void
  onOpenSettings(): void
}

function modeLabel(mode: GenerationPreflightProps['mode']): string {
  return mode === 'fast' ? t('快速') : mode === 'deep' ? t('精读') : t('标准')
}

export function GenerationPreflight({
  open,
  title,
  chars,
  model,
  provider,
  mode,
  images,
  pricing,
  onConfirm,
  onCancel,
  onOpenSettings,
}: GenerationPreflightProps): JSX.Element | null {
  const [dontAsk, setDontAsk] = useState(false)
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onCancel, 'button')
  if (!open) return null

  const inputTokens = Math.ceil(chars * 1.35 + 1_800 + images * 900)
  const outputTokens = Math.ceil(Math.max(1, chars) * 0.6)
  const cost =
    pricing && (pricing.inputPerMTokens > 0 || pricing.outputPerMTokens > 0)
      ? (inputTokens * pricing.inputPerMTokens + outputTokens * pricing.outputPerMTokens) / 1_000_000
      : null

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className="modal preflight-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('开始生成前')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{t('开始读薄这一章？')}</h2>
            <p className="modal-subtitle">{title}</p>
          </div>
          <button type="button" className="icon-button" onClick={onCancel} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        <div className="preflight-grid">
          <span>{t('模型')}</span>
          <strong>{model}</strong>
          <span>{t('服务商')}</span>
          <strong>{provider}</strong>
          <span>{t('档位')}</span>
          <strong>{modeLabel(mode)}</strong>
          <span>{t('预计输入')}</span>
          <strong>~{inputTokens.toLocaleString()} tokens</strong>
          <span>{t('预计输出')}</span>
          <strong>~{outputTokens.toLocaleString()} tokens</strong>
          <span>{t('预计费用')}</span>
          <strong>{cost === null ? t('未填写价格，无法估算') : cost < 0.01 ? `< ¥0.01` : `约 ¥${cost.toFixed(2)}`}</strong>
        </div>

        <div className="preflight-notice">
          <strong>{t('会发送什么')}</strong>
          <p>
            {t('本章正文约')} {chars.toLocaleString()} {t('字')}
            {images > 0 ? `，${images} ${t('张图片')}` : ''}
            {t('会发送给你配置的模型服务商。书和笔记本身仍保存在本机。')}
          </p>
        </div>

        <label className="preflight-check">
          <input type="checkbox" checked={dontAsk} onChange={(event) => setDontAsk(event.target.checked)} />
          <span>{t('本次会话不再提示')}</span>
        </label>

        <div className="modal-footer">
          <button type="button" className="text-button" onClick={onOpenSettings}>
            {t('打开模型设置')}
          </button>
          <div className="modal-footer-actions">
            <button type="button" className="ghost-button small" onClick={onCancel}>
              {t('取消')}
            </button>
            <button type="button" className="primary-button small" onClick={() => onConfirm(dontAsk)}>
              {t('开始生成')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
