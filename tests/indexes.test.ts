import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { closeDatabase, initDatabase } from '../electron/db.js'

test('creates the indexes used by library, trash and task queries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-indexes-'))
  let conn: DatabaseSync | null = null
  try {
    initDatabase(dir)
    conn = new DatabaseSync(path.join(dir, 'reading-notes.db'))

    const names = new Set(
      (conn.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    )
    for (const name of [
      'idx_notes_updated',
      'idx_notes_book_updated',
      'idx_notes_chapter_created',
      'idx_note_trash_deleted',
      'idx_chapter_trash_deleted',
      'idx_tasks_status_updated',
    ]) {
      assert.ok(names.has(name), `缺少索引 ${name}`)
    }

    const libraryPlan = (
      conn
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT n.* FROM notes n
           JOIN books b ON b.id = n.book_id
           LEFT JOIN chapters c ON c.id = n.chapter_id
           ORDER BY n.updated_at DESC, n.rowid DESC
           LIMIT 30 OFFSET 0`,
        )
        .all() as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join('\n')
    assert.doesNotMatch(libraryPlan, /TEMP B-TREE FOR ORDER BY/, `笔记库排序仍在临时排序：\n${libraryPlan}`)
    assert.match(libraryPlan, /idx_notes_updated/)

    const trashPlan = (
      conn
        .prepare('EXPLAIN QUERY PLAN DELETE FROM note_trash WHERE deleted_at < ?')
        .all('2020-01-01T00:00:00.000Z') as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join('\n')
    assert.match(trashPlan, /idx_note_trash_deleted/)
  } finally {
    conn?.close()
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('adds the new indexes when upgrading an existing version-3 database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-index-upgrade-'))
  let conn: DatabaseSync | null = null
  try {
    initDatabase(dir)
    closeDatabase()

    // 模拟一个 v3 的库：结构和数据都在，只是没有 v4 的索引。
    conn = new DatabaseSync(path.join(dir, 'reading-notes.db'))
    conn.exec(`
      DROP INDEX IF EXISTS idx_notes_updated;
      DROP INDEX IF EXISTS idx_notes_book_updated;
      DROP INDEX IF EXISTS idx_notes_chapter_created;
      DROP INDEX IF EXISTS idx_note_trash_deleted;
      DROP INDEX IF EXISTS idx_chapter_trash_deleted;
      DROP INDEX IF EXISTS idx_tasks_status_updated;
      PRAGMA user_version = 3;
    `)
    conn.close()
    conn = null

    initDatabase(dir)
    conn = new DatabaseSync(path.join(dir, 'reading-notes.db'))
    const version = (conn.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    assert.equal(version, 4)
    const names = new Set(
      (conn.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    )
    assert.ok(names.has('idx_notes_updated'))
    assert.ok(names.has('idx_note_trash_deleted'))
  } finally {
    conn?.close()
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
