import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  closeDatabase,
  createBookmark,
  createChapterMark,
  createNote,
  deleteChapters,
  emptyChapterTrash,
  getReadingPosition,
  getChapters,
  initDatabase,
  insertBook,
  listBookmarks,
  listChapterMarks,
  listNotes,
  listTrashedChapters,
  pruneChapterTrash,
  purgeTrashedChapter,
  restoreTrashedChapter,
  saveReadingPosition,
} from '../electron/db.js'

function setup(): { dir: string; bookId: string; chapterId: string; noteId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-chapter-trash-'))
  initDatabase(dir)
  const book = insertBook(
    { title: '章节回收站', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
    [
      { title: '第一章', text: '第一章正文，足够长以保存为章节。', html: null },
      { title: '第二章', text: '第二章正文，足够长以保存为章节。', html: null },
      { title: '第三章', text: '第三章正文，足够长以保存为章节。', html: null },
    ],
  )
  const chapterId = getChapters(book.id)[0]!.id
  const note = createNote({ bookId: book.id, chapterId, kind: 'thought', content: '章节里的笔记。' })
  return { dir, bookId: book.id, chapterId, noteId: note.id }
}

test('trashes a chapter with notes, marks, bookmarks and position, then restores it', () => {
  const { dir, bookId, chapterId, noteId } = setup()
  try {
    createChapterMark({ chapterId, quote: '第一章正文', style: 'highlight' })
    createBookmark({ bookId, chapterId, scrollRatio: 0.4, scrollTop: 400, label: '位置' })
    saveReadingPosition({ bookId, chapterId, scrollRatio: 0.4, scrollTop: 400, page: 3 })
    deleteChapters([chapterId])
    assert.equal(getChapters(bookId).length, 2)
    assert.equal(listNotes(bookId, chapterId).length, 0)
    // 不再留下 chapter_id 为空的孤儿笔记：整本书的笔记列表里也不应出现。
    assert.equal(listNotes(bookId).length, 0)
    assert.equal(listTrashedChapters().length, 1)
    assert.equal(listTrashedChapters()[0]!.noteCount, 1)

    const restored = restoreTrashedChapter(chapterId)
    assert.equal(restored?.id, chapterId)
    assert.equal(getChapters(bookId).length, 3)
    assert.equal(listNotes(bookId).length, 1)
    assert.equal(listNotes(bookId, chapterId).length, 1)
    assert.equal(listNotes(bookId, chapterId)[0]!.id, noteId)
    assert.equal(listChapterMarks(chapterId).length, 1)
    assert.equal(listBookmarks(bookId).length, 1)
    assert.equal(getReadingPosition(chapterId)?.page, 3)
    assert.equal(listTrashedChapters().length, 0)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('prunes, purges and empties chapter trash', () => {
  const { dir, bookId, chapterId } = setup()
  try {
    deleteChapters([chapterId])
    assert.equal(listTrashedChapters().length, 1)
    purgeTrashedChapter(chapterId)
    assert.equal(listTrashedChapters().length, 0)

    const second = getChapters(bookId)[0]!
    deleteChapters([second.id])
    assert.equal(listTrashedChapters().length, 1)
    assert.equal(emptyChapterTrash(), 1)
    assert.equal(listTrashedChapters().length, 0)

    const third = getChapters(bookId)[0]!
    deleteChapters([third.id])
    const db = new DatabaseSync(path.join(dir, 'reading-notes.db'))
    db.prepare("UPDATE chapter_trash SET deleted_at = '2020-01-01T00:00:00.000Z'").run()
    db.close()
    assert.equal(pruneChapterTrash(), 1)
    assert.equal(listTrashedChapters().length, 0)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('purges legacy orphaned notes when the trashed chapter is permanently deleted', () => {
  const { dir, bookId, chapterId, noteId } = setup()
  try {
    // 模拟旧版本删章的结果：chapter 行没了，笔记 chapter_id 被置空，payload 里还留着笔记 id。
    const db = new DatabaseSync(path.join(dir, 'reading-notes.db'))
    db.prepare('DELETE FROM chapters WHERE id = ?').run(chapterId)
    db.prepare('UPDATE notes SET chapter_id = NULL WHERE id = ?').run(noteId)
    db.prepare('INSERT INTO chapter_trash (id, book_id, payload, deleted_at) VALUES (?, ?, ?, ?)').run(
      chapterId,
      bookId,
      JSON.stringify({ notes: [{ id: noteId }] }),
      new Date().toISOString(),
    )
    db.close()

    // 与章节无关的书级笔记不能被误删。
    const keep = createNote({ bookId, chapterId: null, kind: 'thought', content: '书级笔记。' })
    assert.equal(listNotes(bookId).length, 2)

    purgeTrashedChapter(chapterId)
    const remaining = listNotes(bookId)
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0]!.id, keep.id)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
