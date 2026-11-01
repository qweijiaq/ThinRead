import fs from 'node:fs'
import path from 'node:path'

import type { TtsAudio, TtsStatus, TtsSynthesisRequest, TtsVoice } from '../shared/types.js'

const EDGE_VOICES: TtsVoice[] = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女声', language: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女声', language: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-YunxiNeural', label: '云希 · 男声', language: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 · 男声', language: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunjianNeural', label: '云健 · 男声', language: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunxiaNeural', label: '云夏 · 男声', language: 'zh-CN', gender: 'male' },
]

const KOKORO_DOWNLOAD_URL = 'https://hf-mirror.com/onnx-community/Kokoro-82M-v1.1-zh-ONNX/tree/main'
const KOKORO_MODEL_FILES = [
  { file: 'model.onnx', dtype: 'fp32' as const },
]

function bundledKokoroDir(): string | null {
  if (process.env.THINREAD_DISABLE_BUNDLED_KOKORO === '1') return null
  const resources = (process as unknown as { resourcesPath?: string }).resourcesPath
  const candidates = [
    ...(resources ? [path.join(resources, 'kokoro')] : []),
    path.join(process.cwd(), 'resources', 'kokoro'),
    path.join(__dirname, '..', 'resources', 'kokoro'),
  ]
  return (
    candidates.find(
      (candidate) => fs.existsSync(path.join(candidate, 'config.json')) || fs.existsSync(path.join(candidate, 'onnx')),
    ) ?? null
  )
}

/** 优先用随应用打包的模型；没有打包时回退到用户手动放模型的目录。 */
export function kokoroModelDir(dataDir: string): string {
  return bundledKokoroDir() ?? path.join(dataDir, 'models', 'kokoro')
}

function hasFile(file: string, minBytes = 1): boolean {
  try {
    return fs.statSync(file).size >= minBytes
  } catch {
    return false
  }
}

function kokoroVoices(dir: string): TtsVoice[] {
  const voiceDir = path.join(dir, 'voices')
  let names: string[] = []
  try {
    names = fs
      .readdirSync(voiceDir)
      .filter((name) => name.endsWith('.bin') && hasFile(path.join(voiceDir, name)))
  } catch {
    return []
  }
  return names
    .map((name) => name.slice(0, -'.bin'.length))
    .sort((a, b) => {
      const rank = (id: string): number => (id.startsWith('zf_') ? 0 : id.startsWith('zm_') ? 1 : 2)
      return rank(a) - rank(b) || a.localeCompare(b)
    })
    .map((id) => ({
      id,
      label: `${id.startsWith('zf_') ? '中文女声' : id.startsWith('zm_') ? '中文男声' : '英语音色'} ${id.slice(3)}`,
      language: id.startsWith('zf_') || id.startsWith('zm_') ? 'zh-CN' : 'en-US',
      gender: id.startsWith('zf_') ? ('female' as const) : id.startsWith('zm_') ? ('male' as const) : ('unknown' as const),
    }))
}

function inspectKokoro(dataDir: string): {
  ready: boolean
  path: string
  voices: TtsVoice[]
  missing: string[]
  modelFile: string | null
  dtype: 'fp32' | null
  downloadUrl: string
} {
  const dir = kokoroModelDir(dataDir)
  const missing: string[] = []
  for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) {
    if (!hasFile(path.join(dir, file))) missing.push(file)
  }
  let modelFile: string | null = null
  let dtype: 'fp32' | null = null
  for (const candidate of KOKORO_MODEL_FILES) {
    if (hasFile(path.join(dir, 'onnx', candidate.file), 1024 * 1024)) {
      modelFile = `onnx/${candidate.file}`
      dtype = candidate.dtype
      break
    }
  }
  if (!modelFile) missing.push('onnx/model.onnx')
  const voices = kokoroVoices(dir)
  if (voices.length === 0) missing.push('voices/*.bin')
  return {
    ready: missing.length === 0,
    path: dir,
    voices,
    missing,
    modelFile,
    dtype,
    downloadUrl: KOKORO_DOWNLOAD_URL,
  }
}

export function getTtsStatus(dataDir: string, beatraConfigured = false): TtsStatus {
  const kokoro = inspectKokoro(dataDir)
  return {
    edge: { online: true, voices: EDGE_VOICES },
    kokoro: {
      ready: kokoro.ready,
      path: kokoro.path,
      voices: kokoro.voices,
      missing: kokoro.missing,
      modelFile: kokoro.modelFile,
      downloadUrl: kokoro.downloadUrl,
    },
    beatra: { configured: beatraConfigured },
  }
}

function edgeRate(rate: number): string {
  const percent = Math.round((Math.min(2, Math.max(0.5, rate)) - 1) * 100)
  return `${percent >= 0 ? '+' : ''}${percent}%`
}

let kokoroPromise: Promise<{
  tts: { generate(text: string, options: { voice: string; speed: number }): Promise<unknown> }
  dir: string
}> | null = null

async function loadKokoro(dataDir: string): Promise<Awaited<NonNullable<typeof kokoroPromise>>> {
  if (kokoroPromise) return kokoroPromise
  const info = inspectKokoro(dataDir)
  if (!info.ready || !info.dtype) {
    throw new Error(`Kokoro 模型还没有准备好：缺少 ${info.missing.join('、')}。目录：${info.path}`)
  }
  kokoroPromise = (async () => {
    const module = await import('@uzen/kokoro-js')
    const env = module.env as unknown as {
      allowRemoteModels: boolean
      allowLocalModels: boolean
      localModelPath: string
      cacheDir: string
    }
    const previous = {
      allowRemoteModels: env.allowRemoteModels,
      allowLocalModels: env.allowLocalModels,
      localModelPath: env.localModelPath,
      cacheDir: env.cacheDir,
    }
    let tts: unknown
    try {
      // 只允许使用用户手动下载的模型，绝不在请求时偷偷下载。
      env.allowRemoteModels = false
      env.allowLocalModels = true
      env.localModelPath = info.path
      env.cacheDir = path.join(dataDir, 'models', 'kokoro-cache')
      tts = await module.KokoroTTS.from_pretrained(info.path, {
        dtype: info.dtype ?? 'fp32',
        device: 'cpu',
        model_file_name: 'model',
        voicePath: path.join(info.path, 'voices'),
      })
    } finally {
      // @uzen/kokoro-js 可能和语义索引共用同一个 Transformers.js 实例，不能留下全局设置。
      Object.assign(env, previous)
    }
    return { tts: tts as Awaited<NonNullable<typeof kokoroPromise>>['tts'], dir: info.path }
  })()
  try {
    return await kokoroPromise
  } catch (error) {
    kokoroPromise = null
    throw error
  }
}

export async function synthesizeTts(dataDir: string, request: TtsSynthesisRequest): Promise<TtsAudio> {
  const text = request.text.replace(/\s+/g, ' ').trim()
  if (!text) throw new Error('没有可合成的文字。')
  if (text.length > 2_000) throw new Error('单段文字太长，请分段后再听。')
  const rate = Math.min(2, Math.max(0.5, request.rate || 1))

  if (request.engine === 'edge') {
    const voice = EDGE_VOICES.find((item) => item.id === request.voice)
    if (!voice) throw new Error('不支持的 Edge 音色。')
    const { EdgeTTS } = await import('node-edge-tts')
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
  }

  if (request.engine === 'kokoro') {
    const info = inspectKokoro(dataDir)
    if (!info.voices.some((voice) => voice.id === request.voice)) {
      throw new Error('这个 Kokoro 音色还没有下载。')
    }
    const { tts } = await loadKokoro(dataDir)
    const audio = (await tts.generate(text, { voice: request.voice, speed: rate })) as {
      toBlob(): Blob
    }
    const blob = audio.toBlob()
    const buffer = Buffer.from(await blob.arrayBuffer())
    if (buffer.length === 0) throw new Error('Kokoro 没有返回音频。')
    return { mime: 'audio/wav', base64: buffer.toString('base64') }
  }

  throw new Error('未知的语音引擎。')
}
