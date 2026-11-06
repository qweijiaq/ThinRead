import assert from 'node:assert/strict'
import test from 'node:test'

import { rewriteComposeSection } from '../electron/ai/section-rewrite.js'

const base = {
  config: { provider: 'demo' as const, baseUrl: '', model: 'demo', apiKey: null },
  demo: true,
  bookTitle: '示例书',
  fullText: '前文。需要重写的这一段。后文。',
}

test('returns the selected passage unchanged in demo mode', async () => {
  const result = await rewriteComposeSection({
    ...base,
    start: 3,
    end: 12,
  })
  assert.equal(result.text, '需要重写的这一段。')
  assert.equal(result.demo, true)
})

test('rejects an empty or too-long selection', async () => {
  await assert.rejects(
    () => rewriteComposeSection({ ...base, start: 0, end: 0 }),
    /先选中/,
  )
  await assert.rejects(
    () =>
      rewriteComposeSection({
        ...base,
        fullText: '字'.repeat(6001),
        start: 0,
        end: 6001,
      }),
    /太长/,
  )
})

test('requires a key when not in demo mode', async () => {
  await assert.rejects(
    () =>
      rewriteComposeSection({
        ...base,
        demo: false,
        config: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: null },
        start: 3,
        end: 12,
      }),
    /API Key/,
  )
})
