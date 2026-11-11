import assert from 'node:assert/strict'
import test from 'node:test'

import { splitTranslationChunks } from '../electron/ai/translate.js'

test('splits translation chunks on paragraphs and caps each chunk', () => {
  const paragraphs = Array.from({ length: 20 }, (_, index) => `Paragraph ${index} ${'word '.repeat(120)}`.trim())
  const chunks = splitTranslationChunks(paragraphs.join('\n\n'))
  assert.ok(chunks.length > 1)
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 6_200, `chunk too long: ${chunk.length}`)
    assert.ok(chunk.trim().length > 0)
  }
  assert.match(chunks.join('\n\n'), /Paragraph 0/)
  assert.match(chunks.join('\n\n'), /Paragraph 19/)
})

test('hard-splits a single oversized paragraph without losing text', () => {
  const paragraph = `${'A sentence. '.repeat(900)}END`
  const chunks = splitTranslationChunks(paragraph)
  assert.ok(chunks.length > 1)
  for (const chunk of chunks) assert.ok(chunk.length <= 6_200)
  assert.match(chunks.join(''), /END$/)
})
