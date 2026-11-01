import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  closeDatabase,
  deleteContent,
  getContent,
  initDatabase,
  optimizeDatabase,
  pruneDeletedContent,
  saveLabArtifact,
} from '../electron/db.js'

test('prunes deleted content after the retention window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-maintenance-'))
  try {
    initDatabase(dir)
    const artifact = saveLabArtifact({
      tool: 'book-club',
      scope: 'latest',
      title: '待清理内容',
      content: '这是一段会被回收站清理的内容。',
    })
    deleteContent(artifact.id)
    assert.ok(getContent(artifact.id))
    const db = new DatabaseSync(path.join(dir, 'reading-notes.db'))
    db.prepare("UPDATE lab_artifact_versions SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(artifact.id)
    db.close()
    assert.equal(pruneDeletedContent(), 1)
    assert.equal(getContent(artifact.id), null)
    assert.doesNotThrow(() => optimizeDatabase())
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
