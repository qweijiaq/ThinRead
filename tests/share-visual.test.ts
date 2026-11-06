import assert from 'node:assert/strict'
import test from 'node:test'

import { findKeyPhrase } from '../src/lib/share-visual.js'

test('extracts a concise key phrase from common note patterns', () => {
  const contrast = findKeyPhrase('所谓自由，不是想做什么就做什么，而是知道什么值得做，然后真的去做。')
  assert.ok(contrast.includes('知道什么值得做'))
  assert.ok(contrast.length <= 14)

  const quoted = findKeyPhrase('这一章讲的是从“把每件事都做完”转向“先决定什么值得做”。')
  assert.ok(quoted.includes('先决定什么值得做'))

  const fallback = findKeyPhrase('注意力是有限的，环境设计比意志力更可靠。')
  assert.ok(fallback.length > 0)
  assert.ok(fallback.length <= 14)

  assert.equal(findKeyPhrase(''), '')
})
