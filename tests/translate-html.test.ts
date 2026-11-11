import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { translateChapter } from '../electron/ai/translate.js'

function completion(text: string): string {
  return JSON.stringify({
    id: 'chatcmpl-translate',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-model',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  })
}

test('translation keeps heading and table structure', async () => {
  const server = http.createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(completion(JSON.stringify(['标题', '这是正文。', '单元格'])))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  try {
    const result = await translateChapter({
      bookTitle: 'English Book',
      chapterTitle: 'Chapter One',
      html: '<h2>Heading</h2><p>This is the body.</p><table><tbody><tr><td>Cell</td></tr></tbody></table>',
      text: `Heading\n\nThis is the body. ${'This is a longer English sentence for language detection. '.repeat(8)}\n\nCell`,
      config: {
        provider: 'openai',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'mock-model',
        apiKey: 'test-key',
      },
      signal: new AbortController().signal,
    })

    assert.match(result.html, /<h2>标题<\/h2>/)
    assert.match(result.html, /<p>这是正文。<\/p>/)
    assert.match(result.html, /<td>单元格<\/td>/)
    assert.match(result.html, /<table>/)
    assert.match(result.text, /标题/)
    assert.match(result.text, /单元格/)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
