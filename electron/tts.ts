import type { TtsAudio, TtsStatus, TtsSynthesisRequest, TtsVoice } from '../shared/types.js'
import { getQwenTtsConfig, getQwenTtsVoices, QWEN_TTS_DEFAULTS } from './settings.js'

/**
 * 语音合成固定使用阿里云百炼的千问 TTS，与 english-penpal 同款：
 * 模型 qwen-audio-3.1-tts-flash，走原生 SpeechSynthesizer 接口。
 * 兼容模式没有 /audio/speech，所以不能按 OpenAI TTS 的方式请求。
 */
const QWEN_VOICES: TtsVoice[] = [
  { id: 'longanhuan_v3.1', label: '龙安欢 · 女声', language: 'zh-CN', gender: 'female' },
  { id: 'xunanchuan_v3.1', label: '许南川 · 男声', language: 'zh-CN', gender: 'male' },
  { id: 'longanlingxin_v3.1', label: '龙安灵心 · 女声', language: 'zh-CN', gender: 'female' },
  { id: 'longanfengyue_v3.1', label: '龙安风悦 · 女声', language: 'zh-CN', gender: 'female' },
  { id: 'anmingyuan_v3.1', label: '安明远 · 男声', language: 'zh-CN', gender: 'male' },
  { id: 'yeqinghe_v3.1', label: '叶清禾 · 女声', language: 'zh-CN', gender: 'female' },
  { id: 'longcheng_v3.1', label: '龙橙 · 男声', language: 'zh-CN', gender: 'male' },
  { id: 'Emily_v3.1', label: 'Emily · 英式女声', language: 'en', gender: 'female' },
  { id: 'Eric_v3.1', label: 'Eric · 英式男声', language: 'en', gender: 'male' },
  { id: 'loongbella_v3.1', label: 'Bella · 中英女声', language: 'zh-CN', gender: 'female' },
]

function voiceList(ids: string[]): TtsVoice[] {
  return ids.map((id) => QWEN_VOICES.find((voice) => voice.id === id) ?? { id, label: id, language: 'zh-CN' })
}

function speechEndpoint(baseUrl: string): string {
  const base = (baseUrl.trim() || QWEN_TTS_DEFAULTS.baseUrl).replace(/\/+$/, '')
  if (base.endsWith('/services/audio/tts/SpeechSynthesizer')) return base
  return `${base}/services/audio/tts/SpeechSynthesizer`
}

export function getTtsStatus(): TtsStatus {
  let config: ReturnType<typeof getQwenTtsConfig>
  let voices = QWEN_VOICES
  try {
    config = getQwenTtsConfig()
    voices = voiceList(getQwenTtsVoices())
  } catch {
    config = { ...QWEN_TTS_DEFAULTS, apiKey: null }
  }
  return {
    qwen: {
      configured: Boolean(config.apiKey),
      baseUrl: config.baseUrl,
      model: config.model,
      voiceA: config.voiceA,
      voiceB: config.voiceB,
      voiceEn: config.voiceEn,
      pricePerK: config.pricePerK,
      voices,
    },
  }
}

export async function synthesizeQwenTts(
  request: TtsSynthesisRequest,
  config: ReturnType<typeof getQwenTtsConfig>,
): Promise<TtsAudio> {
  if (!config.apiKey) {
    throw new Error('还没有配置千问 TTS 的 API Key：在设置里填写 TTS Key，或先配置阿里云百炼主 Key。')
  }
  const endpoint = speechEndpoint(config.baseUrl)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      input: {
        text: request.text,
        voice: request.voice || config.voiceA,
        format: 'mp3',
        sample_rate: 24000,
      },
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    throw new Error(`千问 TTS 请求失败：HTTP ${response.status}${detail ? ` ${detail}` : ''}`)
  }
  const payload = (await response.json().catch(() => null)) as {
    output?: {
      audio?: { url?: string }
      audio_url?: string
      results?: Array<{ url?: string }>
    }
  } | null
  const audioUrl =
    payload?.output?.audio?.url ?? payload?.output?.audio_url ?? payload?.output?.results?.[0]?.url
  if (!audioUrl) throw new Error('千问 TTS 没有返回音频地址。')

  const audioResponse = await fetch(audioUrl, { signal: AbortSignal.timeout(60_000) })
  if (!audioResponse.ok) throw new Error(`千问 TTS 音频下载失败：HTTP ${audioResponse.status}`)
  const audio = Buffer.from(await audioResponse.arrayBuffer())
  if (audio.length === 0) throw new Error('千问 TTS 没有返回音频。')
  const contentType = audioResponse.headers.get('content-type') ?? ''
  return {
    mime: contentType.startsWith('audio/') ? contentType.split(';')[0]!.trim() : 'audio/mpeg',
    base64: audio.toString('base64'),
  }
}

export async function synthesizeTts(request: TtsSynthesisRequest): Promise<TtsAudio> {
  const text = request.text.replace(/\s+/g, ' ').trim()
  if (!text) throw new Error('没有可合成的文字。')
  if (text.length > 2_000) throw new Error('单段文字太长，请分段后再听。')
  return synthesizeQwenTts({ ...request, text }, getQwenTtsConfig())
}
