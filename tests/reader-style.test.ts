import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeReaderStyle } from '../electron/reader-style.js'
import { DEFAULT_READER_STYLE } from '../shared/types.js'

test('normalizes reading width into a safe range', () => {
  assert.equal(normalizeReaderStyle({}).maxWidth, DEFAULT_READER_STYLE.maxWidth)
  assert.equal(normalizeReaderStyle({ maxWidth: 100 }).maxWidth, 520)
  assert.equal(normalizeReaderStyle({ maxWidth: 2000 }).maxWidth, 980)
  assert.equal(normalizeReaderStyle({ maxWidth: 820 }).maxWidth, 820)
  assert.equal(normalizeReaderStyle({ maxWidth: 'wide' }).maxWidth, DEFAULT_READER_STYLE.maxWidth)
})
