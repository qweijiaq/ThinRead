import assert from 'node:assert/strict'
import test from 'node:test'

import type { ChapterMeta } from '../shared/types.js'
import { buildReadingPlan, readingPlanDoneDays, readingPlanMinutes } from '../src/lib/reading-plan.js'

function chapter(id: string, idx: number, chars: number, hidden = false): ChapterMeta {
  return {
    id,
    idx,
    title: id,
    chars,
    hidden,
    kind: 'content',
    reason: null,
    classifiedBy: null,
    partTitle: null,
    partIndex: null,
    isPart: false,
  }
}

test('builds a contiguous reading plan from daily minutes', () => {
  const chapters = [chapter('a', 0, 4000), chapter('b', 1, 4000), chapter('c', 2, 4000), chapter('d', 3, 4000)]
  const days = buildReadingPlan(chapters, '2026-11-06', 20)
  assert.equal(days.length, 2)
  assert.deepEqual(days[0]?.chapterIds, ['a', 'b'])
  assert.equal(days[0]?.date, '2026-11-06')
  assert.equal(days[0]?.chars, 8000)
  assert.deepEqual(days[1]?.chapterIds, ['c', 'd'])
  assert.equal(days[1]?.date, '2026-11-07')
})

test('skips hidden and empty chapters and keeps a long chapter on its own day', () => {
  const chapters = [
    chapter('a', 0, 3000),
    chapter('hidden', 1, 50000, true),
    chapter('empty', 2, 0),
    chapter('long', 3, 30000),
    chapter('b', 4, 3000),
  ]
  const days = buildReadingPlan(chapters, '2026-01-30', 15)
  assert.equal(days.length, 2)
  assert.deepEqual(days[0]?.chapterIds, ['a', 'long'])
  assert.equal(days[1]?.chapterIds[0], 'b')
  assert.equal(days[1]?.date, '2026-01-31')
  assert.equal(readingPlanMinutes(30000), 75)
})

test('counts fully completed plan days', () => {
  const days = buildReadingPlan([chapter('a', 0, 4000), chapter('b', 1, 4000)], '2026-11-06', 10)
  assert.equal(readingPlanDoneDays(days, []), 0)
  assert.equal(readingPlanDoneDays(days, ['a']), 1)
  assert.equal(readingPlanDoneDays(days, ['a', 'b']), 2)
})
