import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { closeDatabase, createNote, initDatabase, insertBook, listRelatedNotes } from '../electron/db.js'

test('related notes ignore condensed drafts and require a real tag match', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-related-'))
  try {
    initDatabase(dir)
    const source = insertBook(
      { title: '来源书', author: '', format: 'text', filePath: path.join(dir, 'a.txt') },
      [{ title: '第一章', text: '这一章讨论注意力和环境。', html: null }],
    )
    const target = insertBook(
      { title: '目标书', author: '', format: 'text', filePath: path.join(dir, 'b.txt') },
      [{ title: '第二章', text: '另一本书里也有注意力。', html: null }],
    )

    const point = createNote({
      bookId: target.id,
      kind: 'point',
      title: '注意力有限',
      content: '注意力是有限资源，环境设计可以减少消耗。',
      tags: ['注意力'],
    })
    createNote({
      bookId: target.id,
      kind: 'condensed',
      title: '本章读薄稿',
      content: '这一章从注意力讲到环境设计。',
      tags: ['注意力'],
    })
    createNote({
      bookId: target.id,
      kind: 'question',
      title: '注意力为什么有限？',
      content: '注意力为什么有限？',
      tags: ['注意力'],
    })
    // 只有正文里出现关键词，没有标签：不应因为一个弱命中就被当作关联。
    createNote({
      bookId: target.id,
      kind: 'thought',
      title: '随便记一笔',
      content: '今天又分心了，注意力很难集中。',
      tags: [],
    })

    const related = listRelatedNotes(source.id, ['注意力'], 10)
    assert.deepEqual(related.map((note) => note.id), [point.id])
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
