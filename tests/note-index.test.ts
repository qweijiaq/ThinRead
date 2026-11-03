import assert from 'node:assert/strict'
import test from 'node:test'

import { backlinksFor, buildNoteIndex } from '../src/lib/note-index.js'
import type { Note } from '../shared/types.js'

function note(id: string, title: string, content: string): Note {
  return {
    id,
    bookId: 'book',
    chapterId: 'chapter',
    kind: 'thought',
    title,
    content,
    quote: null,
    quoteVerified: false,
    author: 'user',
    edited: false,
    tags: [],
    section: null,
    importance: null,
    role: null,
    divergences: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

test('builds backlinks in one pass and dedupes repeated references', () => {
  const index = buildNoteIndex([
    note('a', '注意力', '正文'),
    note('b', '环境', '见 [[注意力]] 和 [[注意力]]'),
    note('c', '意志', '也见 [[注意力]]'),
    note('d', '无关', '没有链接'),
  ])
  const target = note('a', '注意力', '正文')
  const backlinks = backlinksFor(index, target)
  assert.deepEqual(backlinks.map((item) => item.id).sort(), ['b', 'c'])
  assert.equal(backlinks.filter((item) => item.id === 'b').length, 1)
})

test('returns a shared empty array for notes nobody links to', () => {
  const index = buildNoteIndex([note('a', '甲', '没有引用')])
  const first = backlinksFor(index, note('a', '甲', '没有引用'))
  const second = backlinksFor(index, note('z', '乙', ''))
  assert.equal(first.length, 0)
  assert.equal(first, second)
})

test('indexes by id for lookups', () => {
  const index = buildNoteIndex([note('a', '甲', ''), note('b', '乙', '')])
  assert.equal(index.byId.get('b')?.title, '乙')
  assert.equal(index.byId.get('missing'), undefined)
})
