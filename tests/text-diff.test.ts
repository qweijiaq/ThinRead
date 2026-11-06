import assert from 'node:assert/strict'
import test from 'node:test'

import { diffStats, diffText } from '../src/lib/text-diff.js'

test('marks unchanged, added and removed lines', () => {
  const lines = diffText('第一行\n第二行\n第三行', '第一行\n第二行（改）\n第三行\n第四行')
  assert.deepEqual(
    lines.map((line) => line.kind),
    ['same', 'remove', 'add', 'same', 'add'],
  )
  assert.deepEqual(diffStats(lines), { added: 2, removed: 1, unchanged: 2 })
})

test('handles identical and empty text', () => {
  assert.deepEqual(diffText('同样的内容', '同样的内容'), [{ kind: 'same', text: '同样的内容' }])
  assert.deepEqual(diffText('', ''), [])
  assert.deepEqual(diffText('旧', ''), [{ kind: 'remove', text: '旧' }])
  assert.deepEqual(diffText('', '新'), [{ kind: 'add', text: '新' }])
})

test('normalizes CRLF before comparing', () => {
  const lines = diffText('第一行\r\n第二行', '第一行\n第二行')
  assert.deepEqual(lines, [
    { kind: 'same', text: '第一行' },
    { kind: 'same', text: '第二行' },
  ])
})
