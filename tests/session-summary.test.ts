import assert from 'node:assert/strict'
import test from 'node:test'

import { generateSessionSummary } from '../electron/ai/session-summary.js'

test('returns a structured demo summary without calling a model', async () => {
  const summary = await generateSessionSummary({
    config: { provider: 'demo', baseUrl: '', model: 'demo', apiKey: null },
    demo: true,
    bookTitle: '示例书',
    chapterTitle: '第一章',
    chapterText: '这一章讲专注。',
    notes: [],
    minutes: 12,
  })
  assert.equal(summary.title, '阅读小结 · 第一章')
  assert.match(summary.markdown, /## 本次读到/)
  assert.match(summary.markdown, /## 还存着的疑问/)
  assert.match(summary.markdown, /## 下一步/)
  assert.match(summary.markdown, /12 分钟/)
})

test('requires a key when not in demo mode', async () => {
  await assert.rejects(
    () =>
      generateSessionSummary({
        config: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: null },
        demo: false,
        bookTitle: '示例书',
        chapterTitle: '第一章',
        chapterText: '这一章讲专注。',
        notes: [],
        minutes: 12,
      }),
    /API Key/,
  )
})
