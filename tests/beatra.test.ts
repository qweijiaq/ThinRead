import assert from 'node:assert/strict'
import test from 'node:test'

import { listBeatraVoices, synthesizeBeatra } from '../electron/beatra.js'

test('maps Beatra MCP voice records to selectable voices', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls++
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (body.method === 'initialize') {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } }),
        { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' } },
      )
    }
    if (body.method === 'notifications/initialized') {
      return new Response('', { status: 202 })
    }
    if (body.method === 'tools/call') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            structuredContent: {
              voices: [
                { id: 'voice-f-1', display_name: '女声一', language: 'zh-CN', gender: 'female' },
                { voice_id: 'voice-m-1', name: '男声一', locale: 'zh-CN', gender: 'male' },
              ],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    throw new Error(`unexpected call ${calls}`)
  }) as typeof fetch
  try {
    const voices = await listBeatraVoices('token-test')
    assert.equal(voices.length, 2)
    assert.deepEqual(voices[0], { id: 'voice-f-1', label: '女声一', language: 'zh-CN', gender: 'female' })
    assert.equal(voices[1]!.id, 'voice-m-1')
    assert.equal(voices[1]!.label, '男声一')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('synthesizes through a Beatra task and downloads the audio artifact', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url)
    if (target.includes('cdn.test')) {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      })
    }
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (body.method === 'initialize') {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } }),
        { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 's' } },
      )
    }
    if (body.method === 'notifications/initialized') return new Response('', { status: 202 })
    if (body.method === 'tools/call') {
      const params = body.params as { name?: string } | undefined
      if (params?.name === 'beatra.speech.synthesize') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { structuredContent: { task_id: 'task-1' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (params?.name === 'beatra.tasks.get') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              structuredContent: {
                status: 'succeeded',
                artifacts: [{ url: 'https://cdn.test/audio.mp3', mime_type: 'audio/mpeg' }],
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
    }
    throw new Error('unexpected Beatra request')
  }) as typeof fetch
  try {
    const audio = await synthesizeBeatra('token-test', '你好', 'voice-f-1', 1)
    assert.equal(audio.mime, 'audio/mpeg')
    assert.equal(audio.base64, Buffer.from([1, 2, 3, 4]).toString('base64'))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('reads an SSE response before the server closes the stream', { timeout: 5_000 }, async () => {
  const originalFetch = globalThis.fetch
  const encoder = new TextEncoder()
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (body.method === 'initialize') {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } }),
        { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'sse-session' } },
      )
    }
    if (body.method === 'notifications/initialized') return new Response('', { status: 202 })
    if (body.method === 'tools/call') {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `event: message\ndata: ${JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                result: { structuredContent: { voices: [{ id: 'sse-voice', name: '长连接音色' }] } },
              })}\n\n`,
            ),
          )
          // 模拟真实 MCP 行为：结果已经发出，但 HTTP 连接继续挂着。
          setTimeout(() => {
            try {
              controller.close()
            } catch {
              // 客户端已经取消读取。
            }
          }, 3_000)
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    throw new Error('unexpected Beatra request')
  }) as typeof fetch
  try {
    const started = Date.now()
    const voices = await listBeatraVoices('token-test')
    assert.equal(voices[0]?.id, 'sse-voice')
    assert.ok(Date.now() - started < 1_500, '不应等待 SSE 连接关闭')
  } finally {
    globalThis.fetch = originalFetch
  }
})
