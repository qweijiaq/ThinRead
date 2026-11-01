import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  closeDatabase,
  createNote,
  getChapters,
  initDatabase,
  insertBook,
  listContentPage,
  listLibraryNotesPage,
  saveLabArtifact,
} from '../electron/db.js'

test('paginates and filters notes and generated content in the database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-pages-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '分页测试', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '用于分页测试的正文内容，长度足够成为一章。', html: null }],
    )
    const chapter = getChapters(book.id)[0]!
    for (let index = 0; index < 35; index++) {
      createNote({
        bookId: book.id,
        chapterId: chapter.id,
        kind: 'point',
        title: `专注笔记 ${index + 1}`,
        content: `第 ${index + 1} 条专注笔记，记录环境与注意力。`,
        tags: index % 2 === 0 ? ['专注'] : ['环境'],
      })
      saveLabArtifact({
        tool: 'book-club',
        scope: 'latest',
        title: `生成内容 ${index + 1}`,
        content: `第 ${index + 1} 条生成内容，讨论专注和环境。`,
        bookId: book.id,
      })
    }

    const firstPage = listLibraryNotesPage({ limit: 10, offset: 0 })
    assert.equal(firstPage.total, 35)
    assert.equal(firstPage.items.length, 10)
    const secondPage = listLibraryNotesPage({ limit: 10, offset: 10 })
    assert.equal(secondPage.total, 35)
    assert.equal(secondPage.items.length, 10)
    assert.notEqual(firstPage.items[0]!.id, secondPage.items[0]!.id)
    assert.equal(listLibraryNotesPage({ query: '专注', limit: 10 }).total, 35)
    assert.equal(listLibraryNotesPage({ tag: '专注', limit: 10 }).total, 18)

    const content = listContentPage({ limit: 12, offset: 12 })
    assert.equal(content.total, 35)
    assert.equal(content.items.length, 12)
    assert.equal(listContentPage({ query: '专注', limit: 12 }).total, 35)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
