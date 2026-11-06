import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildKnowledgeMap } from '../electron/knowledge-map.js'
import {
  closeDatabase,
  createNote,
  getChapters,
  initDatabase,
  insertBook,
  listLibraryNotes,
} from '../electron/db.js'

test('keeps untagged notes visible as an unclassified concept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-map-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '地图测试', author: '', format: 'text', filePath: path.join(dir, 'book.txt') },
      [{ title: '第一章', text: '第一章正文内容。', html: null }],
    )
    const chapter = getChapters(book.id)[0]!
    createNote({
      bookId: book.id,
      chapterId: chapter.id,
      kind: 'point',
      title: '有标签',
      content: '有标签的笔记。',
      tags: ['专注'],
    })
    createNote({
      bookId: book.id,
      chapterId: chapter.id,
      kind: 'point',
      title: '没有标签',
      content: '还没有归类的笔记。',
      tags: [],
    })

    const map = buildKnowledgeMap()
    assert.equal(map.untaggedNotes, 1)
    const untagged = map.nodes.find((node) => node.id === 'concept:__untagged__')
    assert.equal(untagged?.label, '未归类')
    assert.equal(untagged?.noteCount, 1)
    assert.ok(map.edges.some((edge) => edge.target === 'concept:__untagged__' || edge.source === 'concept:__untagged__'))
    assert.equal(listLibraryNotes({ untagged: true }).length, 1)
    assert.equal(listLibraryNotes({ untagged: true })[0]?.title, '没有标签')
    assert.equal(listLibraryNotes({ tag: '专注' }).length, 1)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
