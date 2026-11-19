import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

export interface ToastAction {
  label: string
  onClick(): void
}

export interface ToastState {
  kind: 'error' | 'info'
  text: string
  action?: ToastAction
}

const PLAIN_MS = 5200
const ACTION_MS = 9000

/**
 * 全局提示条：负责自动消失的计时。单独抽出来，App 里只保留展示和触发。
 * 可撤销提示不会被普通信息提示顶掉；普通提示会排在它消失后再显示。
 */
export function useToast(): [ToastState | null, Dispatch<SetStateAction<ToastState | null>>] {
  const [toast, setToastState] = useState<ToastState | null>(null)
  const pendingRef = useRef<ToastState[]>([])

  const setToast = useCallback<Dispatch<SetStateAction<ToastState | null>>>((value) => {
    setToastState((current) => {
      const next = typeof value === 'function' ? value(current) : value
      // 可撤销提示还在显示时，普通信息提示排队；错误提示仍然立即显示。
      if (current?.action && next?.kind === 'info' && !next.action) {
        pendingRef.current = [...pendingRef.current, next].slice(-4)
        return current
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => {
      const [queued, ...rest] = pendingRef.current
      pendingRef.current = rest
      setToastState(queued ?? null)
    }, toast.action ? ACTION_MS : PLAIN_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  return [toast, setToast]
}
