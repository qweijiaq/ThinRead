import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createBackup, deleteBackup, exportBackup, listBackups, restoreBackup } from '../electron/backup.js'
import {
  closeDatabase,
  createNote,
  getBookSummary,
  getChapters,
  initDatabase,
  insertBook,
  listNotes,
  mergeBooks,
  replaceBookChapters,
  splitBook,
} from '../electron/db.js'

test('restores a backup without losing notes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-backup-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '备份测试', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '备份之前的正文内容，足够长以便作为一章保存。', html: null }],
    )
    const chapter = getChapters(book.id)[0]!
    createNote({ bookId: book.id, chapterId: chapter.id, kind: 'thought', content: '备份前的笔记。' })
    const backup = createBackup(dir, 'manual', '测试备份')
    assert.ok(listBackups(dir).some((item) => item.id === backup.id))

    createNote({ bookId: book.id, chapterId: chapter.id, kind: 'thought', content: '备份后的笔记。' })
    assert.equal(listNotes(book.id).length, 2)

    restoreBackup(dir, backup.id)
    assert.equal(listNotes(book.id).length, 1)
    assert.equal(listNotes(book.id)[0]!.content, '备份前的笔记。')

    const exported = path.join(dir, 'exported.zip')
    exportBackup(dir, backup.id, exported)
    assert.ok(fs.existsSync(exported))
    deleteBackup(dir, backup.id)
    assert.equal(listBackups(dir).length, 0)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('re-attaches notes after replacing chapters during reparse', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-reparse-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '重解析', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [
        { title: '第一章', text: '第一章的正文，包含一段足够长的原文，供重解析时匹配笔记。', html: null },
        { title: '第二章', text: '第二章的正文，包含另一段足够长的原文，供重解析时匹配笔记。', html: null },
      ],
    )
    const oldChapters = getChapters(book.id)
    createNote({
      bookId: book.id,
      chapterId: oldChapters[0]!.id,
      kind: 'highlight',
      content: '第一章笔记',
      quote: '第一章的正文',
    })
    createNote({
      bookId: book.id,
      chapterId: oldChapters[1]!.id,
      kind: 'highlight',
      content: '第二章笔记',
      quote: '第二章的正文',
    })
    replaceBookChapters(book.id, {
      title: '重解析',
      author: '作者',
      chapters: [
        { title: '第一章', text: '第一章的正文，包含一段足够长的原文，供重解析时匹配笔记。', html: null },
        { title: '第二章', text: '第二章的正文，包含另一段足够长的原文，供重解析时匹配笔记。', html: null },
      ],
    })
    const chapters = getChapters(book.id)
    const notes = listNotes(book.id)
    assert.equal(chapters.length, 2)
    assert.equal(notes.length, 2)
    assert.ok(notes.every((note) => note.chapterId))
    assert.equal(notes.find((note) => note.content === '第一章笔记')?.chapterId, chapters[0]!.id)
    assert.equal(notes.find((note) => note.content === '第二章笔记')?.chapterId, chapters[1]!.id)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('keeps notes attached to their chapters through merge and split', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-ownership-'))
  try {
    initDatabase(dir)
    const first = insertBook(
      { title: '第一本', author: '作者', format: 'text', filePath: path.join(dir, 'a.txt') },
      [
        { title: '甲一', text: '第一本书的第一章正文，长度足够识别为正文内容。', html: null },
        { title: '甲二', text: '第一本书的第二章正文，长度足够识别为正文内容。', html: null },
      ],
    )
    const second = insertBook(
      { title: '第二本', author: '作者', format: 'text', filePath: path.join(dir, 'b.txt') },
      [
        { title: '乙一', text: '第二本书的第一章正文，长度足够识别为正文内容。', html: null },
        { title: '乙二', text: '第二本书的第二章正文，长度足够识别为正文内容。', html: null },
      ],
    )
    for (const book of [first, second]) {
      for (const chapter of getChapters(book.id)) {
        createNote({
          bookId: book.id,
          chapterId: chapter.id,
          kind: 'point',
          content: `${book.title} · ${chapter.title} 的笔记`,
        })
      }
    }
    const merged = mergeBooks([first.id, second.id], '合并本', '作者')
    assert.equal(getChapters(merged.id).length, 4)
    assert.equal(listNotes(merged.id).length, 4)
    assert.equal(getBookSummary(second.id), null)

    const mergedChapters = getChapters(merged.id)
    const split = splitBook(merged.id, mergedChapters[2]!.id, '拆分本', path.join(dir, 'split.txt'))
    assert.equal(getChapters(merged.id).length, 2)
    assert.equal(getChapters(split.id).length, 2)
    assert.equal(listNotes(merged.id).length, 2)
    assert.equal(listNotes(split.id).length, 2)
    assert.ok(listNotes(split.id).every((note) => note.chapterId && getChapters(split.id).some((chapter) => chapter.id === note.chapterId)))
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
