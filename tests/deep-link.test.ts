import assert from 'node:assert/strict'
import test from 'node:test'

import { parseDeepLink } from '../shared/deep-link.js'

test('parses thinread book and chapter deep links', () => {
  assert.deepEqual(parseDeepLink('thinread://book/b1/chapter/c2?quote=%E5%8E%9F%E6%96%87'), {
    bookId: 'b1',
    chapterId: 'c2',
    quote: '原文',
  })
  assert.deepEqual(parseDeepLink('thinread://book/b1?chapter=c2'), {
    bookId: 'b1',
    chapterId: 'c2',
    quote: null,
  })
  assert.deepEqual(parseDeepLink('thinread://book/b1'), {
    bookId: 'b1',
    chapterId: null,
    quote: null,
  })
  assert.equal(parseDeepLink('https://example.com/book/b1'), null)
  assert.equal(parseDeepLink('thinread://other/b1'), null)
})
