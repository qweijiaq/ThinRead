import assert from 'node:assert/strict'
import test from 'node:test'

import { encodeWav } from '../src/lib/audio-export.js'

test('encodes mono 16-bit PCM WAV with the expected header', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1])
  const buffer = encodeWav(samples, 24_000)
  const view = new DataView(buffer)
  const text = (offset: number, length: number): string =>
    Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join('')
  assert.equal(text(0, 4), 'RIFF')
  assert.equal(text(8, 4), 'WAVE')
  assert.equal(text(12, 4), 'fmt ')
  assert.equal(text(36, 4), 'data')
  assert.equal(view.getUint16(20, true), 1)
  assert.equal(view.getUint16(22, true), 1)
  assert.equal(view.getUint32(24, true), 24_000)
  assert.equal(view.getUint32(40, true), samples.length * 2)
  assert.equal(buffer.byteLength, 44 + samples.length * 2)
  assert.equal(view.getInt16(44 + 2 * 3, true), 32767)
})
