import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  closeDatabase,
  deleteReadingPlan,
  getChapters,
  getReadingPlan,
  initDatabase,
  insertBook,
  listReadingPlans,
  saveReadingPlan,
} from '../electron/db.js'

test('saves, updates and clears a reading plan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-plan-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '计划测试', author: '', format: 'text', filePath: path.join(dir, 'book.txt') },
      [
        { title: '第一章', text: '第一章正文', html: null },
        { title: '第二章', text: '第二章正文', html: null },
        { title: '第三章', text: '第三章正文', html: null },
      ],
    )
    const chapters = getChapters(book.id)
    const first = saveReadingPlan({
      bookId: book.id,
      startDate: '2026-11-06',
      dailyMinutes: 20,
      days: [
        { date: '2026-11-06', chapterIds: [chapters[0]!.id, 'missing'], chars: 8000 },
        { date: '2026-11-07', chapterIds: [chapters[1]!.id, chapters[2]!.id], chars: 8000 },
      ],
      done: [chapters[0]!.id, 'missing'],
    })
    assert.equal(first.days.length, 2)
    assert.deepEqual(first.days[0]?.chapterIds, [chapters[0]!.id])
    assert.deepEqual(first.done, [chapters[0]!.id])

    const second = saveReadingPlan({
      ...first,
      done: [chapters[0]!.id, chapters[1]!.id],
    })
    assert.deepEqual(second.done, [chapters[0]!.id, chapters[1]!.id])
    assert.equal(second.createdAt, first.createdAt)
    assert.equal(getReadingPlan(book.id)?.days.length, 2)
    assert.equal(listReadingPlans().length, 1)

    deleteReadingPlan(book.id)
    assert.equal(getReadingPlan(book.id), null)
    assert.equal(listReadingPlans().length, 0)
    assert.throws(
      () =>
        saveReadingPlan({
          bookId: book.id,
          startDate: '2026-11-06',
          dailyMinutes: 20,
          days: [{ date: '2026-11-06', chapterIds: ['missing'], chars: 10 }],
          done: [],
        }),
      /还没有章节/,
    )
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
