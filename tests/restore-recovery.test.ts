import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createBackup, recoverInterruptedRestore } from '../electron/backup.js'
import {
  closeDatabase,
  createNote,
  getChapters,
  initDatabase,
  insertBook,
  listNotes,
} from '../electron/db.js'

const MARKER = '.restore-pending'

function setup(): { dir: string; bookId: string; noteId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-restore-'))
  initDatabase(dir)
  const book = insertBook(
    { title: '恢复测试', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
    [{ title: '第一章', text: '恢复前的正文，足够长以保存为章节。', html: null }],
  )
  const chapterId = getChapters(book.id)[0]!.id
  const note = createNote({ bookId: book.id, chapterId, kind: 'thought', content: '恢复前的笔记。' })
  return { dir, bookId: book.id, noteId: note.id }
}

function moveLiveAside(dir: string, oldRoot: string): void {
  fs.mkdirSync(oldRoot, { recursive: true })
  closeDatabase()
  for (const name of ['reading-notes.db', 'reading-notes.db-wal', 'reading-notes.db-shm', 'settings.json', 'books']) {
    const source = path.join(dir, name)
    if (fs.existsSync(source)) fs.renameSync(source, path.join(oldRoot, name))
  }
}

test('recovers old data when a restore crashed after moving files aside', () => {
  const { dir, bookId, noteId } = setup()
  const oldRoot = path.join(dir, '.restore-old-123')
  try {
    createBackup(dir, 'manual', '恢复前')
    moveLiveAside(dir, oldRoot)
    assert.equal(fs.existsSync(path.join(dir, 'reading-notes.db')), false)
    fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({ oldRoot }), 'utf8')

    assert.equal(recoverInterruptedRestore(dir), true)
    assert.equal(fs.existsSync(path.join(dir, 'reading-notes.db')), true)
    assert.equal(fs.existsSync(path.join(dir, MARKER)), false)
    assert.equal(fs.existsSync(oldRoot), false)

    initDatabase(dir)
    assert.equal(listNotes(bookId).length, 1)
    assert.equal(listNotes(bookId)[0]!.id, noteId)
  } finally {
    try {
      closeDatabase()
    } catch {
      // 可能已经关闭。
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('does nothing when there is no pending restore marker', () => {
  const { dir } = setup()
  try {
    assert.equal(recoverInterruptedRestore(dir), false)
    assert.equal(fs.existsSync(path.join(dir, 'reading-notes.db')), true)
  } finally {
    try {
      closeDatabase()
    } catch {
      // 可能已经关闭。
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('ignores a tampered marker that points outside the data directory', () => {
  const { dir, bookId } = setup()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-outside-'))
  try {
    fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({ oldRoot: outside }), 'utf8')
    assert.equal(recoverInterruptedRestore(dir), false)
    // 外部目录不能被当成回滚来源清理或移动。
    assert.equal(fs.existsSync(outside), true)
    assert.equal(fs.existsSync(path.join(dir, MARKER)), false)
    assert.equal(listNotes(bookId).length, 1)
  } finally {
    try {
      closeDatabase()
    } catch {
      // 可能已经关闭。
    }
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})
