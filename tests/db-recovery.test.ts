import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createBackup, recoverCorruptDatabase } from '../electron/backup.js'
import { closeDatabase, initDatabase } from '../electron/db.js'

test('moves a corrupt database aside and restores the latest backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-recovery-'))
  try {
    initDatabase(dir)
    const backup = createBackup(dir, 'manual', '恢复前')
    closeDatabase()

    fs.writeFileSync(path.join(dir, 'reading-notes.db'), 'not a sqlite database', 'utf8')
    const result = recoverCorruptDatabase(dir)
    assert.equal(result.recovered, true)
    assert.equal(result.backupId, backup.id)
    assert.ok(result.movedTo && fs.existsSync(result.movedTo))
    assert.equal(fs.readFileSync(result.movedTo!, 'utf8'), 'not a sqlite database')

    assert.ok(fs.existsSync(path.join(dir, 'reading-notes.db')))
  } finally {
    try {
      closeDatabase()
    } catch {
      // 可能已经关闭。
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('keeps the corrupt file when there is no backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-recovery-none-'))
  try {
    fs.writeFileSync(path.join(dir, 'reading-notes.db'), 'broken', 'utf8')
    const result = recoverCorruptDatabase(dir)
    assert.equal(result.recovered, false)
    assert.match(result.reason ?? '', /备份/)
    assert.ok(result.movedTo && fs.existsSync(result.movedTo))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
