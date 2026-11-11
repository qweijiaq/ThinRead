import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  closeDatabase,
  getBookSummary,
  getChapters,
  initDatabase,
  insertBook,
  setBookShelfStatus,
  setProgress,
} from '../electron/db.js'

test('new books start as to-read and open promotes them to reading', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-shelf-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '队列测试', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '正文', html: '<p>正文</p>' }],
    )
    assert.equal(book.shelfStatus, 'inbox')
    const chapterId = getChapters(book.id)[0]!.id
    setProgress(book.id, chapterId)
    assert.equal(getBookSummary(book.id)?.shelfStatus, 'reading')

    setBookShelfStatus(book.id, 'finished')
    setProgress(book.id, chapterId)
    assert.equal(getBookSummary(book.id)?.shelfStatus, 'finished')
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
