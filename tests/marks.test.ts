import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  closeDatabase,
  createChapterMark,
  deleteChapterMark,
  getChapters,
  initDatabase,
  insertBook,
  listChapterMarks,
} from '../electron/db.js'

test('persists and removes reader marks per chapter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-marks-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '标记测试', author: '', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '这是一段用于测试划词标记的正文。', html: null }],
    )
    const chapter = getChapters(book.id)[0]!
    const highlight = createChapterMark({ chapterId: chapter.id, quote: '划词标记', style: 'highlight' })
    const underline = createChapterMark({ chapterId: chapter.id, quote: '正文', style: 'underline' })
    assert.equal(highlight.bookId, book.id)
    assert.deepEqual(listChapterMarks(chapter.id).map((mark) => mark.style), ['highlight', 'underline'])
    deleteChapterMark(highlight.id)
    assert.deepEqual(listChapterMarks(chapter.id).map((mark) => mark.id), [underline.id])
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
