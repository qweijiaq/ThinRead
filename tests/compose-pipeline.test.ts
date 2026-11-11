import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { composeBook } from '../electron/ai/book-compose.js'

function completion(text: string): string {
  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-model',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
  })
}

test('compose pipeline works through the provider path without a real API key', async () => {
  const article = [
    '# 环境比意志更可靠',
    '',
    '> 把选择提前做完',
    '',
    '注意力不是无限的。每一次切换任务都会留下认知残留。',
    '',
    '把手机移出视线，比反复提醒自己不要看手机更可靠。',
    '',
    '环境能减少摩擦，但不能替你决定要做什么。方向仍然要由人自己选。',
  ].join('\n')
  const server = http.createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(completion(article))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  try {
    const stages: string[] = []
    const result = await composeBook({
      bookTitle: '环境之书',
      author: '测试作者',
      sources: [
        { title: '第一章', content: '注意力不是无限的。每一次切换任务都会留下认知残留。', cards: ['注意力'] },
        { title: '第二章', content: '把手机移出视线，比反复提醒自己不要看手机更可靠。', cards: ['环境'] },
      ],
      options: { length: 'tight', voice: 'calm' },
      mode: 'standard',
      config: {
        provider: 'openai',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'mock-model',
        apiKey: 'test-key',
      },
      demo: false,
      signal: new AbortController().signal,
      onProgress: (event) => stages.push(event.stage),
    })

    assert.match(result.markdown, /^# 环境比意志更可靠/m)
    assert.match(result.markdown, /把手机移出视线/)
    assert.ok(result.outputChars > 0)
    assert.ok(stages.includes('polish'))
    assert.ok(stages.includes('assemble'))
    assert.equal(result.sourceChapters, 2)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
