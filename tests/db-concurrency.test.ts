import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { closeDatabase, createNote, getChapters, initDatabase, insertBook } from '../electron/db.js'

const LOCKER = `
const { DatabaseSync } = require('node:sqlite')
const fs = require('node:fs')
const db = new DatabaseSync(process.env.THINREAD_DB)
db.exec('BEGIN IMMEDIATE')
db.prepare('UPDATE books SET title = title WHERE id = ?').run(process.env.THINREAD_BOOK)
fs.writeFileSync(process.env.THINREAD_LOCKFILE, 'locked')
setTimeout(() => {
  db.exec('COMMIT')
  db.close()
}, 300)
`

test('waits for a competing writer instead of failing with SQLITE_BUSY immediately', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-busy-'))
  const lockFile = path.join(dir, 'locked')
  let child: ReturnType<typeof spawn> | null = null
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '并发测试', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '正文内容，足够长以保存为章节。', html: null }],
    )
    const chapterId = getChapters(book.id)[0]!.id

    // 用独立进程先拿到写锁，300ms 后提交；主线程同步写会阻塞，不能靠本地定时器放锁。
    child = spawn(process.execPath, ['-e', LOCKER], {
      env: {
        ...process.env,
        THINREAD_DB: path.join(dir, 'reading-notes.db'),
        THINREAD_BOOK: book.id,
        THINREAD_LOCKFILE: lockFile,
      },
      stdio: 'ignore',
    })

    const deadline = Date.now() + 5_000
    while (!fs.existsSync(lockFile)) {
      if (Date.now() > deadline) throw new Error('子进程没有按时拿到写锁')
    }

    const started = Date.now()
    // busy_timeout = 5000 时这里会等锁释放，而不是立刻抛 "database is locked"。
    const note = createNote({ bookId: book.id, chapterId, kind: 'thought', content: '等锁写入的笔记。' })
    const waited = Date.now() - started
    assert.ok(note.id)
    assert.ok(waited >= 200, `写入没有等待持锁进程：${waited}ms`)

    await new Promise<void>((resolve) => child?.on('exit', () => resolve()))
  } finally {
    child?.kill('SIGKILL')
    try {
      closeDatabase()
    } catch {
      // 数据库可能已经关闭。
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
