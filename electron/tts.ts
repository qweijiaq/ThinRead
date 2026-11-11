import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { TtsAudio, TtsStatus, TtsSynthesisRequest, TtsVoice } from '../shared/types.js'
import { getQwenTtsConfig, getQwenTtsVoices, QWEN_TTS_DEFAULTS } from './settings.js'

const TTS_CACHE_TTL_MS = 60 * 24 * 60 * 60 * 1000
const TTS_CACHE_MAX_FILES = 400
let ttsCacheDir: string | null = null

/** 由主进程在确定用户数据目录后初始化；未初始化时不缓存（例如单元测试）。 */
export function initTtsCache(dataDir: string): void {
  ttsCacheDir = path.join(dataDir, 'tts-cache')
  pruneTtsCache()
}

function ttsCacheFile(key: string): string | null {
  return ttsCacheDir ? path.join(ttsCacheDir, `${key}.json`) : null
}

function readTtsCache(key: string): TtsAudio | null {
  const file = ttsCacheFile(key)
  if (!file) return null
  try {
    const entry = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      createdAt?: string
      mime?: string
      base64?: string
    }
    if (!entry.createdAt || Date.now() - Date.parse(entry.createdAt) > TTS_CACHE_TTL_MS) return null
    if (!entry.base64 || !entry.mime) return null
    return { mime: entry.mime, base64: entry.base64 }
  } catch {
    return null
  }
}

function writeTtsCache(key: string, audio: TtsAudio): void {
  const file = ttsCacheFile(key)
  if (!file || !ttsCacheDir) return
  try {
    fs.mkdirSync(ttsCacheDir, { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temp, JSON.stringify({ createdAt: new Date().toISOString(), ...audio }), 'utf8')
    fs.renameSync(temp, file)
    pruneTtsCache()
  } catch {
    // 缓存失败不影响播放。
  }
}

function pruneTtsCache(): void {
  if (!ttsCacheDir) return
  try {
    const names = fs.readdirSync(ttsCacheDir).filter((name) => name.endsWith('.json'))
    const now = Date.now()
    const rows = names
      .map((name) => {
        const file = path.join(ttsCacheDir!, name)
        try {
          return { file, mtime: fs.statSync(file).mtimeMs }
        } catch {
          return { file, mtime: 0 }
        }
      })
      .sort((a, b) => a.mtime - b.mtime)
    const expired = rows.filter((row) => now - row.mtime > TTS_CACHE_TTL_MS)
    for (const row of expired) {
      try {
        fs.unlinkSync(row.file)
      } catch {
        // 忽略。
      }
    }
    const keep = rows.filter((row) => !expired.includes(row))
    for (const row of keep.slice(0, Math.max(0, keep.length - TTS_CACHE_MAX_FILES))) {
      try {
        fs.unlinkSync(row.file)
      } catch {
        // 忽略。
      }
    }
  } catch {
    // 忽略。
  }
}

function ttsCacheKey(model: string, voice: string, text: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ model, voice, format: 'mp3', text }))
    .digest('hex')
}

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

const SYSTEM_PREFIX = 'system:'
let systemVoicesCache: TtsVoice[] | null = null

export function systemTtsAvailable(): boolean {
  return process.platform === 'darwin'
}

/** 读取 macOS `say -v ?` 的音色列表；只保留中英文，避免几百个音色把下拉框撑爆。 */
export function listSystemVoices(): TtsVoice[] {
  if (!systemTtsAvailable()) return []
  if (systemVoicesCache) return systemVoicesCache
  try {
    const result = spawnSync('say', ['-v', '?'], { encoding: 'utf8', timeout: 5_000 })
    const rows = (result.stdout || '')
      .split('\n')
      .map((line) => /^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s+#/.exec(line))
      .filter((match): match is RegExpExecArray => Boolean(match))
    const voices: TtsVoice[] = []
    const seen = new Set<string>()
    for (const match of rows) {
      const name = match[1].trim()
      const locale = match[2]
      if (!/^(zh|en)/i.test(locale) || seen.has(name)) continue
      seen.add(name)
      voices.push({
        id: `${SYSTEM_PREFIX}${name}`,
        label: `${name} · ${locale}`,
        language: locale,
        gender: 'unknown',
      })
    }
    systemVoicesCache = voices
    return voices
  } catch {
    return []
  }
}

function systemVoiceName(voice: string): string {
  const name = voice.startsWith(SYSTEM_PREFIX) ? voice.slice(SYSTEM_PREFIX.length) : voice
  return name.trim() || 'Ting-Ting'
}

/** 用 macOS 内置语音合成；不需要任何 Key，作为千问 TTS 的零配置兜底。 */
export function synthesizeSystemTts(request: TtsSynthesisRequest): TtsAudio {
  if (!systemTtsAvailable()) throw new Error('当前系统不支持内置语音合成。')
  const text = request.text.replace(/\s+/g, ' ').trim()
  if (!text) throw new Error('没有可合成的文字。')
  const file = path.join(os.tmpdir(), `thinread-tts-${createHash('sha1').update(text).digest('hex').slice(0, 12)}.wav`)
  try {
    const result = spawnSync(
      'say',
      ['-v', systemVoiceName(request.voice), '-o', file, '--data-format=LEI16@22050', text],
      { timeout: 60_000 },
    )
    if (result.status !== 0) {
      const detail = (result.stderr || '').toString().slice(0, 200)
      throw new Error(`内置语音合成失败${detail ? `：${detail}` : ''}`)
    }
    const audio = fs.readFileSync(file)
    if (audio.length === 0) throw new Error('内置语音没有返回音频。')
    return { mime: 'audio/wav', base64: audio.toString('base64') }
  } finally {
    try {
      fs.unlinkSync(file)
    } catch {
      // 临时文件清理失败不影响播放。
    }
  }
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
    system: {
      available: systemTtsAvailable(),
      voices: listSystemVoices(),
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
  const config = getQwenTtsConfig()
  const wantsSystem = request.voice.startsWith(SYSTEM_PREFIX)
  // 没配千问 Key 时自动退回 macOS 内置语音，听读不会因为缺一把 Key 完全不可用。
  if (wantsSystem || !config.apiKey) {
    if (!systemTtsAvailable()) {
      throw new Error('还没有配置千问 TTS 的 API Key：在设置里填写 TTS Key，或先配置阿里云百炼主 Key。')
    }
    const voice = systemVoiceName(request.voice)
    const key = ttsCacheKey('system', voice, text)
    const cached = readTtsCache(key)
    if (cached) return cached
    const audio = synthesizeSystemTts({ ...request, text, voice: `${SYSTEM_PREFIX}${voice}` })
    writeTtsCache(key, audio)
    return audio
  }
  const voice = request.voice || config.voiceA
  // 播放、整章导出和重复打开同一章都复用同一份音频，避免重复计费。
  const key = ttsCacheKey(config.model, voice, text)
  const cached = readTtsCache(key)
  if (cached) return cached
  const audio = await synthesizeQwenTts({ ...request, text, voice }, config)
  writeTtsCache(key, audio)
  return audio
}
