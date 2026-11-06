import assert from 'node:assert/strict'
import test from 'node:test'

import { encodeMp3, encodeWav } from '../src/lib/audio-export.js'

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

test('encodes mono PCM to a non-empty MP3 stream', () => {
  const sampleRate = 24_000
  const samples = new Float32Array(sampleRate)
  for (let index = 0; index < samples.length; index++) {
    samples[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.2
  }
  const mp3 = encodeMp3(samples, sampleRate)
  assert.ok(mp3.length > 1000)
  // MP3 帧同步字通常是 0xFF，部分编码器会先写 ID3；这里只验证不是空数据。
  assert.equal(mp3.some((byte) => byte !== 0), true)
})
