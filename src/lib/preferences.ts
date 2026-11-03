const AUTO_NEXT_KEY = 'reading-notes-auto-next'
const DAILY_GOAL_KEY = 'reading-notes-daily-goal'
const PREFERENCE_EVENT = 'reading-notes-preferences'

function notify(): void {
  try {
    window.dispatchEvent(new Event(PREFERENCE_EVENT))
  } catch {
    // 非浏览器环境（测试）没有 window。
  }
}

export function getAutoNext(): boolean {
  try {
    return localStorage.getItem(AUTO_NEXT_KEY) === '1'
  } catch {
    return false
  }
}

export function setAutoNext(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_NEXT_KEY, enabled ? '1' : '0')
  } catch {
    // 偏好保存失败只影响下次打开。
  }
  notify()
}

/** 每日阅读目标（分钟）。0 表示不设目标。 */
export function getDailyGoal(): number {
  try {
    const value = Number(localStorage.getItem(DAILY_GOAL_KEY))
    if (!Number.isFinite(value) || value <= 0) return 0
    return Math.min(240, Math.round(value))
  } catch {
    return 0
  }
}

export function setDailyGoal(minutes: number): void {
  const next = Number.isFinite(minutes) && minutes > 0 ? Math.min(240, Math.round(minutes)) : 0
  try {
    if (next === 0) localStorage.removeItem(DAILY_GOAL_KEY)
    else localStorage.setItem(DAILY_GOAL_KEY, String(next))
  } catch {
    // 同上。
  }
  notify()
}

export function subscribePreferences(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(PREFERENCE_EVENT, listener)
  return () => window.removeEventListener(PREFERENCE_EVENT, listener)
}
