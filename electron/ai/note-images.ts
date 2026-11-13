import { createHash } from 'node:crypto'

import type { VisionMode } from '../../shared/types.js'
import type { ModelConfig } from './provider.js'

export interface NoteImage {
  id: string
  alt: string
  caption: string
  context: string
  dataUrl: string
  /** 压缩后的 base64（不含 data: 前缀），只有视觉模式才会填。 */
  data?: string
  mediaType?: string
  /** 原图内容哈希，用于缓存失效。 */
  signature: string
}

const MAX_IMAGES = 8
const MAX_IMAGE_DIMENSION = 1200
const MIN_IMAGE_DIMENSION = 80
const MIN_IMAGE_BYTES = 256
const MAX_OUTPUT_BYTES = 1_500_000
const MAX_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024
const DECORATIVE_IMAGE =
  /logo|icon|二维码|qr\s*code|封面|cover|装饰|divider|spacer|bullet|tracking|pixel/i

/** 根据模型名做保守判断；不认识的模型走 auto 时不会发送图片，用户可切到「总是发送」。 */
export function supportsVision(config: ModelConfig): boolean {
  const model = config.model.toLowerCase()
  if (/llava|vision|qwen.*(vl|omni)|minicpm-v|pixtral|internvl|gemma-?3|llama.*vision/.test(model)) return true
  if (config.provider === 'anthropic') return /claude-(3|4|5|sonnet|opus|haiku)/.test(model)
  if (config.provider === 'openai') return /gpt-(4o|4\.1|5|6)|o[34]/.test(model)
  if (config.provider === 'zhipu') return /glm.*(v|vision)/.test(model)
  if (config.provider === 'alibaba') return /qwen.*(vl|omni)/.test(model)
  if (config.provider === 'moonshot') return /vision|kimi.*(vl|vision)/.test(model)
  if (config.provider === 'openrouter') {
    return /vision|gpt-4o|gpt-5|gpt-6|claude|gemini|qwen.*vl|llava|pixtral|internvl/.test(model)
  }
  if (config.provider === 'opencode' || config.provider === 'opencode-go') {
    return /gpt-|claude|gemini|qwen.*vl|vision/.test(model)
  }
  if (config.provider === 'opendesign') {
    return /vision|gpt-|claude|gemini|qwen.*vl/.test(model)
  }
  if (config.provider === 'ollama' || config.provider === 'lmstudio') {
    return /llava|vision|vl|omni|gemma-?3|minicpm-v/.test(model)
  }
  return false
}

export function shouldUseVision(config: ModelConfig, mode: VisionMode | undefined): boolean {
  if (mode === 'off') return false
  if (mode === 'always') return true
  return supportsVision(config)
}

export function isVisionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /image|vision|multimodal|unsupported|not support|media|content.*type|invalid.*content/i.test(message)
}

export function imageSignature(dataUrl: string): string {
  return createHash('sha256').update(dataUrl).digest('hex').slice(0, 16)
}

export function isDecorativeImage(alt: string, caption: string): boolean {
  return DECORATIVE_IMAGE.test(`${alt} ${caption}`)
}

function parseDataUrl(dataUrl: string): { mediaType: string; bytes: Buffer } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl.trim())
  if (!match) return null
  try {
    const bytes = Buffer.from(match[2]!, 'base64')
    if (bytes.length < MIN_IMAGE_BYTES) return null
    return { mediaType: match[1]!.toLowerCase(), bytes }
  } catch {
    return null
  }
}

type CanvasModule = typeof import('@napi-rs/canvas')
let canvasModule: Promise<CanvasModule> | null = null

function loadCanvas(): Promise<CanvasModule> {
  if (!canvasModule) {
    canvasModule = import('@napi-rs/canvas').then((module) => {
      const resolved = (module as CanvasModule & { default?: CanvasModule }).default
      return resolved ?? (module as CanvasModule)
    })
  }
  return canvasModule
}

async function compressImage(
  dataUrl: string,
  signal: AbortSignal,
): Promise<{ data: string; mediaType: string } | null> {
  if (signal.aborted) return null
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return null
  try {
    if (signal.aborted) return null
    const { createCanvas, loadImage } = await loadCanvas()
    const image = await loadImage(parsed.bytes)
    if (image.width < MIN_IMAGE_DIMENSION || image.height < MIN_IMAGE_DIMENSION) return null
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    let output = canvas.toBuffer('image/jpeg', 82)
    if (output.length > MAX_OUTPUT_BYTES) output = canvas.toBuffer('image/jpeg', 68)
    if (output.length === 0 || output.length > MAX_OUTPUT_BYTES) return null
    return { data: output.toString('base64'), mediaType: 'image/jpeg' }
  } catch {
    return null
  }
}

/** 压缩章节图片；超出数量或无法处理的图片只保留图注/alt，不发给模型。 */
export async function prepareNoteImages(
  images: NoteImage[],
  config: ModelConfig,
  mode: VisionMode | undefined,
  signal: AbortSignal,
  max = MAX_IMAGES,
): Promise<NoteImage[]> {
  const useVision = shouldUseVision(config, mode)
  const result: NoteImage[] = []
  let used = 0
  let totalBytes = 0
  for (const image of images) {
    const next: NoteImage = { ...image }
    if (useVision && used < max) {
      const compressed = await compressImage(image.dataUrl, signal)
      const bytes = compressed ? Math.floor((compressed.data.length * 3) / 4) : 0
      if (compressed && totalBytes + bytes <= MAX_TOTAL_IMAGE_BYTES) {
        next.data = compressed.data
        next.mediaType = compressed.mediaType
        totalBytes += bytes
        used++
      }
    }
    // raw data URL 不再需要，释放内存；signature 已经保留。
    next.dataUrl = ''
    result.push(next)
  }
  return result
}

export function imagePromptBlock(images: NoteImage[]): string {
  if (images.length === 0) return ''
  const lines = images.map((image, index) => {
    const parts = [`[图${index + 1}]`]
    if (image.caption) parts.push(`图注：${image.caption}`)
    if (image.alt && image.alt !== image.caption) parts.push(`alt：${image.alt}`)
    if (image.context) parts.push(`附近正文：${image.context.slice(-180)}`)
    return parts.join('；')
  })
  return ['本章相关图片（按出现顺序）：', ...lines].join('\n')
}
