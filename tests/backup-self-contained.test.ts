import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { unzipSync } from 'fflate'

import {
  createBackup,
  exportSelfContainedBackup,
  importBackupArchive,
  restoreBackup,
} from '../electron/backup.js'
import { closeDatabase, getBookSummary, initDatabase, insertBook } from '../electron/db.js'

test('self-contained backups include the referenced book files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-self-contained-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '自包含测试', author: '作者', format: 'text', filePath: path.join(dir, 'books', 'book', 'source.txt') },
      [{ title: '第一章', text: '正文', html: '<p>正文</p>' }],
    )
    const bookDir = path.join(dir, 'books', book.id)
    fs.mkdirSync(bookDir, { recursive: true })
    fs.writeFileSync(path.join(bookDir, 'source.txt'), 'hello book payload')

    const info = createBackup(dir, 'manual', '自包含')
    const archive = path.join(dir, 'self-contained.zip')
    exportSelfContainedBackup(dir, info.id, archive)

    const files = unzipSync(new Uint8Array(fs.readFileSync(archive)))
    const manifest = JSON.parse(new TextDecoder().decode(files['books-manifest.json'])) as Record<
      string,
      { hash: string }
    >
    const hashes = Object.values(manifest).map((ref) => ref.hash)
    assert.ok(hashes.length > 0)
    for (const hash of hashes) {
      assert.ok(files[`blobs/${hash}`], `missing blob ${hash}`)
    }
    assert.equal(new TextDecoder().decode(files[`blobs/${hashes[0]}`]), 'hello book payload')
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})


test('restores a self-contained snapshot on a machine with no local blobs', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-self-source-'))
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-self-target-'))
  try {
    initDatabase(sourceDir)
    const book = insertBook(
      { title: '跨设备恢复', author: '作者', format: 'text', filePath: path.join(sourceDir, 'books', 'book', 'source.txt') },
      [{ title: '第一章', text: '正文', html: '<p>正文</p>' }],
    )
    const bookDir = path.join(sourceDir, 'books', book.id)
    fs.mkdirSync(bookDir, { recursive: true })
    fs.writeFileSync(path.join(bookDir, 'source.txt'), 'cross-device payload')

    const info = createBackup(sourceDir, 'manual', '跨设备')
    const archive = path.join(sourceDir, 'snapshot.zip')
    exportSelfContainedBackup(sourceDir, info.id, archive)
    closeDatabase()

    initDatabase(targetDir)
    const imported = importBackupArchive(targetDir, archive)
    restoreBackup(targetDir, imported.id)
    assert.equal(getBookSummary(book.id)?.title, '跨设备恢复')
    const restored = path.join(targetDir, 'books', book.id, 'source.txt')
    assert.equal(fs.readFileSync(restored, 'utf8'), 'cross-device payload')
  } finally {
    closeDatabase()
    fs.rmSync(sourceDir, { recursive: true, force: true })
    fs.rmSync(targetDir, { recursive: true, force: true })
  }
})
