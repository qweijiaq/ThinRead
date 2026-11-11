import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  closeDatabase,
  getBookTranslationInfo,
  getChapters,
  initDatabase,
  insertBook,
  saveChapterTranslation,
} from '../electron/db.js'

function withDatabase<T>(run: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-book-language-'))
  try {
    initDatabase(dir)
    return run(dir)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('reports foreign books and counts structured translations', () => {
  withDatabase((dir) => {
    const english = 'Attention is not unlimited. Every task switch leaves a residue. '.repeat(80)
    const book = insertBook(
      { title: 'English Book', author: '', format: 'text', filePath: path.join(dir, 'english.txt') },
      [
        { title: 'One', text: english, html: `<p>${english}</p>` },
        { title: 'Two', text: english, html: `<p>${english}</p>` },
      ],
    )
    const before = getBookTranslationInfo(book.id)
    assert.equal(before.foreign, true)
    assert.equal(before.total, 2)
    assert.equal(before.translated, 0)

    const chapters = getChapters(book.id)
    saveChapterTranslation(chapters[0]!.id, '<p>译文</p>', '译文')
    assert.equal(getBookTranslationInfo(book.id).translated, 1)
  })
})

test('does not offer translation for a Chinese book', () => {
  withDatabase((dir) => {
    const chinese = '专注不是把注意力锁死在一个点上，而是不断把走神的自己带回来。'.repeat(80)
    const book = insertBook(
      { title: '中文书', author: '', format: 'text', filePath: path.join(dir, 'chinese.txt') },
      [{ title: '一章', text: chinese, html: `<p>${chinese}</p>` }],
    )
    assert.equal(getBookTranslationInfo(book.id).foreign, false)
  })
})
