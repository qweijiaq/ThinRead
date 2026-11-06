import assert from 'node:assert/strict'
import test from 'node:test'

import { getTtsStatus, synthesizeQwenTts, synthesizeTts } from '../electron/tts.js'

test('reports the Qwen TTS model and configured state', () => {
  const status = getTtsStatus()
  assert.equal(status.qwen.model, 'qwen-audio-3.1-tts-flash')
  assert.equal(status.qwen.baseUrl, 'https://dashscope.aliyuncs.com/api/v1')
  assert.equal(status.qwen.voiceA, 'longanhuan_v3.1')
  assert.equal(status.qwen.voiceB, 'xunanchuan_v3.1')
  assert.equal(status.qwen.voiceEn, 'Emily_v3.1')
  assert.equal(status.qwen.pricePerK, 0)
  assert.ok(status.qwen.voices.some((voice) => voice.id === 'longanhuan_v3.1'))
  assert.equal(status.qwen.configured, false)
  assert.equal('edge' in status, false)
  assert.equal('beatra' in status, false)
  assert.equal('openai' in status, false)
})

test('validates synthesis input before calling the provider', async () => {
  await assert.rejects(() => synthesizeTts({ text: '   ', voice: 'longanhuan_v3.1' }), /没有可合成的文字/)
  await assert.rejects(
    () => synthesizeTts({ text: '字'.repeat(2001), voice: 'longanhuan_v3.1' }),
    /太长/,
  )
})

test('calls the Bailian SpeechSynthesizer endpoint and downloads the audio', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init })
    if (String(url) === 'https://cdn.test/qwen.mp3') {
      return new Response(new Uint8Array([0xff, 0xf3, 0x00, 0xc4]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      })
    }
    return new Response(
      JSON.stringify({ output: { audio: { url: 'https://cdn.test/qwen.mp3' } } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
  try {
    const audio = await synthesizeQwenTts(
      { text: '你好，世界。', voice: 'longanhuan_v3.1' },
      {
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
        model: 'qwen-audio-3.1-tts-flash',
        voiceA: 'longanhuan_v3.1',
        voiceB: 'longanhuan_v3.1',
        voiceEn: '',
        pricePerK: 0,
        apiKey: 'test-key',
      },
    )
    assert.equal(requests[0]?.url, 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer')
    assert.equal((requests[0]?.init?.headers as Record<string, string>)?.Authorization, 'Bearer test-key')
    const body = JSON.parse(String(requests[0]?.init?.body)) as {
      model: string
      input: { text: string; voice: string; format: string }
    }
    assert.equal(body.model, 'qwen-audio-3.1-tts-flash')
    assert.equal(body.input.text, '你好，世界。')
    assert.equal(body.input.voice, 'longanhuan_v3.1')
    assert.equal(body.input.format, 'mp3')
    assert.equal(audio.mime, 'audio/mpeg')
    assert.ok(audio.base64.length > 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('surfaces the provider error without returning empty audio', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: 'invalid key' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
  try {
    await assert.rejects(
      () =>
        synthesizeQwenTts(
          { text: '你好', voice: 'longanhuan_v3.1' },
          {
            baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
            model: 'qwen-audio-3.1-tts-flash',
            voiceA: 'longanhuan_v3.1',
            voiceB: 'longanhuan_v3.1',
            voiceEn: '',
            pricePerK: 0,
            apiKey: 'bad',
          },
        ),
      /HTTP 401/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
