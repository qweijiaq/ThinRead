import assert from 'node:assert/strict'
import test from 'node:test'

import { parseClassifyJson } from '../electron/ai/classify.js'

test('parses fenced classification JSON from models without structured output', () => {
  const parsed = parseClassifyJson('```json\n{"chapters":[{"index":0,"kind":"content","reason":"正文","confidence":0.9}]}\n```')
  assert.equal(parsed?.chapters[0]?.kind, 'content')
  assert.equal(parsed?.chapters[0]?.index, 0)
})

test('accepts a bare array and fills missing optional fields', () => {
  const parsed = parseClassifyJson('[{"index":1,"kind":"nav","reason":"目录","confidence":0.8}]')
  assert.equal(parsed?.chapters[0]?.kind, 'nav')
  const loose = parseClassifyJson('[{"index":2,"kind":"front"}]')
  assert.equal(loose?.chapters[0]?.confidence, 0.8)
  assert.equal(parseClassifyJson('模型没有返回 JSON'), null)
})
