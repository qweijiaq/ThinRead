import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  closeDatabase,
  getChapter,
  getChapters,
  initDatabase,
  insertBook,
  saveChapterTranslation,
} from '../electron/db.js'

test('stores translated html and plain text per chapter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-translation-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: 'English Book', author: '', format: 'text', filePath: path.join(dir, 'book.txt') },
      [{ title: 'Chapter', text: 'Original English text.', html: '<p>Original English text.</p>' }],
    )
    const chapter = getChapters(book.id)[0]!
    const saved = saveChapterTranslation(chapter.id, '<h2>标题</h2><p>译文。</p>', '标题\n\n译文。')
    const updated = getChapter(chapter.id)
    assert.equal(updated.translatedHtml, '<h2>标题</h2><p>译文。</p>')
    assert.equal(updated.translatedText, '标题\n\n译文。')
    assert.equal(updated.translatedAt, saved.translatedAt)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
