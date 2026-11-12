import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { unzipSync } from 'fflate'

import { createBackup, exportSelfContainedBackup } from '../electron/backup.js'
import { closeDatabase, initDatabase, insertBook } from '../electron/db.js'

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
