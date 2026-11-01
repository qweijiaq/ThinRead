import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { SCHEMA_VERSION, closeDatabase, getSchemaVersion, initDatabase, listNotes } from '../electron/db.js'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-migrate-'))
}

test('sets the schema version on a new database and keeps it idempotent', () => {
  const dir = tempDir()
  try {
    initDatabase(dir)
    assert.equal(getSchemaVersion(), SCHEMA_VERSION)
    closeDatabase()
    initDatabase(dir)
    assert.equal(getSchemaVersion(), SCHEMA_VERSION)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('upgrades a legacy database and preserves its notes', () => {
  const dir = tempDir()
  const dbFile = path.join(dir, 'reading-notes.db')
  try {
    const legacy = new DatabaseSync(dbFile)
    legacy.exec(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        format TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_opened_at TEXT,
        current_chapter_id TEXT
      );
      CREATE TABLE chapters (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        html TEXT,
        chars INTEGER NOT NULL
      );
      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        chapter_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        quote TEXT,
        quote_verified INTEGER NOT NULL DEFAULT 0,
        author TEXT NOT NULL,
        edited INTEGER NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 0;
      INSERT INTO books (id, title, author, format, file_path, created_at)
        VALUES ('b1', '旧书', '作者', 'text', '/tmp/old.txt', '2025-01-01T00:00:00.000Z');
      INSERT INTO chapters (id, book_id, idx, title, text, html, chars)
        VALUES ('c1', 'b1', 0, '第一章', '旧库正文', NULL, 4);
      INSERT INTO notes (id, book_id, chapter_id, kind, title, content, author, tags, created_at, updated_at)
        VALUES ('n1', 'b1', 'c1', 'point', '旧笔记', '旧笔记正文', 'ai', '["旧标签"]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
    `)
    legacy.close()

    initDatabase(dir)
    assert.equal(getSchemaVersion(), SCHEMA_VERSION)
    const notes = listNotes('b1', 'c1')
    assert.equal(notes.length, 1)
    assert.equal(notes[0]!.title, '旧笔记')
    assert.deepEqual(notes[0]!.tags, ['旧标签'])
    closeDatabase()

    const upgraded = new DatabaseSync(dbFile)
    const columns = (upgraded.prepare('PRAGMA table_info(notes)').all() as unknown as Array<{ name: string }>).map(
      (row) => row.name,
    )
    assert.ok(columns.includes('section'))
    assert.ok(columns.includes('importance'))
    assert.ok(columns.includes('role'))
    assert.ok(columns.includes('expansion'))
    const bookColumns = (
      upgraded.prepare('PRAGMA table_info(books)').all() as unknown as Array<{ name: string }>
    ).map((row) => row.name)
    assert.ok(bookColumns.includes('genre'))
    assert.ok(bookColumns.includes('cover_path'))
    upgraded.close()
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
