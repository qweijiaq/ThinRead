import { useEffect, useRef, useState, type JSX } from 'react'
import { useDialogFocus } from '../lib/useDialogFocus.js'

interface RenameDialogProps {
  open: boolean
  title: string
  label: string
  value: string
  onSave(value: string): Promise<void>
  onClose(): void
}

export function RenameDialog({ open, title, label, value, onSave, onClose }: RenameDialogProps): JSX.Element | null {
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setDraft(value)
    setError(null)
    setSaving(false)
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 30)
    return () => window.clearTimeout(timer)
  }, [open, value])

  const dialogRef = useDialogFocus<HTMLFormElement>(open, onClose, 'input')

  if (!open) return null

  async function submit(): Promise<void> {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        ref={dialogRef}
        className="modal rename-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="form-row">
          <label>{label}</label>
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
            }}
            maxLength={200}
            aria-label={label}
          />
        </div>
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        <div className="modal-footer">
          <span className="modal-meta">最多 200 个字</span>
          <div className="modal-footer-actions">
            <button type="button" className="ghost-button" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="primary-button" disabled={saving || !draft.trim()}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
