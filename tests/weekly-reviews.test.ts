import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { closeDatabase, initDatabase, listWeeklyReviews, saveWeeklyReview } from '../electron/db.js'

test('saves one weekly review per ISO week and updates it in place', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-weekly-'))
  try {
    initDatabase(dir)
    const first = saveWeeklyReview({
      week: '2026-W45',
      title: '每周复盘 · 2026-W45',
      content: '第一版复盘',
    })
    assert.equal(first.week, '2026-W45')
    saveWeeklyReview({
      week: '2026-W45',
      title: '每周复盘 · 2026-W45',
      content: '第二版复盘',
    })
    const list = listWeeklyReviews()
    assert.equal(list.length, 1)
    assert.equal(list[0]?.content, '第二版复盘')
    assert.throws(() => saveWeeklyReview({ week: 'bad', title: '', content: 'x' }), /周次无效/)
    assert.throws(() => saveWeeklyReview({ week: '2026-W46', title: '', content: '   ' }), /内容为空/)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
