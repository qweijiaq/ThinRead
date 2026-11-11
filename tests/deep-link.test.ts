import assert from 'node:assert/strict'
import test from 'node:test'

import { parseCaptureLink, parseDeepLink } from '../shared/deep-link.js'

test('parses book deep links', () => {
  assert.deepEqual(parseDeepLink('thinread://book/b1/chapter/c2?quote=hello'), {
    bookId: 'b1',
    chapterId: 'c2',
    quote: 'hello',
  })
})

test('parses browser capture links', () => {
  const target = parseCaptureLink(
    'thinread://capture?url=https%3A%2F%2Fexample.com%2Fpost&title=Example%20Post&selection=Selected%20text',
  )
  assert.deepEqual(target, {
    url: 'https://example.com/post',
    title: 'Example Post',
    selection: 'Selected text',
  })
  assert.equal(parseCaptureLink('thinread://capture?url=file:///etc/passwd'), null)
  assert.equal(parseCaptureLink('thinread://book/b1'), null)
})
