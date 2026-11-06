import { useState, type FormEvent, type JSX } from 'react'

import { t } from '../lib/i18n.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'

interface CompareModelDialogProps {
  suggestions: string[]
  busy: boolean
  error: string | null
  onCompare(model: string): void
  onClose(): void
}

export function CompareModelDialog({
  suggestions,
  busy,
  error,
  onCompare,
  onClose,
}: CompareModelDialogProps): JSX.Element {
  const dialogRef = useDialogFocus<HTMLFormElement>(true, onClose, 'input, button')
  const [model, setModel] = useState(suggestions[0] ?? '')

  function submit(event: FormEvent): void {
    event.preventDefault()
    const value = model.trim()
    if (!value || busy) return
    onCompare(value)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        ref={dialogRef}
        className="modal compare-model-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('模型对比')}
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{t('模型对比')}</h2>
            <p className="modal-subtitle">{t('用另一个模型重跑本章，不会覆盖当前笔记。')}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        <div className="form-row">
          <label>{t('对比模型 ID')}</label>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            list="compare-model-options"
            placeholder={t('例如 deepseek-chat')}
            spellCheck={false}
            autoFocus
          />
          <datalist id="compare-model-options">
            {suggestions.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
          {suggestions.length > 0 ? (
            <div className="compare-model-chips">
              {suggestions.map((id) => (
                <button key={id} type="button" onClick={() => setModel(id)}>
                  {id}
                </button>
              ))}
            </div>
          ) : null}
          <p className="field-hint">
            {t('对比会消耗一次模型调用；结果会存到内容库，结束后直接打开差异。')}
          </p>
        </div>

        {error ? <div className="inline-error" role="alert">{error}</div> : null}

        <div className="modal-footer">
          <button type="button" className="ghost-button" onClick={onClose}>
            {t('取消')}
          </button>
          <button type="submit" className="primary-button" disabled={busy || !model.trim()}>
            {busy ? t('生成中…') : t('开始对比')}
          </button>
        </div>
      </form>
    </div>
  )
}
