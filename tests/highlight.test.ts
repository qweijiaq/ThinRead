import assert from 'node:assert/strict'
import test from 'node:test'

import { highlightCode } from '../src/lib/highlight.js'

test('highlights an explicitly detected language', async () => {
  const result = await highlightCode('const answer = 42', 'JavaScript')
  assert.match(result.html, /hljs-keyword/)
  assert.match(result.html, /hljs-number/)
  assert.equal(result.language, 'javascript')
})

test('highlights JSON strings and keys', async () => {
  const result = await highlightCode('{"book":"ThinRead","pages":320}', 'JSON')
  assert.match(result.html, /hljs-attr/)
  assert.match(result.html, /hljs-string/)
})

test('keeps text readable when auto-detection has no strong match', async () => {
  const result = await highlightCode('这是一段普通的说明文字，没有明显的代码特征。', null)
  assert.match(result.html, /普通的说明文字/)
})
