import assert from 'node:assert/strict'
import test from 'node:test'

import { parseFormatPayload } from '../electron/ai/format.js'

test('accepts model JSON that only violates schema length limits', () => {
  const payload = parseFormatPayload(
    '```json\n' +
      JSON.stringify({
        html: '<p>正文</p>',
        removed: [{ reason: 'x'.repeat(120), text: '广告' }],
        style: { fontSize: 99, lineHeight: 9, fontFamily: 'serif', indent: true },
        note: 'n'.repeat(600),
      }) +
      '\n```',
  )
  assert.ok(payload)
  assert.equal(payload.html, '<p>正文</p>')
  assert.equal(payload.removed[0]!.reason.length, 80)
  assert.equal(payload.note.length, 300)
  assert.equal(payload.style?.fontSize, 24)
  assert.equal(payload.style?.lineHeight, 2.6)
})

test('tolerates missing removed/style and rejects a missing html', () => {
  const payload = parseFormatPayload('{"html":"<p>正文</p>","note":"已整理"}')
  assert.ok(payload)
  assert.deepEqual(payload.removed, [])
  assert.equal(payload.style, undefined)
  assert.equal(parseFormatPayload('{"note":"没有正文"}'), null)
  assert.equal(parseFormatPayload('not json'), null)
})
