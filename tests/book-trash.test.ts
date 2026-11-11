import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  closeDatabase,
  createNote,
  deleteBook,
  emptyBookTrash,
  getBookSummary,
  getChapters,
  initDatabase,
  insertBook,
  listNotes,
  listTrashedBooks,
  purgeTrashedBook,
  restoreTrashedBook,
  saveBookTrash,
  snapshotBookForTrash,
} from '../electron/db.js'

test('moves a book to trash and restores chapters and notes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-book-trash-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '回收站测试', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [
        { title: '第一章', text: '这是第一章的正文。', html: '<p>这是第一章的正文。</p>' },
        { title: '第二章', text: '这是第二章的正文。', html: '<p>这是第二章的正文。</p>' },
      ],
    )
    createNote({ bookId: book.id, chapterId: getChapters(book.id)[0]!.id, kind: 'thought', title: '笔记', content: '一条笔记' })
    const payload = snapshotBookForTrash(book.id)
    assert.ok(payload)
    saveBookTrash(book.id, payload!, 'trash/books/' + book.id)
    deleteBook(book.id)
    assert.equal(getBookSummary(book.id), null)

    const trashed = listTrashedBooks()
    assert.equal(trashed.length, 1)
    assert.equal(trashed[0]?.title, '回收站测试')
    assert.equal(trashed[0]?.chapterCount, 2)
    assert.equal(trashed[0]?.noteCount, 1)

    const restored = restoreTrashedBook(book.id)
    assert.equal(restored?.title, '回收站测试')
    assert.equal(getChapters(book.id).length, 2)
    assert.equal(listNotes(book.id).length, 1)
    assert.equal(listTrashedBooks().length, 0)

    saveBookTrash(book.id, payload!, 'trash/books/' + book.id)
    deleteBook(book.id)
    assert.equal(purgeTrashedBook(book.id), 'trash/books/' + book.id)
    assert.equal(listTrashedBooks().length, 0)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('empties book trash and returns directories to remove', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-book-trash-empty-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '另一本', author: '', format: 'text', filePath: path.join(dir, 'other.txt') },
      [{ title: '章', text: '正文。', html: null }],
    )
    const payload = snapshotBookForTrash(book.id)!
    saveBookTrash(book.id, payload, `trash/books/${book.id}`)
    deleteBook(book.id)
    assert.deepEqual(emptyBookTrash(), [`trash/books/${book.id}`])
    assert.equal(listTrashedBooks().length, 0)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
