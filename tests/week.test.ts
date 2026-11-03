import assert from 'node:assert/strict'
import test from 'node:test'

import { isoWeekLabel } from '../src/lib/week.js'

test('formats ISO week labels across year boundaries', () => {
  assert.equal(isoWeekLabel(new Date(2026, 0, 1)), '2026-W01')
  assert.equal(isoWeekLabel(new Date(2025, 11, 29)), '2026-W01')
  assert.equal(isoWeekLabel(new Date(2024, 11, 30)), '2025-W01')
})
