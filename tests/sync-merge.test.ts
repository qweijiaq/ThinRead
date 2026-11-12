import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  closeDatabase,
  createNote,
  getChapters,
  getReadingPosition,
  getReadingStatsRecord,
  getBookSummary,
  initDatabase,
  insertBook,
  listNotes,
} from '../electron/db.js'
import { mergeSnapshotDatabase } from '../electron/db-merge.js'

test('merges newer notes and new notes from a snapshot without replacing the library', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-merge-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '合并测试', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '正文', html: '<p>正文</p>' }],
    )
    const chapterId = getChapters(book.id)[0]!.id
    const local = createNote({
      bookId: book.id,
      chapterId,
      kind: 'thought',
      title: '本地笔记',
      content: '旧内容',
    })
    closeDatabase()

    const snapshotPath = path.join(dir, 'snapshot.db')
    fs.copyFileSync(path.join(dir, 'reading-notes.db'), snapshotPath)
    const source = new DatabaseSync(snapshotPath)
    source
      .prepare("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?")
      .run('快照里的新内容', '2999-01-01T00:00:00.000Z', local.id)
    source
      .prepare(
        `INSERT INTO notes (id, book_id, chapter_id, kind, title, content, quote, quote_verified, author, edited, tags, created_at, updated_at)
         VALUES (?, ?, ?, 'thought', ?, ?, NULL, 0, 'ai', 0, '[]', ?, ?)`,
      )
      .run(
        'snapshot-only-note',
        book.id,
        chapterId,
        '快照新增',
        '只在快照里存在的笔记',
        '2026-01-01T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z',
      )
    source
      .prepare(
        `INSERT INTO reading_positions (chapter_id, book_id, scroll_ratio, scroll_top, page, updated_at)
         VALUES (?, ?, 0.4, 1200, 7, ?)`,
      )
      .run(chapterId, book.id, '2026-01-03T00:00:00.000Z')
    source.prepare('INSERT INTO reading_stats_days (day, seconds) VALUES (?, ?)').run('2026-01-05', 600)
    source.close()

    initDatabase(dir)
    const result = mergeSnapshotDatabase(snapshotPath)
    assert.equal(result.notes, 2)
    assert.equal(result.positions, 1)
    assert.ok(result.stats >= 1)
    assert.equal(getReadingPosition(chapterId)?.page, 7)
    assert.equal(getReadingStatsRecord().days['2026-01-05'], 600)
    const notes = listNotes(book.id)
    assert.equal(notes.length, 2)
    assert.equal(notes.find((note) => note.id === local.id)?.content, '快照里的新内容')
    assert.ok(notes.some((note) => note.id === 'snapshot-only-note'))
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('skips notes whose book or chapter is missing locally', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-merge-skip-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '本地书', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '正文', html: '<p>正文</p>' }],
    )
    closeDatabase()

    const snapshotPath = path.join(dir, 'snapshot.db')
    fs.copyFileSync(path.join(dir, 'reading-notes.db'), snapshotPath)
    const source = new DatabaseSync(snapshotPath)
    source.exec('PRAGMA foreign_keys = OFF')
    source
      .prepare(
        `INSERT INTO notes (id, book_id, chapter_id, kind, title, content, quote, quote_verified, author, edited, tags, created_at, updated_at)
         VALUES (?, ?, NULL, 'thought', ?, ?, NULL, 0, 'ai', 0, '[]', ?, ?)`,
      )
      .run('orphan', 'missing-book', '孤儿笔记', '没有对应书', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    source.close()

    initDatabase(dir)
    const result = mergeSnapshotDatabase(snapshotPath)
    assert.equal(result.notes, 0)
    assert.equal(result.skipped, 1)
    assert.equal(listNotes(book.id).length, 0)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})


test('imports books and chapters that do not exist locally', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-merge-books-source-'))
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-merge-books-target-'))
  try {
    initDatabase(sourceDir)
    const book = insertBook(
      { title: '快照里的书', author: '作者', format: 'text', filePath: path.join(sourceDir, 'source.txt') },
      [
        { title: '第一章', text: '第一章正文', html: '<p>第一章正文</p>' },
        { title: '第二章', text: '第二章正文', html: '<p>第二章正文</p>' },
      ],
    )
    closeDatabase()

    const snapshotPath = path.join(sourceDir, 'snapshot.db')
    fs.copyFileSync(path.join(sourceDir, 'reading-notes.db'), snapshotPath)

    initDatabase(targetDir)
    assert.equal(getBookSummary(book.id), null)
    const result = mergeSnapshotDatabase(snapshotPath, { booksRoot: path.join(targetDir, 'books') })
    assert.equal(result.books, 1)
    assert.equal(result.chapters, 2)
    assert.deepEqual(result.newBooks, [book.id])
    assert.equal(getBookSummary(book.id)?.title, '快照里的书')
    assert.equal(getChapters(book.id).length, 2)
  } finally {
    closeDatabase()
    fs.rmSync(sourceDir, { recursive: true, force: true })
    fs.rmSync(targetDir, { recursive: true, force: true })
  }
})
