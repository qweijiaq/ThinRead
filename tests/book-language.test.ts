import assert from 'node:assert/strict'
import test from 'node:test'

import { detectBookLanguage } from '../electron/book-language.js'

test('detects an English book as foreign', () => {
  const text = 'Attention is not unlimited. Every task switch leaves a cognitive residue. '.repeat(40)
  const result = detectBookLanguage([text])
  assert.equal(result.foreign, true)
  assert.match(result.language, /英文/)
})

test('does not treat a Chinese book with English terms as foreign', () => {
  const chinese = '专注不是把注意力锁死在一个点上，而是不断把走神的自己带回来。'.repeat(30)
  const terms = 'Daniel Kahneman, attention residue, working memory, cognitive load. '.repeat(8)
  const result = detectBookLanguage([chinese, terms])
  assert.equal(result.foreign, false)
  assert.equal(result.language, '中文')
})

test('detects Japanese and Korean by kana and hangul', () => {
  assert.equal(detectBookLanguage(['これは日本語の本文です。'.repeat(80)]).foreign, true)
  assert.equal(detectBookLanguage(['이것은 한국어 본문입니다. '.repeat(80)]).foreign, true)
})

test('does not translate an empty or very short book', () => {
  assert.equal(detectBookLanguage([]).foreign, false)
  assert.equal(detectBookLanguage(['短章。']).foreign, false)
})
