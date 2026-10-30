import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'

export interface ConfirmRequest {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface PendingConfirm {
  request: ConfirmRequest
  resolve(value: boolean): void
}

let showConfirm: ((request: ConfirmRequest, resolve: (value: boolean) => void) => void) | null = null

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

export function ConfirmHost(): JSX.Element | null {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    showConfirm = (request, resolve) => setPending({ request, resolve })
    return () => {
      showConfirm = null
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
      current?.resolve(value)
      return null
    })
  }

  if (!pending) return null
  const request = pending.request
  return createPortal(
    <div className="modal-backdrop confirm-backdrop" onMouseDown={() => finish(false)}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title">{request.title ?? '确认操作'}</h2>
        <p id="confirm-message">{request.message}</p>
        <div className="confirm-actions">
          <button type="button" className="ghost-button" onClick={() => finish(false)}>
            {request.cancelLabel ?? '取消'}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`primary-button${request.danger ? ' is-danger' : ''}`}
            onClick={() => finish(true)}
          >
            {request.confirmLabel ?? '确定'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
