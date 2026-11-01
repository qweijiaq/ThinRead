import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  closeDatabase,
  createNote,
  deleteBook,
  emptyNoteTrash,
  getChapters,
  initDatabase,
  insertBook,
  listNotes,
  listTrashedNotes,
  pruneNoteTrash,
  purgeTrashedNote,
  restoreTrashedNote,
  trashNote,
} from '../electron/db.js'

function setup(): { dir: string; bookId: string; chapterId: string; noteId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-trash-'))
  initDatabase(dir)
  const book = insertBook(
    { title: '回收站测试', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
    [{ title: '第一章', text: '这是一段足够长的正文，用于回收站测试。', html: null }],
  )
  const chapterId = getChapters(book.id)[0]!.id
  const note = createNote({ bookId: book.id, chapterId, kind: 'thought', content: '值得保留的笔记。' })
  return { dir, bookId: book.id, chapterId, noteId: note.id }
}

test('lists, restores and permanently purges trashed notes', () => {
  const { dir, bookId, chapterId, noteId } = setup()
  try {
    trashNote(noteId)
    assert.equal(listNotes(bookId, chapterId).length, 0)
    const trashed = listTrashedNotes()
    assert.equal(trashed.length, 1)
    assert.equal(trashed[0]!.id, noteId)
    assert.equal(trashed[0]!.bookTitle, '回收站测试')
    assert.equal(trashed[0]!.preview, '值得保留的笔记。')

    const restored = restoreTrashedNote(noteId)
    assert.equal(restored?.id, noteId)
    assert.equal(listNotes(bookId, chapterId).length, 1)
    assert.equal(listTrashedNotes().length, 0)

    trashNote(noteId)
    purgeTrashedNote(noteId)
    assert.equal(listTrashedNotes().length, 0)
    assert.equal(listNotes(bookId, chapterId).length, 0)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('prunes expired trash and clears trash with the book', () => {
  const { dir, bookId, chapterId, noteId } = setup()
  try {
    trashNote(noteId)
    const db = new DatabaseSync(path.join(dir, 'reading-notes.db'))
    db.prepare("UPDATE note_trash SET deleted_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(noteId)
    db.close()
    assert.equal(pruneNoteTrash(), 1)
    assert.equal(listTrashedNotes().length, 0)

    const second = createNote({ bookId, chapterId, kind: 'thought', content: '第二条笔记。' })
    trashNote(second.id)
    assert.equal(listTrashedNotes().length, 1)
    deleteBook(bookId)
    assert.equal(listTrashedNotes().length, 0)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('empties the trash and reports the count', () => {
  const { dir, bookId, chapterId, noteId } = setup()
  try {
    const second = createNote({ bookId, chapterId, kind: 'thought', content: '第二条笔记。' })
    trashNote(noteId)
    trashNote(second.id)
    assert.equal(emptyNoteTrash(), 2)
    assert.equal(listTrashedNotes().length, 0)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
