import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 模态框的焦点圈定、Esc 关闭和关闭后焦点归还。 */
export function useDialogFocus<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  initialSelector?: string,
): RefObject<T | null> {
  const rootRef = useRef<T | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const initialRef = useRef(initialSelector)
  initialRef.current = initialSelector

  useEffect(() => {
    if (!open) return
    const root = rootRef.current
    if (!root) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const timer = window.setTimeout(() => {
      const target =
        (initialRef.current ? root.querySelector<HTMLElement>(initialRef.current) : null) ??
        root.querySelector<HTMLElement>('[data-autofocus]') ??
        root.querySelector<HTMLElement>(FOCUSABLE)
      target?.focus()
    }, 30)

    function focusable(): HTMLElement[] {
      return [...root!.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null)
    }

    function onKey(event: KeyboardEvent): void {
      const dialogs = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')]
      if (dialogs[dialogs.length - 1] !== root) return
      if (event.key === 'Escape') {
        // Select 的弹层挂在 body 上；Esc 应先关弹层，而不是整个对话框。
        if (document.querySelector('.ui-select-popover')) return
        const active = document.activeElement
        if (!root!.contains(active) && !root!.contains(event.target as Node)) return
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      if (!root!.contains(document.activeElement)) return
      const list = focusable()
      if (list.length === 0) {
        event.preventDefault()
        return
      }
      const first = list[0]!
      const last = list[list.length - 1]!
      if (event.shiftKey && (document.activeElement === first || !root!.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !root!.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKey, true)
      if (previous?.isConnected) previous.focus()
    }
  }, [open])

  return rootRef
}
