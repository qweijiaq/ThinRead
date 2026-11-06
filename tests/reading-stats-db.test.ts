import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  closeDatabase,
  getReadingStatsRecord,
  initDatabase,
  mergeReadingStatsRecord,
  recordReadingStats,
} from '../electron/db.js'

test('merges and accumulates persisted reading stats without double counting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-stats-'))
  try {
    initDatabase(dir)

    const first = mergeReadingStatsRecord({
      total: 120,
      days: { '2026-01-01': 60, '2026-01-02': 60 },
      books: { 'book-a': 120 },
    })
    assert.equal(first.total, 120)
    assert.equal(first.days['2026-01-01'], 60)
    assert.equal(first.books['book-a'], 120)

    // 同一份快照再同步一次不会翻倍。
    const again = mergeReadingStatsRecord(first)
    assert.equal(again.total, 120)
    assert.equal(again.days['2026-01-02'], 60)

    recordReadingStats('2026-01-02', 30, 'book-a')
    const after = getReadingStatsRecord()
    assert.equal(after.total, 150)
    assert.equal(after.days['2026-01-02'], 90)
    assert.equal(after.books['book-a'], 150)

    // 较小快照不能把已有统计覆盖回去。
    const lower = mergeReadingStatsRecord({ total: 10, days: { '2026-01-01': 10 }, books: { 'book-a': 10 } })
    assert.equal(lower.total, 150)
    assert.equal(lower.days['2026-01-01'], 60)
    assert.equal(lower.books['book-a'], 150)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('rejects malformed days and seconds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-stats-invalid-'))
  try {
    initDatabase(dir)
    const stats = mergeReadingStatsRecord({
      total: 999,
      days: { bad: 100, '2026-02-01': -5, '2026-02-02': 30 },
      books: { '': 10, 'book-a': 30 },
    })
    assert.equal(stats.days.bad, undefined)
    assert.equal(stats.days['2026-02-01'], undefined)
    assert.equal(stats.days['2026-02-02'], 30)
    assert.equal(stats.books[''], undefined)
    recordReadingStats('not-a-day', 30, 'book-a')
    recordReadingStats('2026-02-03', 0, 'book-a')
    assert.equal(getReadingStatsRecord().days['2026-02-03'], undefined)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
