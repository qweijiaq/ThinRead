import assert from 'node:assert/strict'
import test from 'node:test'

import { getAutoNext, getDailyGoal, hydratePreferences, setAutoNext, setDailyGoal } from '../src/lib/preferences.js'

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

test('stores auto-continue and daily goal preferences', () => {
  const restore = installStorage()
  try {
    assert.equal(getAutoNext(), false)
    setAutoNext(true)
    assert.equal(getAutoNext(), true)
    setAutoNext(false)
    assert.equal(getAutoNext(), false)

    assert.equal(getDailyGoal(), 0)
    setDailyGoal(25)
    assert.equal(getDailyGoal(), 25)
    setDailyGoal(999)
    assert.equal(getDailyGoal(), 240)
    setDailyGoal(0)
    assert.equal(getDailyGoal(), 0)
    setDailyGoal(Number.NaN)
    assert.equal(getDailyGoal(), 0)
  } finally {
    restore()
  }
})

test('hydrates preferences from the database when it has been configured', async () => {
  const restore = installStorage()
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let saved: { autoNext?: boolean; dailyGoal?: number } | null = null
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      api: {
        getUiPreferences: async () => ({ autoNext: false, dailyGoal: 0, configured: true }),
        saveUiPreferences: async (patch: { autoNext?: boolean; dailyGoal?: number }) => {
          saved = patch
          return { autoNext: false, dailyGoal: 0, configured: true }
        },
      },
    },
  })
  try {
    localStorage.setItem('reading-notes-auto-next', '1')
    localStorage.setItem('reading-notes-daily-goal', '25')
    await hydratePreferences()
    assert.equal(getAutoNext(), false)
    assert.equal(getDailyGoal(), 0)
    assert.deepEqual(saved, { autoNext: false, dailyGoal: 0 })
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    restore()
  }
})

test('migrates local preferences when the database has no preference snapshot', async () => {
  const restore = installStorage()
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let saved: { autoNext?: boolean; dailyGoal?: number } | null = null
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      api: {
        getUiPreferences: async () => ({ autoNext: false, dailyGoal: 0, configured: false }),
        saveUiPreferences: async (patch: { autoNext?: boolean; dailyGoal?: number }) => {
          saved = patch
          return { autoNext: false, dailyGoal: 0, configured: true }
        },
      },
    },
  })
  try {
    localStorage.setItem('reading-notes-auto-next', '1')
    localStorage.setItem('reading-notes-daily-goal', '25')
    await hydratePreferences()
    assert.equal(getAutoNext(), true)
    assert.equal(getDailyGoal(), 25)
    assert.deepEqual(saved, { autoNext: true, dailyGoal: 25 })
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    restore()
  }
})
