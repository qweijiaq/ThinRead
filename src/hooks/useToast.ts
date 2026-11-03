import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

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
 * 注意它仍然是“单槽位”——新的提示会覆盖旧的（包括撤销按钮），这是已知取舍。
 */
export function useToast(): [ToastState | null, Dispatch<SetStateAction<ToastState | null>>] {
  const [toast, setToast] = useState<ToastState | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), toast.action ? ACTION_MS : PLAIN_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  return [toast, setToast]
}
