const STORAGE_KEY = 'reading-notes-reading-stats'
const RECENT_DAYS = 14

interface StoredStats {
  total: number
  days: Record<string, number>
  books: Record<string, number>
}

function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function load(): StoredStats {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<StoredStats>
    const days: Record<string, number> = {}
    if (parsed.days && typeof parsed.days === 'object') {
      for (const [key, value] of Object.entries(parsed.days)) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) days[key] = value
      }
    }
    const books: Record<string, number> = {}
    if (parsed.books && typeof parsed.books === 'object') {
      for (const [key, value] of Object.entries(parsed.books)) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) books[key] = value
      }
    }
    return {
      total: typeof parsed.total === 'number' && parsed.total > 0 ? parsed.total : 0,
      days,
      books,
    }
  } catch {
    return { total: 0, days: {}, books: {} }
  }
}

function save(stats: StoredStats): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats))
  } catch {
    // 本地统计只是辅助信息，写入失败不影响阅读。
  }
}

function mergeStats(left: StoredStats, right: Partial<StoredStats>): StoredStats {
  const days: Record<string, number> = { ...left.days }
  for (const [key, value] of Object.entries(right.days ?? {})) {
    const seconds = Math.floor(Number(value))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(seconds) || seconds <= 0) continue
    days[key] = Math.max(days[key] ?? 0, seconds)
  }
  const books: Record<string, number> = { ...left.books }
  for (const [key, value] of Object.entries(right.books ?? {})) {
    const seconds = Math.floor(Number(value))
    if (!key || !Number.isFinite(seconds) || seconds <= 0) continue
    books[key] = Math.max(books[key] ?? 0, seconds)
  }
  const summed = Object.values(days).reduce((sum, value) => sum + value, 0)
  return {
    total: Math.max(left.total, Math.floor(Number(right.total) || 0), summed),
    days,
    books,
  }
}

/** 应用启动时同步统计：数据库为空时用本机缓存做首次迁移；否则以数据库为准，保证备份恢复可回滚。 */
export async function hydrateReadingStats(): Promise<void> {
  if (typeof window === 'undefined' || !window.api?.getReadingStats) return
  try {
    const local = load()
    const remote = await window.api.getReadingStats()
    const hasRemote =
      remote.total > 0 || Object.keys(remote.days).length > 0 || Object.keys(remote.books).length > 0
    if (!hasRemote) {
      const merged = mergeStats(local, remote)
      save(merged)
      await window.api.mergeReadingStats(merged)
      return
    }
    save({
      total: Math.max(0, Math.floor(Number(remote.total) || 0)),
      days: { ...remote.days },
      books: { ...remote.books },
    })
  } catch {
    // 统计同步失败不阻塞启动；下一次阅读会继续写入本地缓存。
  }
}

/** 累加阅读秒数；日期按本地时区归档。数据会同时写 localStorage 缓存和主进程数据库。 */
export function addReadingSeconds(seconds: number, bookId?: string | null): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return
  const stats = load()
  const date = new Date()
  const key = dateKey(date)
  stats.total += seconds
  stats.days[key] = (stats.days[key] ?? 0) + seconds
  if (bookId) stats.books[bookId] = (stats.books[bookId] ?? 0) + seconds
  save(stats)
  if (typeof window !== 'undefined' && window.api?.recordReading) {
    void window.api.recordReading(key, seconds, bookId ?? null).catch(() => undefined)
  }
}

function shiftKey(key: string, delta: number): string {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year!, (month ?? 1) - 1, day ?? 1)
  date.setDate(date.getDate() + delta)
  return dateKey(date)
}

function computeStreaks(days: Record<string, number>): { current: number; longest: number } {
  const today = dateKey(new Date())
  let cursor = (days[today] ?? 0) > 0 ? today : shiftKey(today, -1)
  let current = 0
  while ((days[cursor] ?? 0) > 0) {
    current++
    cursor = shiftKey(cursor, -1)
  }

  let longest = 0
  let run = 0
  let previous = ''
  for (const key of Object.keys(days).sort()) {
    if ((days[key] ?? 0) <= 0) continue
    run = previous && shiftKey(previous, 1) === key ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = key
  }
  return { current, longest }
}

export interface ReadingDay {
  date: string
  seconds: number
}

export interface ReadingBook {
  bookId: string
  seconds: number
}

export interface ReadingSummary {
  todaySeconds: number
  weekSeconds: number
  monthSeconds: number
  totalSeconds: number
  currentStreak: number
  longestStreak: number
  days: ReadingDay[]
  books: ReadingBook[]
}

/** 今日、最近 7 天、本月、累计，以及最近 14 天和按书的明细。 */
export function getReadingSummary(): ReadingSummary {
  const stats = load()
  const today = new Date()
  const todayKey = dateKey(today)
  const monthPrefix = todayKey.slice(0, 7)
  let week = 0
  const days: ReadingDay[] = []
  for (let offset = RECENT_DAYS - 1; offset >= 0; offset--) {
    const date = new Date(today)
    date.setDate(date.getDate() - offset)
    const key = dateKey(date)
    const seconds = stats.days[key] ?? 0
    days.push({ date: key, seconds })
    if (offset < 7) week += seconds
  }
  const month = Object.entries(stats.days).reduce(
    (sum, [key, seconds]) => (key.startsWith(monthPrefix) ? sum + seconds : sum),
    0,
  )
  const streaks = computeStreaks(stats.days)
  const books = Object.entries(stats.books)
    .map(([bookId, seconds]) => ({ bookId, seconds }))
    .sort((a, b) => b.seconds - a.seconds)
  return {
    todaySeconds: stats.days[todayKey] ?? 0,
    weekSeconds: week,
    monthSeconds: month,
    totalSeconds: stats.total,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    days,
    books,
  }
}

export interface ReadingMonth {
  label: string
  seconds: number
  days: ReadingDay[]
}

/** 某个月的每日阅读量；offset=0 表示本月，-1 表示上个月。 */
export function getReadingMonth(offset = 0): ReadingMonth {
  const stats = load()
  const base = new Date()
  base.setDate(1)
  base.setMonth(base.getMonth() + offset)
  const year = base.getFullYear()
  const month = base.getMonth()
  const count = new Date(year, month + 1, 0).getDate()
  const days: ReadingDay[] = []
  let seconds = 0
  for (let day = 1; day <= count; day++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const value = stats.days[key] ?? 0
    seconds += value
    days.push({ date: key, seconds: value })
  }
  return { label: `${year}-${String(month + 1).padStart(2, '0')}`, seconds, days }
}

export interface ReadingYear {
  year: number
  seconds: number
  activeDays: number
  bestMonth: { month: string; seconds: number } | null
  months: Array<{ month: string; seconds: number }>
}

/** 某一年的每月阅读量；offset=0 表示今年，-1 表示去年。 */
export function getReadingYear(offset = 0): ReadingYear {
  const stats = load()
  const year = new Date().getFullYear() + offset
  const months = Array.from({ length: 12 }, (_, index) => {
    const prefix = `${year}-${String(index + 1).padStart(2, '0')}`
    let seconds = 0
    for (const [key, value] of Object.entries(stats.days)) {
      if (key.startsWith(prefix)) seconds += value
    }
    return { month: prefix, seconds }
  })
  const prefix = `${year}-`
  const activeDays = Object.entries(stats.days).filter(
    ([key, seconds]) => key.startsWith(prefix) && seconds > 0,
  ).length
  const bestMonth =
    months.reduce<{ month: string; seconds: number } | null>(
      (best, item) => (item.seconds > 0 && (!best || item.seconds > best.seconds) ? item : best),
      null,
    )
  return {
    year,
    seconds: months.reduce((sum, month) => sum + month.seconds, 0),
    activeDays,
    bestMonth,
    months,
  }
}

/** 把秒数变成分钟；不足一分钟按 0 处理。 */
export function readingMinutes(seconds: number): number {
  return Math.floor(seconds / 60)
}

/** 把某个月的每日阅读量导出成 CSV。 */
export function readingCsv(month: ReadingMonth): string {
  return ['date,seconds', ...month.days.map((day) => `${day.date},${day.seconds}`)].join('\n')
}

export const STREAK_MILESTONES = [7, 30, 100] as const

/** 下一个连续阅读里程碑；已经达到 100 天时返回 null。 */
export function nextStreakMilestone(current: number): { next: number; remaining: number } | null {
  const next = STREAK_MILESTONES.find((value) => current < value)
  return next ? { next, remaining: next - current } : null
}

/** 已解锁的连续阅读里程碑。 */
export function unlockedMilestones(longest: number): number[] {
  return STREAK_MILESTONES.filter((value) => longest >= value)
}
