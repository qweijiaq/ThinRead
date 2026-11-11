import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'

import { t, useLocale } from '../lib/i18n.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import { Checkbox } from './Checkbox.js'

export interface ConfirmRequest {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  checkboxLabel?: string
  checkboxDefault?: boolean
  secondCheckboxLabel?: string
  secondCheckboxDefault?: boolean
}

interface PendingConfirm {
  request: ConfirmRequest
  resolve(value: boolean): void
  optionResolve?: (value: { confirmed: boolean; checked: boolean; secondChecked: boolean }) => void
}

let showConfirm: ((request: ConfirmRequest, resolve: (value: boolean) => void) => void) | null = null
let showOptionConfirm:
  | ((request: ConfirmRequest, resolve: (value: { confirmed: boolean; checked: boolean; secondChecked: boolean }) => void) => void)
  | null = null

export function confirmDialog(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    if (!showConfirm) {
      console.warn('[confirm] ConfirmHost 尚未挂载')
      resolve(false)
      return
    }
    showConfirm(request, resolve)
  })
}

/** 带一个可勾选选项的确认框，用于「重新解析时忽略参考文献」这类操作。 */
export function confirmOptionDialog(
  request: ConfirmRequest & { checkboxLabel: string },
): Promise<{ confirmed: boolean; checked: boolean; secondChecked: boolean }> {
  return new Promise((resolve) => {
    if (!showOptionConfirm) {
      console.warn('[confirm] ConfirmHost 尚未挂载')
      resolve({ confirmed: false, checked: request.checkboxDefault === true, secondChecked: request.secondCheckboxDefault === true })
      return
    }
    showOptionConfirm(request, resolve)
  })
}

export function ConfirmHost(): JSX.Element | null {
  useLocale()
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [checked, setChecked] = useState(false)
  const [secondChecked, setSecondChecked] = useState(false)
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useDialogFocus<HTMLDivElement>(Boolean(pending), () => finish(false), 'button.primary-button')

  useEffect(() => {
    showConfirm = (request, resolve) => setPending({ request, resolve })
    showOptionConfirm = (request, resolve) => {
      setChecked(request.checkboxDefault === true)
      setSecondChecked(request.secondCheckboxDefault === true)
      setPending({ request, resolve: () => undefined, optionResolve: resolve })
    }
    return () => {
      showConfirm = null
      showOptionConfirm = null
    }
  }, [])

  useEffect(() => {
    if (!pending) return
    const frame = window.requestAnimationFrame(() => confirmRef.current?.focus())
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        finish(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
    }
  }, [pending])

  function finish(value: boolean): void {
    setPending((current) => {
      if (current?.optionResolve) current.optionResolve({ confirmed: value, checked, secondChecked })
      else current?.resolve(value)
      return null
    })
  }

  if (!pending) return null
  const request = pending.request
  return createPortal(
    <div className="modal-backdrop confirm-backdrop" onMouseDown={() => finish(false)}>
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title">{t(request.title ?? '确认操作')}</h2>
        <p id="confirm-message">{request.message}</p>
        {request.checkboxLabel ? (
          <div className="confirm-option">
            <Checkbox checked={checked} onChange={setChecked} label={t(request.checkboxLabel)} />
          </div>
        ) : null}
        {request.secondCheckboxLabel ? (
          <div className="confirm-option">
            <Checkbox
              checked={secondChecked}
              onChange={setSecondChecked}
              label={t(request.secondCheckboxLabel)}
            />
          </div>
        ) : null}
        <div className="confirm-actions">
          <button type="button" className="ghost-button" onClick={() => finish(false)}>
            {t(request.cancelLabel ?? '取消')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`primary-button${request.danger ? ' is-danger' : ''}`}
            onClick={() => finish(true)}
          >
            {t(request.confirmLabel ?? '确定')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
