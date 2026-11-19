import assert from 'node:assert/strict'
import test from 'node:test'

import { parsePageSelection, VISION_BATCH_SIZE } from '../electron/parsers/pdf-vision.js'

test('an empty vision page range covers the whole book across batches', () => {
  const pages = parsePageSelection(undefined, VISION_BATCH_SIZE * 2 + 40)
  assert.equal(pages.length, VISION_BATCH_SIZE * 2 + 40)
  assert.equal(pages[0], 1)
  assert.equal(pages.at(-1), VISION_BATCH_SIZE * 2 + 40)
})

test('an explicit vision range longer than one batch is accepted', () => {
  const pages = parsePageSelection(`1-${VISION_BATCH_SIZE + 30}`, VISION_BATCH_SIZE + 30)
  assert.equal(pages.length, VISION_BATCH_SIZE + 30)
  assert.equal(pages[0], 1)
  assert.equal(pages.at(-1), VISION_BATCH_SIZE + 30)
})

test('vision page selection still validates out-of-range pages', () => {
  assert.throws(() => parsePageSelection('999', 20), /页码无效/)
  assert.throws(() => parsePageSelection('abc', 20), /页码无效/)
  assert.deepEqual(parsePageSelection(undefined, 0), [])
})
