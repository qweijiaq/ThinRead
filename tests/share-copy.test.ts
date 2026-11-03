import assert from 'node:assert/strict'
import test from 'node:test'

import { optimizeShareCopy } from '../electron/ai/share-copy.js'
import { keyPoints } from '../src/lib/share-card.js'

test('extracts key points from markdown without headings', () => {
  const points = keyPoints(
    '## 第一章 论专注\n\n专注不是把注意力锁死在一个点上，而是不断把走神的自己带回来。许多人以为自己缺乏意志力。真正可靠的方法不是禁止分心，而是缩短发现自己分心的时间。',
    2,
  )
  assert.equal(points.length, 2)
  assert.ok(points.every((point) => !point.includes('##')))
  assert.ok(points.some((point) => point.includes('真正可靠')))
})

test('falls back to the plain body when there is only one sentence', () => {
  assert.deepEqual(keyPoints('**只有一句话。**', 3), ['只有一句话。'])
})

test('demo rewrite falls back to local extraction', async () => {
  const result = await optimizeShareCopy({
    config: { provider: 'openai', baseUrl: 'http://127.0.0.1:9/v1', model: 'demo', apiKey: '' },
    demo: true,
    title: '本章读薄稿',
    body: '## 第一章\n\n专注不是把注意力锁死在一个点上，而是不断把走神的自己带回来。真正可靠的方法不是禁止分心，而是缩短发现自己分心的时间。',
  })
  assert.ok(result.points.length >= 2)
  assert.ok(result.points.every((point) => !point.includes('##')))
  assert.match(result.note ?? '', /本地规则/)
})
