import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { backupBlobsDir, createBackup, deleteBackup, exportBackup, importBackupArchive, restoreBackup } from '../electron/backup.js'
import { closeDatabase, getReadingStatsRecord, initDatabase, mergeReadingStatsRecord, recordReadingStats } from '../electron/db.js'

test('dedupes book files across backups and restores them from blobs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-blobs-'))
  const bookId = crypto.randomUUID()
  const bookDir = path.join(dir, 'books', bookId)
  const bookFile = path.join(bookDir, 'source.epub')
  try {
    initDatabase(dir)
    fs.mkdirSync(bookDir, { recursive: true })
    fs.writeFileSync(bookFile, 'fake-epub-content', 'utf8')

    const first = createBackup(dir, 'manual', '第一份')
    const second = createBackup(dir, 'manual', '第二份')

    // 两份备份引用同一个内容哈希，blob 只存一份。
    const blobs = fs.readdirSync(backupBlobsDir(dir))
    assert.equal(blobs.length, 1, `期望 1 个 blob，实际 ${blobs.length}`)

    // 删掉原文件后从备份恢复。
    fs.rmSync(bookFile)
    restoreBackup(dir, first.id)
    assert.equal(fs.readFileSync(bookFile, 'utf8'), 'fake-epub-content')

    // 还有第二份备份引用 blob，删除第一份不能清掉它。
    deleteBackup(dir, first.id)
    assert.equal(fs.readdirSync(backupBlobsDir(dir)).length, 1)

    // 最后一份也删掉后，blob 被回收。
    deleteBackup(dir, second.id)
    assert.equal(fs.readdirSync(backupBlobsDir(dir)).length, 0)
  } finally {
    try {
      closeDatabase()
    } catch {
      // 可能已经关闭。
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('restores reading stats from a backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-stats-backup-'))
  try {
    initDatabase(dir)
    mergeReadingStatsRecord({
      total: 90,
      days: { '2026-01-01': 90 },
      books: { 'book-a': 90 },
    })
    const backup = createBackup(dir, 'manual', '统计备份')
    recordReadingStats('2026-01-02', 30, 'book-a')
    assert.equal(getReadingStatsRecord().total, 120)

    restoreBackup(dir, backup.id)
    const restored = getReadingStatsRecord()
    assert.equal(restored.total, 90)
    assert.equal(restored.days['2026-01-01'], 90)
    assert.equal(restored.days['2026-01-02'], undefined)
    assert.equal(restored.books['book-a'], 90)
  } finally {
    try {
      closeDatabase()
    } catch {
      // 可能已经关闭。
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('imports an external library zip and restores it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-import-library-'))
  const exported = path.join(dir, 'library.zip')
  try {
    initDatabase(dir)
    mergeReadingStatsRecord({ total: 30, days: { '2026-01-01': 30 }, books: {} })
    const backup = createBackup(dir, 'manual', '原始整库')
    exportBackup(dir, backup.id, exported)
    deleteBackup(dir, backup.id)
    mergeReadingStatsRecord({ total: 60, days: { '2026-01-02': 60 }, books: {} })
    assert.equal(getReadingStatsRecord().total, 90)

    const imported = importBackupArchive(dir, exported)
    assert.equal(imported.label, '导入的整库')
    restoreBackup(dir, imported.id)
    assert.equal(getReadingStatsRecord().total, 30)
  } finally {
    try {
      closeDatabase()
    } catch {
      // 可能已经关闭。
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('keeps the blob when a backup is missing one of its files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-blobs-missing-'))
  const bookId = crypto.randomUUID()
  const bookDir = path.join(dir, 'books', bookId)
  try {
    initDatabase(dir)
    fs.mkdirSync(bookDir, { recursive: true })
    fs.writeFileSync(path.join(bookDir, 'a.txt'), 'a', 'utf8')
    const backup = createBackup(dir, 'manual')
    fs.rmSync(path.join(bookDir, 'a.txt'))
    // 备份文件缺失时拒绝恢复，而不是留下一个残缺的库。
    fs.rmSync(path.join(backupBlobsDir(dir), fs.readdirSync(backupBlobsDir(dir))[0]!))
    assert.throws(() => restoreBackup(dir, backup.id), /缺少书文件/)
  } finally {
    try {
      closeDatabase()
    } catch {
      // 可能已经关闭。
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})


test('rejects a corrupted blob even when its size matches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-blobs-corrupt-'))
  const bookId = crypto.randomUUID()
  const bookDir = path.join(dir, 'books', bookId)
  const bookFile = path.join(bookDir, 'source.epub')
  try {
    initDatabase(dir)
    fs.mkdirSync(bookDir, { recursive: true })
    fs.writeFileSync(bookFile, 'fake-epub-content', 'utf8')
    const backup = createBackup(dir, 'manual')
    const blob = path.join(backupBlobsDir(dir), fs.readdirSync(backupBlobsDir(dir))[0]!)
    fs.writeFileSync(blob, 'fake-epub-CONTENT', 'utf8')
    assert.throws(() => restoreBackup(dir, backup.id), /校验失败/)
  } finally {
    try {
      closeDatabase()
    } catch {
      // 可能已经关闭。
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
