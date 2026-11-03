import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { closeDatabase, getBookSummary, initDatabase, insertBook, renameBook } from '../electron/db.js'

test('edits book title and author together', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-book-meta-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '旧书名', author: '识别错的作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '正文内容足够长，用于元数据测试。', html: null }],
    )
    const updated = renameBook(book.id, '新书名', '正确作者')
    assert.equal(updated.title, '新书名')
    assert.equal(updated.author, '正确作者')
    assert.equal(getBookSummary(book.id)?.author, '正确作者')
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
