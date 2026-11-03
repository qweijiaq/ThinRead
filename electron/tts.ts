import type { TtsAudio, TtsStatus, TtsSynthesisRequest, TtsVoice } from '../shared/types.js'
import { getOpenAiTtsConfig } from './settings.js'

/**
 * 听读的在线音色。系统语音由渲染层直接使用 SpeechSynthesis，不经过这里；
 * Beatra 的合成在 beatra.ts，按字符计费。
 */
const EDGE_VOICES: TtsVoice[] = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女声', language: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女声', language: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-YunxiNeural', label: '云希 · 男声', language: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 · 男声', language: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunjianNeural', label: '云健 · 男声', language: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunxiaNeural', label: '云夏 · 男声', language: 'zh-CN', gender: 'male' },
]

export function getTtsStatus(beatraConfigured = false): TtsStatus {
  let openai: ReturnType<typeof getOpenAiTtsConfig>
  try {
    openai = getOpenAiTtsConfig()
  } catch {
    openai = { baseUrl: '', model: 'gpt-4o-mini-tts', voiceA: 'alloy', voiceB: 'verse', apiKey: null }
  }
  return {
    edge: { online: true, voices: EDGE_VOICES },
    beatra: { configured: beatraConfigured },
    openai: {
      configured: Boolean(openai.apiKey && openai.baseUrl),
      baseUrl: openai.baseUrl,
      model: openai.model,
      voiceA: openai.voiceA,
      voiceB: openai.voiceB,
    },
  }
}

export async function synthesizeOpenAiTts(
  request: TtsSynthesisRequest,
  config: ReturnType<typeof getOpenAiTtsConfig>,
): Promise<TtsAudio> {
  if (!config.baseUrl.trim()) throw new Error('还没有填写 OpenAI-compatible TTS 的 Base URL。')
  if (!config.apiKey) throw new Error('还没有配置 OpenAI-compatible TTS 的 API Key。')
  const url = `${config.baseUrl.trim().replace(/\/$/, '')}/audio/speech`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      voice: request.voice || config.voiceA,
      input: request.text,
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    throw new Error(`OpenAI TTS 请求失败：HTTP ${response.status}${detail ? ` ${detail}` : ''}`)
  }
  const audio = Buffer.from(await response.arrayBuffer())
  if (audio.length === 0) throw new Error('OpenAI TTS 没有返回音频。')
  return { mime: 'audio/mpeg', base64: audio.toString('base64') }
}

function edgeRate(rate: number): string {
  const percent = Math.round((Math.min(2, Math.max(0.5, rate)) - 1) * 100)
  return `${percent >= 0 ? '+' : ''}${percent}%`
}

export async function synthesizeTts(request: TtsSynthesisRequest): Promise<TtsAudio> {
  const text = request.text.replace(/\s+/g, ' ').trim()
  if (!text) throw new Error('没有可合成的文字。')
  if (text.length > 2_000) throw new Error('单段文字太长，请分段后再听。')
  const rate = Math.min(2, Math.max(0.5, request.rate || 1))

  if (request.engine === 'openai') {
    return synthesizeOpenAiTts(request, getOpenAiTtsConfig())
  }
  if (request.engine !== 'edge') throw new Error('未知的语音引擎。')

  const voice = EDGE_VOICES.find((item) => item.id === request.voice)
  if (!voice) throw new Error('不支持的 Edge 音色。')
  const { EdgeTTS } = await import('node-edge-tts')
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const tts = new EdgeTTS({
        voice: voice.id,
        lang: 'zh-CN',
        outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
        rate: edgeRate(rate),
        timeout: 30_000,
      })
      const chunks: Buffer[] = []
      for await (const chunk of tts.streamAudio(text)) {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk)
      }
      const audio = Buffer.concat(chunks)
      if (audio.length === 0) throw new Error('Edge 在线音色没有返回音频。')
      return { mime: 'audio/mpeg', base64: audio.toString('base64') }
    } catch (error) {
      lastError = error
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 600))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
