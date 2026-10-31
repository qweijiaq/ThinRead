import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { closeDatabase, createNote, initDatabase, insertBook, updateNote } from '../electron/db.js'
import { clearSearchIndex, searchIndex, tokenize } from '../electron/search-index.js'

test('tokenizes Chinese bigrams and Latin words', () => {
  const tokens = tokenize('阅读的艺术 habit')
  assert.ok(tokens.includes('阅读'))
  assert.ok(tokens.includes('读的'))
  assert.ok(tokens.includes('艺术'))
  assert.ok(tokens.includes('habit'))
  assert.equal(tokens.includes('阅'), false)
  assert.deepEqual(tokenize('书'), [])
  const hyphenated = tokenize('well-being')
  assert.ok(hyphenated.includes('well-being'))
  assert.ok(hyphenated.includes('well'))
  assert.ok(hyphenated.includes('being'))
})

test('builds a local index over chapters, books and notes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-search-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '深度工作', author: 'Cal Newport', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '专注力', text: '专注不是意志力，而是环境设计。', html: null }],
    )
    const chapter = searchIndex('专注')
    assert.ok(chapter)
    assert.equal(chapter[0]?.type, 'chapter')
    assert.equal(chapter[0]?.bookTitle, '深度工作')
    assert.match(chapter[0]!.snippet, /专注/)

    const byAuthor = searchIndex('newport')
    assert.ok(byAuthor?.some((result) => result.type === 'book' && result.id === book.id))

    const created = createNote({ bookId: book.id, kind: 'idea', title: '环境先于意志', content: '先把手机拿走，再谈专注。' })
    const note = searchIndex('手机')
    assert.ok(note?.some((result) => result.type === 'note' && result.title === '环境先于意志'))

    updateNote(created.id, { content: '把通知关掉，注意力才回得来。' })
    assert.ok(searchIndex('通知')?.some((result) => result.id === created.id))

    assert.deepEqual(searchIndex('不存在的词'), [])
    assert.equal(searchIndex('专'), null)
    clearSearchIndex()
    assert.ok(searchIndex('专注')?.length)
  } finally {
    clearSearchIndex()
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
