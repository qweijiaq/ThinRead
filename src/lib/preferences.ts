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

function readAutoNextRaw(): string | null {
  try {
    return localStorage.getItem(AUTO_NEXT_KEY)
  } catch {
    return null
  }
}

function readDailyGoalRaw(): string | null {
  try {
    return localStorage.getItem(DAILY_GOAL_KEY)
  } catch {
    return null
  }
}

/** 启动时合并主进程保存的偏好；本机已有值时优先保留本机，避免首次迁移丢失。 */
export async function hydratePreferences(): Promise<void> {
  if (typeof window === 'undefined' || !window.api?.getUiPreferences) return
  try {
    const remote = await window.api.getUiPreferences()
    const localAuto = readAutoNextRaw()
    const localGoal = readDailyGoalRaw()
    const autoNext = remote.configured
      ? remote.autoNext
      : localAuto === null
        ? remote.autoNext
        : localAuto === '1'
    const rawGoal = remote.configured
      ? remote.dailyGoal
      : localGoal === null
        ? remote.dailyGoal
        : Number(localGoal)
    const dailyGoal = Number.isFinite(rawGoal) && rawGoal > 0 ? Math.min(240, Math.round(rawGoal)) : 0
    try {
      localStorage.setItem(AUTO_NEXT_KEY, autoNext ? '1' : '0')
      if (dailyGoal === 0) localStorage.removeItem(DAILY_GOAL_KEY)
      else localStorage.setItem(DAILY_GOAL_KEY, String(dailyGoal))
    } catch {
      // 本地缓存写不进去时仍然使用合并后的值。
    }
    await window.api.saveUiPreferences({ autoNext, dailyGoal })
    notify()
  } catch {
    // 偏好同步失败不阻塞启动。
  }
}

export function getAutoNext(): boolean {
  return readAutoNextRaw() === '1'
}

export function setAutoNext(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_NEXT_KEY, enabled ? '1' : '0')
  } catch {
    // 偏好保存失败只影响下次打开。
  }
  if (typeof window !== 'undefined' && window.api?.saveUiPreferences) {
    void window.api.saveUiPreferences({ autoNext: enabled }).catch(() => undefined)
  }
  notify()
}

/** 每日阅读目标（分钟）。0 表示不设目标。 */
export function getDailyGoal(): number {
  const value = Number(readDailyGoalRaw())
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(240, Math.round(value))
}

export function setDailyGoal(minutes: number): void {
  const next = Number.isFinite(minutes) && minutes > 0 ? Math.min(240, Math.round(minutes)) : 0
  try {
    if (next === 0) localStorage.removeItem(DAILY_GOAL_KEY)
    else localStorage.setItem(DAILY_GOAL_KEY, String(next))
  } catch {
    // 同上。
  }
  if (typeof window !== 'undefined' && window.api?.saveUiPreferences) {
    void window.api.saveUiPreferences({ dailyGoal: next }).catch(() => undefined)
  }
  notify()
}

export function subscribePreferences(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(PREFERENCE_EVENT, listener)
  return () => window.removeEventListener(PREFERENCE_EVENT, listener)
}
