import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { getTtsStatus, kokoroModelDir } from '../electron/tts.js'

test('reports Edge voices and an actionable Kokoro setup path', () => {
  const previous = process.env.THINREAD_DISABLE_BUNDLED_KOKORO
  process.env.THINREAD_DISABLE_BUNDLED_KOKORO = '1'
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-tts-'))
  try {
    const status = getTtsStatus(dir)
    assert.ok(status.edge.voices.some((voice) => voice.id === 'zh-CN-XiaoxiaoNeural'))
    assert.equal(status.kokoro.ready, false)
    assert.equal(status.kokoro.path, kokoroModelDir(dir))
    assert.ok(status.kokoro.missing.includes('onnx/model.onnx'))
    assert.match(status.kokoro.downloadUrl, /Kokoro-82M-v1\.1-zh-ONNX/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    if (previous === undefined) delete process.env.THINREAD_DISABLE_BUNDLED_KOKORO
    else process.env.THINREAD_DISABLE_BUNDLED_KOKORO = previous
  }
})

test('detects a manually downloaded Kokoro model and voices', () => {
  const previous = process.env.THINREAD_DISABLE_BUNDLED_KOKORO
  process.env.THINREAD_DISABLE_BUNDLED_KOKORO = '1'
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-tts-ready-'))
  try {
    const modelDir = kokoroModelDir(dir)
    fs.mkdirSync(path.join(modelDir, 'onnx'), { recursive: true })
    fs.mkdirSync(path.join(modelDir, 'voices'), { recursive: true })
    for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) {
      fs.writeFileSync(path.join(modelDir, file), '{}')
    }
    fs.writeFileSync(path.join(modelDir, 'onnx', 'model.onnx'), Buffer.alloc(1024 * 1024))
    fs.writeFileSync(path.join(modelDir, 'voices', 'zf_001.bin'), 'x')
    const status = getTtsStatus(dir)
    assert.equal(status.kokoro.ready, true)
    assert.equal(status.kokoro.modelFile, 'onnx/model.onnx')
    assert.equal(status.kokoro.voices[0]?.id, 'zf_001')
    assert.equal(status.kokoro.voices[0]?.gender, 'female')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    if (previous === undefined) delete process.env.THINREAD_DISABLE_BUNDLED_KOKORO
    else process.env.THINREAD_DISABLE_BUNDLED_KOKORO = previous
  }
})
