import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  closeDatabase,
  createBookmark,
  createNote,
  deleteBookmark,
  getChapters,
  getReadingPosition,
  initDatabase,
  insertBook,
  listBookmarks,
  listNotes,
  restoreTrashedNote,
  saveReadingPage,
  saveReadingPosition,
  trashNote,
} from '../electron/db.js'

test('stores reading positions and bookmarks per chapter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-position-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '位置测试', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '用于阅读位置和书签测试的正文内容，足够成为一章。', html: null }],
    )
    const chapter = getChapters(book.id)[0]!
    saveReadingPosition({ bookId: book.id, chapterId: chapter.id, scrollRatio: 0.42, scrollTop: 420 })
    assert.equal(getReadingPosition(chapter.id)?.scrollRatio, 0.42)
    saveReadingPosition({ bookId: book.id, chapterId: chapter.id, scrollRatio: 0.68, scrollTop: 680 })
    assert.equal(getReadingPosition(chapter.id)?.scrollTop, 680)

    saveReadingPage(chapter.id, book.id, 12)
    const pdfPosition = getReadingPosition(chapter.id)
    assert.equal(pdfPosition?.page, 12)
    assert.equal(pdfPosition?.scrollRatio, 0.68)
    assert.equal(pdfPosition?.scrollTop, 680)

    const bookmark = createBookmark({
      bookId: book.id,
      chapterId: chapter.id,
      scrollRatio: 0.42,
      scrollTop: 420,
      label: '第一章 · 42%',
      quote: '正文内容',
    })
    assert.equal(listBookmarks(book.id).length, 1)
    assert.equal(listBookmarks(book.id)[0]!.chapterTitle, chapter.title)
    deleteBookmark(bookmark.id)
    assert.equal(listBookmarks(book.id).length, 0)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('restores a deleted note from local trash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-trash-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '回收站测试', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '用于笔记删除撤销测试的正文内容。', html: null }],
    )
    const chapter = getChapters(book.id)[0]!
    const note = createNote({
      bookId: book.id,
      chapterId: chapter.id,
      kind: 'thought',
      title: '可撤销笔记',
      content: '删除后应该可以恢复。',
      tags: ['测试'],
    })
    assert.ok(trashNote(note.id))
    assert.equal(listNotes(book.id).length, 0)
    const restored = restoreTrashedNote(note.id)
    assert.equal(restored?.id, note.id)
    assert.equal(restored?.content, '删除后应该可以恢复。')
    assert.equal(listNotes(book.id).length, 1)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
