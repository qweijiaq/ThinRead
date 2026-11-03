import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { synthesizeOpenAiTts } from '../electron/tts.js'

function startServer(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

test('sends an OpenAI-compatible speech request and returns audio', async () => {
  let received: { path?: string; auth?: string; body?: Record<string, unknown> } = {}
  const server = await startServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      received = {
        path: req.url,
        auth: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
      res.end(Buffer.from([0xff, 0xf3, 0x00, 0xc4]))
    })
  })
  try {
    const audio = await synthesizeOpenAiTts(
      { engine: 'openai', text: '你好，世界。', voice: 'alloy', rate: 1 },
      { baseUrl: server.url, model: 'gpt-4o-mini-tts', voiceA: 'alloy', voiceB: 'verse', apiKey: 'test-key' },
    )
    assert.equal(received.path, '/v1/audio/speech')
    assert.equal(received.auth, 'Bearer test-key')
    assert.equal(received.body?.model, 'gpt-4o-mini-tts')
    assert.equal(received.body?.voice, 'alloy')
    assert.equal(received.body?.input, '你好，世界。')
    assert.equal(audio.mime, 'audio/mpeg')
    assert.ok(audio.base64.length > 0)
  } finally {
    await server.close()
  }
})

test('surfaces the provider error without returning empty audio', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'invalid key' } }))
  })
  try {
    await assert.rejects(
      synthesizeOpenAiTts(
        { engine: 'openai', text: '你好', voice: 'alloy', rate: 1 },
        { baseUrl: server.url, model: 'tts', voiceA: 'alloy', voiceB: 'verse', apiKey: 'bad' },
      ),
      /HTTP 401/,
    )
  } finally {
    await server.close()
  }
})
