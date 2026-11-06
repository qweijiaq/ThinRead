import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { closeDatabase, deleteContent, getContent, initDatabase, listContentVersions, purgeContent, purgeDeletedContent, saveLabArtifact } from '../electron/db.js'

test('lists versions for the same tool and scope, excluding deleted rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-versions-'))
  try {
    initDatabase(dir)
    const first = saveLabArtifact({
      tool: 'chapter-notes',
      scope: 'chapter:one',
      title: '第一版',
      content: '第一版内容',
      kind: 'notes',
    })
    const second = saveLabArtifact({
      tool: 'chapter-notes',
      scope: 'chapter:one',
      title: '第二版',
      content: '第二版内容',
      kind: 'notes',
    })
    saveLabArtifact({
      tool: 'chapter-notes',
      scope: 'chapter:two',
      title: '另一章',
      content: '另一章内容',
      kind: 'notes',
    })

    const versions = listContentVersions('chapter-notes', 'chapter:one')
    assert.equal(versions.length, 2)
    assert.deepEqual(
      versions.map((item) => item.id).sort(),
      [first.id, second.id].sort(),
    )

    deleteContent(first.id)
    const afterDelete = listContentVersions('chapter-notes', 'chapter:one')
    assert.equal(afterDelete.length, 1)
    assert.equal(afterDelete[0]?.id, second.id)
    assert.equal(listContentVersions('', 'chapter:one').length, 0)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('only permanently deletes content already in the trash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-purge-'))
  try {
    initDatabase(dir)
    const item = saveLabArtifact({
      tool: 'book-compose',
      scope: 'book:one',
      title: '成稿',
      content: '成稿内容',
      kind: 'compose',
    })
    assert.throws(() => purgeContent(item.id), /回收站/)
    assert.ok(getContent(item.id))
    deleteContent(item.id)
    purgeContent(item.id)
    assert.equal(getContent(item.id), null)
    assert.equal(listContentVersions('book-compose', 'book:one').length, 0)
    assert.throws(() => purgeContent(item.id), /回收站/)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('empties the content trash in one call', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-purge-all-'))
  try {
    initDatabase(dir)
    const first = saveLabArtifact({ tool: 'book-club', scope: 'one', title: '一', content: '一', kind: 'report' })
    const second = saveLabArtifact({ tool: 'book-club', scope: 'two', title: '二', content: '二', kind: 'report' })
    deleteContent(first.id)
    deleteContent(second.id)
    assert.equal(purgeDeletedContent(), 2)
    assert.equal(getContent(first.id), null)
    assert.equal(getContent(second.id), null)
    assert.equal(purgeDeletedContent(), 0)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
