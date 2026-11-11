import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeReaderStyle } from '../electron/reader-style.js'
import { DEFAULT_READER_STYLE } from '../shared/types.js'
import { withMigratedTypography } from '../src/hooks/useReaderStyle.js'

test('normalizes reading width into a safe range', () => {
  assert.equal(normalizeReaderStyle({}).maxWidth, DEFAULT_READER_STYLE.maxWidth)
  assert.equal(normalizeReaderStyle({ maxWidth: 100 }).maxWidth, 520)
  assert.equal(normalizeReaderStyle({ maxWidth: 2000 }).maxWidth, 980)
  assert.equal(normalizeReaderStyle({ maxWidth: 820 }).maxWidth, 820)
  assert.equal(normalizeReaderStyle({ maxWidth: 'wide' }).maxWidth, DEFAULT_READER_STYLE.maxWidth)
})

test('migrates untouched legacy typography to the new defaults', () => {
  const legacy = {
    ...DEFAULT_READER_STYLE,
    fontSize: 17,
    lineHeight: 1.98,
    paragraphSpacing: 1.15,
    maxWidth: 760,
  }
  const migrated = withMigratedTypography(legacy)
  assert.equal(migrated.lineHeight, DEFAULT_READER_STYLE.lineHeight)
  assert.equal(migrated.paragraphSpacing, DEFAULT_READER_STYLE.paragraphSpacing)
  assert.equal(migrated.maxWidth, DEFAULT_READER_STYLE.maxWidth)

  const customized = withMigratedTypography({ ...legacy, lineHeight: 2.1 })
  assert.equal(customized.lineHeight, 2.1)
  assert.equal(customized.paragraphSpacing, 1.15)
})
