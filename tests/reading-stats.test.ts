import assert from 'node:assert/strict'
import test from 'node:test'

import { addReadingSeconds, getReadingMonth, getReadingSummary, getReadingYear, hydrateReadingStats, nextStreakMilestone, readingCsv, readingMinutes, unlockedMilestones } from '../src/lib/reading-stats.js'

function installStorage(): () => void {
  const map = new Map<string, string>()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, String(value)),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
      key: (index: number) => [...map.keys()][index] ?? null,
      get length() {
        return map.size
      },
    } as Storage,
  })
  return () => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
}

test('accumulates today, week and total reading time', () => {
  const restore = installStorage()
  try {
    addReadingSeconds(90, 'b1')
    addReadingSeconds(30, 'b1')
    addReadingSeconds(60, 'b2')
    const summary = getReadingSummary()
    assert.equal(summary.todaySeconds, 180)
    assert.equal(summary.weekSeconds, 180)
    assert.equal(summary.monthSeconds, 180)
    assert.equal(summary.totalSeconds, 180)
    assert.equal(summary.days.length, 14)
    assert.deepEqual(summary.books, [
      { bookId: 'b1', seconds: 120 },
      { bookId: 'b2', seconds: 60 },
    ])
    assert.equal(readingMinutes(120), 2)

    addReadingSeconds(0)
    addReadingSeconds(-10)
    addReadingSeconds(Number.NaN)
    assert.equal(getReadingSummary().totalSeconds, 180)
  } finally {
    restore()
  }
})

test('ignores corrupted stats payloads', () => {
  const restore = installStorage()
  try {
    localStorage.setItem('reading-notes-reading-stats', 'not-json')
    const empty = getReadingSummary()
    assert.equal(empty.todaySeconds, 0)
    assert.equal(empty.weekSeconds, 0)
    assert.equal(empty.monthSeconds, 0)
    assert.equal(empty.totalSeconds, 0)
    assert.deepEqual(empty.books, [])
    localStorage.setItem('reading-notes-reading-stats', JSON.stringify({ total: 10, days: { bad: 'x' } }))
    assert.equal(getReadingSummary().totalSeconds, 10)
    assert.equal(getReadingSummary().todaySeconds, 0)
  } finally {
    restore()
  }
})

test('exposes a month worth of daily buckets', () => {
  const restore = installStorage()
  try {
    addReadingSeconds(60, 'b1')
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const month = getReadingMonth(0)
    assert.ok(month.days.length >= 28)
    assert.equal(month.days.find((day) => day.date === today)?.seconds, 60)
    assert.equal(month.seconds, 60)
    assert.equal(getReadingMonth(-1).seconds, 0)
  } finally {
    restore()
  }
})

test('computes current and longest reading streaks', () => {
  const restore = installStorage()
  try {
    const key = (offset: number) => {
      const date = new Date()
      date.setDate(date.getDate() - offset)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }
    localStorage.setItem(
      'reading-notes-reading-stats',
      JSON.stringify({ total: 400, days: { [key(0)]: 100, [key(1)]: 100, [key(2)]: 100, [key(5)]: 100 }, books: {} }),
    )
    const summary = getReadingSummary()
    assert.equal(summary.currentStreak, 3)
    assert.equal(summary.longestStreak, 3)

    // 今天还没读，但昨天和前天读过，连续天数从昨天算起。
    localStorage.setItem(
      'reading-notes-reading-stats',
      JSON.stringify({ total: 200, days: { [key(1)]: 100, [key(2)]: 100 }, books: {} }),
    )
    assert.equal(getReadingSummary().currentStreak, 2)
  } finally {
    restore()
  }
})

test('aggregates monthly and yearly totals', () => {
  const restore = installStorage()
  try {
    const year = new Date().getFullYear()
    localStorage.setItem(
      'reading-notes-reading-stats',
      JSON.stringify({
        total: 2100,
        days: {
          [`${year}-01-05`]: 600,
          [`${year}-03-10`]: 1200,
          [`${year - 1}-12-31`]: 300,
        },
        books: {},
      }),
    )
    const current = getReadingYear(0)
    assert.equal(current.year, year)
    assert.equal(current.months.length, 12)
    assert.equal(current.months[0]?.seconds, 600)
    assert.equal(current.months[2]?.seconds, 1200)
    assert.equal(current.seconds, 1800)
    assert.equal(current.activeDays, 2)
    assert.deepEqual(current.bestMonth, { month: `${year}-03`, seconds: 1200 })
    assert.equal(getReadingYear(-1).seconds, 300)
  } finally {
    restore()
  }
})

test('keeps more than 90 days of daily stats and 100-day streaks', () => {
  const restore = installStorage()
  try {
    const days: Record<string, number> = {}
    const date = new Date()
    for (let offset = 0; offset < 120; offset++) {
      const current = new Date(date)
      current.setDate(current.getDate() - offset)
      days[
        `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`
      ] = 60
    }
    localStorage.setItem(
      'reading-notes-reading-stats',
      JSON.stringify({ total: 7200, days, books: {} }),
    )
    const summary = getReadingSummary()
    assert.equal(summary.currentStreak, 120)
    assert.equal(summary.longestStreak, 120)
    assert.equal(Object.keys(JSON.parse(localStorage.getItem('reading-notes-reading-stats')!).days).length, 120)
  } finally {
    restore()
  }
})

test('migrates local reading stats into the database when the database is empty', async () => {
  const restore = installStorage()
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let pushed: unknown = null
  const key = (offset: number) => {
    const date = new Date()
    date.setDate(date.getDate() - offset)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      api: {
        getReadingStats: async () => ({ total: 0, days: {}, books: {} }),
        mergeReadingStats: async (data: unknown) => {
          pushed = data
          return data
        },
      },
    },
  })
  try {
    localStorage.setItem(
      'reading-notes-reading-stats',
      JSON.stringify({ total: 120, days: { [key(0)]: 60, [key(1)]: 60 }, books: { 'book-a': 120 } }),
    )
    await hydrateReadingStats()
    assert.ok(pushed && typeof pushed === 'object')
    assert.equal((pushed as { total: number }).total, 120)
    assert.equal((pushed as { days: Record<string, number> }).days[key(1)], 60)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    restore()
  }
})

test('uses the database snapshot after hydration so backup restore can roll stats back', async () => {
  const restore = installStorage()
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const key = (offset: number) => {
    const date = new Date()
    date.setDate(date.getDate() - offset)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      api: {
        getReadingStats: async () => ({
          total: 180,
          days: { [key(0)]: 60, [key(2)]: 120 },
          books: { 'book-b': 120 },
        }),
        mergeReadingStats: async (data: unknown) => data,
      },
    },
  })
  try {
    localStorage.setItem(
      'reading-notes-reading-stats',
      JSON.stringify({ total: 120, days: { [key(0)]: 60, [key(1)]: 60 }, books: { 'book-a': 120 } }),
    )
    await hydrateReadingStats()
    const summary = getReadingSummary()
    assert.equal(summary.totalSeconds, 180)
    assert.deepEqual(summary.books, [{ bookId: 'book-b', seconds: 120 }])
    const stored = JSON.parse(localStorage.getItem('reading-notes-reading-stats')!) as {
      days: Record<string, number>
    }
    assert.equal(stored.days[key(1)], undefined)
    assert.equal(stored.days[key(2)], 120)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    restore()
  }
})

test('exports a month of daily stats as CSV', () => {
  const csv = readingCsv({
    label: '2026-11',
    seconds: 120,
    days: [
      { date: '2026-11-01', seconds: 120 },
      { date: '2026-11-02', seconds: 0 },
    ],
  })
  assert.equal(csv, 'date,seconds\n2026-11-01,120\n2026-11-02,0')
})

test('finds the next streak milestone', () => {
  assert.deepEqual(nextStreakMilestone(3), { next: 7, remaining: 4 })
  assert.deepEqual(nextStreakMilestone(7), { next: 30, remaining: 23 })
  assert.deepEqual(nextStreakMilestone(29), { next: 30, remaining: 1 })
  assert.equal(nextStreakMilestone(100), null)
})

test('lists unlocked streak milestones', () => {
  assert.deepEqual(unlockedMilestones(3), [])
  assert.deepEqual(unlockedMilestones(7), [7])
  assert.deepEqual(unlockedMilestones(45), [7, 30])
  assert.deepEqual(unlockedMilestones(100), [7, 30, 100])
})
