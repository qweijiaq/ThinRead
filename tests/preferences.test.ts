import assert from 'node:assert/strict'
import test from 'node:test'

import { getAutoNext, getDailyGoal, setAutoNext, setDailyGoal } from '../src/lib/preferences.js'

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
