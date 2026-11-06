import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  closeDatabase,
  createNote,
  getChapters,
  getLibraryNoteAudit,
  initDatabase,
  insertBook,
  listLibraryNotesPage,
  replaceAiNotes,
} from '../electron/db.js'

test('summarizes note evidence and chapter coverage for the library', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-audit-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '审计测试', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [
        { title: '第一章', text: '第一章正文。', html: null },
        { title: '第二章', text: '第二章正文。', html: null },
        { title: '版权页', text: '版权信息。', html: null, hidden: true },
      ],
    )
    const chapters = getChapters(book.id).filter((chapter) => !chapter.hidden)
    const first = chapters[0]!
    const second = chapters[1]!

    replaceAiNotes(first.id, [
      {
        kind: 'point',
        title: '已核对的知识点',
        content: '这是一个有原文依据的知识点。',
        quote: '第一章正文。',
        quoteVerified: true,
        tags: ['专注'],
      },
      {
        kind: 'point',
        title: '未核对的知识点',
        content: '这是一个引用未核对的知识点。',
        quote: '第一章正文。',
        quoteVerified: false,
        tags: ['专注'],
      },
    ])
    replaceAiNotes(second.id, [
      {
        kind: 'condensed',
        title: '第二章读薄稿',
        content: '第二章的读薄稿。',
        quote: null,
        quoteVerified: false,
        tags: [],
      },
    ])
    createNote({
      bookId: book.id,
      chapterId: first.id,
      kind: 'thought',
      content: '我自己的想法，没有引用。',
    })

    const audit = getLibraryNoteAudit({ bookId: book.id })
    assert.equal(audit.notes, 4)
    assert.equal(audit.ai, 3)
    assert.equal(audit.edited, 0)
    assert.equal(audit.verified, 1)
    assert.equal(audit.unverified, 1)
    assert.equal(audit.noQuote, 2)
    assert.equal(audit.chapterTotal, 2)
    assert.equal(audit.chapterWithNotes, 2)
    assert.equal(audit.chapterWithCondensed, 1)

    // 摘要不受审计筛选影响，列表按筛选缩小。
    assert.equal(getLibraryNoteAudit({ bookId: book.id, audit: 'unverified' }).notes, 4)
    assert.equal(listLibraryNotesPage({ bookId: book.id, audit: 'unverified' }).total, 1)
    assert.equal(listLibraryNotesPage({ bookId: book.id, audit: 'noQuote' }).total, 2)

    const allBooks = getLibraryNoteAudit({})
    assert.equal(allBooks.notes, 4)
    assert.equal(allBooks.chapterTotal, 2)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
