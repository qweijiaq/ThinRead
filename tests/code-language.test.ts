import assert from 'node:assert/strict'
import test from 'node:test'

import { detectCodeLanguage, languageFromClassName, shouldCollapseCode } from '../src/lib/code-language.js'

test('uses explicit language classes first', () => {
  assert.equal(languageFromClassName('language-ts'), 'TypeScript')
  assert.equal(languageFromClassName('lang-python'), 'Python')
  assert.equal(detectCodeLanguage('const value = 1', 'language-ts'), 'TypeScript')
})

test('detects common languages from content', () => {
  assert.equal(detectCodeLanguage('{"name":"thinread","private":true}'), 'JSON')
  assert.equal(detectCodeLanguage('SELECT id, title FROM books WHERE hidden = 0;'), 'SQL')
  assert.equal(
    detectCodeLanguage('export function sum(a: number, b: number) {\n  return a + b\n}\n'),
    'JavaScript',
  )
  assert.equal(detectCodeLanguage('#!/usr/bin/env bash\npnpm test'), 'Shell')
  assert.equal(detectCodeLanguage('FROM node:22\nRUN pnpm install'), 'Dockerfile')
})

test('returns null when the language is unclear', () => {
  assert.equal(detectCodeLanguage('这是一段普通的说明文字，没有代码特征。'), null)
  assert.equal(detectCodeLanguage('短'), null)
})

test('collapses only long code blocks', () => {
  assert.equal(shouldCollapseCode('const a = 1'), false)
  assert.equal(shouldCollapseCode(Array.from({ length: 24 }, (_, index) => `line ${index}`).join('\n')), true)
})
