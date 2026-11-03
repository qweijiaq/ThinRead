import assert from 'node:assert/strict'
import test from 'node:test'

import { composeBook } from '../electron/ai/book-compose.js'
import type { ModelConfig } from '../electron/ai/provider.js'

const config: ModelConfig = { provider: 'demo', baseUrl: '', model: 'demo', apiKey: null }

test('demo compose keeps chapter structure and rejects banned boilerplate', async () => {
  const progress: string[] = []
  const result = await composeBook({
    bookTitle: '评测书',
    author: '作者',
    sources: [
      { title: '第一章', content: '注意力有限。环境设计可以减少一次选择，但不能代替目标。', cards: ['注意力'] },
      { title: '第二章', content: '阅读需要回到原文核对前提，证据对得上才值得保存。', cards: ['证据'] },
    ],
    options: { length: 'tight', voice: 'calm' },
    mode: 'fast',
    config,
    demo: true,
    signal: new AbortController().signal,
    onProgress: (event) => progress.push(event.stage),
  })
  assert.match(result.markdown, /^# /)
  assert.match(result.markdown, /## 第一章/)
  assert.match(result.markdown, /## 第二章/)
  assert.doesNotMatch(result.markdown, /综上所述|首先|其次|最后，/)
  assert.equal(result.sourceChapters, 2)
  assert.ok(result.outputChars > 0)
  assert.ok(progress.includes('rewrite'))
  assert.equal(result.promptVersion, 'compose-v4-demo')
})
