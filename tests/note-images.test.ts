import assert from 'node:assert/strict'
import test from 'node:test'

import { createCanvas } from '@napi-rs/canvas'

import {
  imagePromptBlock,
  imageSignature,
  prepareNoteImages,
  supportsVision,
  type NoteImage,
} from '../electron/ai/note-images.js'

function sampleImage(): NoteImage {
  const canvas = createCanvas(160, 120)
  const context = canvas.getContext('2d')
  context.fillStyle = '#2f4f9e'
  context.fillRect(0, 0, 160, 120)
  const dataUrl = `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`
  return {
    id: 'img-1',
    alt: 'A blue rectangle',
    caption: '图 1 蓝色方块',
    context: '这是一张测试图片。',
    dataUrl,
    signature: imageSignature(dataUrl),
  }
}

test('detects vision-capable models conservatively', () => {
  assert.equal(
    supportsVision({ provider: 'openai', baseUrl: '', model: 'gpt-4o', apiKey: 'x' }),
    true,
  )
  assert.equal(
    supportsVision({ provider: 'deepseek', baseUrl: '', model: 'deepseek-chat', apiKey: 'x' }),
    false,
  )
  assert.equal(
    supportsVision({ provider: 'ollama', baseUrl: '', model: 'llava:latest', apiKey: null }),
    true,
  )
})

test('compresses images when vision is enabled', async () => {
  const image = sampleImage()
  const prepared = await prepareNoteImages(
    [image],
    { provider: 'openai', baseUrl: '', model: 'gpt-4o', apiKey: 'x' },
    'auto',
    new AbortController().signal,
  )
  assert.equal(prepared.length, 1)
  assert.equal(prepared[0]?.mediaType, 'image/jpeg')
  assert.ok(prepared[0]?.data)
  assert.equal(prepared[0]?.dataUrl, '')
})

test('keeps captions as text but skips binary data for text-only models', async () => {
  const prepared = await prepareNoteImages(
    [sampleImage()],
    { provider: 'deepseek', baseUrl: '', model: 'deepseek-chat', apiKey: 'x' },
    'auto',
    new AbortController().signal,
  )
  assert.equal(prepared[0]?.data, undefined)
  const prompt = imagePromptBlock(prepared)
  assert.match(prompt, /蓝色方块/)
  assert.match(prompt, /A blue rectangle/)
})
