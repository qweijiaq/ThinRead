import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeSearchResults } from '../src/lib/search-merge.js'
import type { SearchResult } from '../shared/types.js'

const result = (type: SearchResult['type'], id: string): SearchResult => ({
  type,
  id,
  bookId: 'b1',
  bookTitle: '书',
  chapterId: null,
  chapterTitle: null,
  title: id,
  snippet: '',
  updatedAt: null,
})

test('fuses keyword and semantic ranks with reciprocal rank fusion', () => {
  const keyword = [result('book', 'a'), result('note', 'b')]
  const semantic = [result('note', 'b'), result('note', 'c')]
  const merged = mergeSearchResults(keyword, semantic)
  assert.equal(merged[0]!.id, 'b')
  assert.deepEqual(new Set(merged.map((item) => item.id)), new Set(['a', 'b', 'c']))
})
