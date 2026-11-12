import { t } from './i18n.js'
export type ShareTheme = 'paper' | 'ink' | 'sage'

export interface SharePalette {
  background: string
  sheet: string
  ink: string
  soft: string
  muted: string
  line: string
  accent: string
  accentSoft: string
  marker: string
  markerSoft: string
  grid: string
  dark: boolean
}

export const SHARE_PALETTES: Record<ShareTheme, SharePalette> = {
  paper: {
    background: '#e7e1d5',
    sheet: '#fbf8f1',
    ink: '#1a1814',
    soft: '#4c463c',
    muted: '#8b8275',
    line: '#ded5c6',
    accent: '#a64b32',
    accentSoft: 'rgba(166, 75, 50, 0.08)',
    marker: '#a64b32',
    markerSoft: 'rgba(166, 75, 50, 0.12)',
    grid: 'transparent',
    dark: false,
  },
  ink: {
    background: '#0a0a09',
    sheet: '#111110',
    ink: '#f2ede2',
    soft: '#cfc7b8',
    muted: '#8e8779',
    line: '#26241f',
    accent: '#d8a45c',
    accentSoft: 'rgba(216, 164, 92, 0.12)',
    marker: '#d8a45c',
    markerSoft: 'rgba(216, 164, 92, 0.18)',
    grid: 'transparent',
    dark: true,
  },
  sage: {
    background: '#d9ddd2',
    sheet: '#f4f3ea',
    ink: '#1a1d18',
    soft: '#464c40',
    muted: '#7b8272',
    line: '#d2d6c6',
    accent: '#3c5b49',
    accentSoft: 'rgba(60, 91, 73, 0.08)',
    marker: '#3c5b49',
    markerSoft: 'rgba(60, 91, 73, 0.12)',
    grid: 'transparent',
    dark: false,
  },
}

export const SHARE_SERIF = '"Songti SC", "STSong", "Noto Serif CJK SC", "SimSun", Georgia, serif'
export const SHARE_SANS = '"Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", Arial, sans-serif'
export const SHARE_MONO = '"SF Mono", Menlo, "SFMono-Regular", Consolas, monospace'

export function sharePalette(theme: ShareTheme): SharePalette {
  return SHARE_PALETTES[theme] ?? SHARE_PALETTES.paper
}

type SegmenterLike = {
  segment(input: string): Iterable<{ segment: string }>
}

const SegmenterCtor = (
  Intl as unknown as {
    Segmenter?: new (locale?: string, options?: { granularity?: string }) => SegmenterLike
  }
).Segmenter
const wordSegmenter = SegmenterCtor ? new SegmenterCtor('zh', { granularity: 'word' }) : null

/**
 * 优先按中文词切分，避免“重要”被拆到两行；不支持 Intl.Segmenter 时退回逐字。
 */
export function segmentText(text: string): string[] {
  if (wordSegmenter) {
    try {
      return [...wordSegmenter.segment(text)].map((item) => item.segment)
    } catch {
      // 回退到正则。
    }
  }
  return text.match(/[㐀-鿿]|[^\s㐀-鿿]+|\s+/g) ?? []
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

/** 很轻的纸张颗粒，只做质感，不抢文字。 */
export function drawPaperGrain(
  ctx: CanvasRenderingContext2D,
  palette: SharePalette,
  width: number,
  height: number,
  inset = 0,
): void {
  const left = inset + 8
  const top = inset + 8
  const areaWidth = Math.max(0, width - left * 2)
  const areaHeight = Math.max(0, height - top * 2)
  if (areaWidth <= 0 || areaHeight <= 0) return
  const count = Math.min(5200, Math.round((areaWidth * areaHeight) / 760))
  const random = seededRandom(0x1a2b3c4d)
  ctx.save()
  ctx.globalAlpha = 0.045
  ctx.fillStyle = palette.ink
  for (let index = 0; index < count; index++) {
    const x = left + random() * areaWidth
    const y = top + random() * areaHeight
    const size = random() > 0.82 ? 1.4 : 1
    ctx.fillRect(x, y, size, size)
  }
  ctx.restore()
}

/** 画一张纸：整版底色、纸面颗粒；不使用方格，避免像学习博主模板。 */
export function paintSharePage(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: SharePalette,
  inset = 0,
): void {
  ctx.fillStyle = palette.sheet
  ctx.fillRect(0, 0, width, height)
  drawPaperGrain(ctx, palette, width, height, inset)
  if (inset > 0) {
    ctx.save()
    ctx.globalAlpha = palette.dark ? 0.28 : 0.36
    ctx.strokeStyle = palette.line
    ctx.lineWidth = 1
    const edge = inset + 18.5
    ctx.strokeRect(edge, edge, width - edge * 2, height - edge * 2)
    ctx.restore()
  }
}

/** 带字距的小标签；用于品牌、页码、模板名和章节 kicker。 */
export function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  spacing = 1.6,
): number {
  ctx.save()
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = 'left'
  let cursor = x
  for (const char of [...text]) {
    ctx.fillText(char, cursor, y)
    cursor += ctx.measureText(char).width + spacing
  }
  ctx.restore()
  return cursor - x
}

export function drawTrackedRight(
  ctx: CanvasRenderingContext2D,
  text: string,
  right: number,
  y: number,
  font: string,
  color: string,
  spacing = 1.6,
): void {
  ctx.save()
  ctx.font = font
  const width = [...text].reduce((sum, char) => sum + ctx.measureText(char).width + spacing, -spacing)
  drawTracked(ctx, text, right - width, y, font, color, spacing)
  ctx.restore()
}

/** 页眉：品牌字标 + 可选标签；只用一条细线，不再用重规则线。 */
export function drawMasthead(
  ctx: CanvasRenderingContext2D,
  palette: SharePalette,
  left: number,
  right: number,
  top = 62,
  rightLabel?: string,
): void {
  drawTracked(ctx, t('页边 THINREAD'), left, top, `500 10px ${SHARE_SANS}`, palette.muted, 2.2)
  if (rightLabel) {
    drawTrackedRight(ctx, rightLabel, right, top, `500 10px ${SHARE_SANS}`, palette.muted, 2)
  }
  ctx.save()
  ctx.globalAlpha = 0.55
  ctx.strokeStyle = palette.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(left, top + 24)
  ctx.lineTo(right, top + 24)
  ctx.stroke()
  ctx.restore()
}

export function drawHairline(
  ctx: CanvasRenderingContext2D,
  palette: SharePalette,
  x1: number,
  x2: number,
  y: number,
  width = 1,
): void {
  ctx.save()
  ctx.strokeStyle = palette.line
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.stroke()
  ctx.restore()
}

export function drawAccentRule(
  ctx: CanvasRenderingContext2D,
  palette: SharePalette,
  x: number,
  y: number,
  width = 40,
  height = 2,
): void {
  ctx.fillStyle = palette.accent
  ctx.fillRect(x, y, width, height)
}

export function drawCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

/** 重点短语只用一条细下划线，不再铺荧光色块。 */
export function drawMarkerLine(
  ctx: CanvasRenderingContext2D,
  palette: SharePalette,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
): void {
  if (width <= 0) return
  ctx.save()
  ctx.globalAlpha = 0.75
  ctx.fillStyle = palette.accent
  ctx.fillRect(x, y + lineHeight - 9, width, 1.5)
  ctx.restore()
}

/** 细边框小标签，参考 daily-post 的 chip。返回占用宽度。 */
export function drawChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  palette: SharePalette,
  options: { accent?: boolean; height?: number; padding?: number; fontSize?: number } = {},
): number {
  const height = options.height ?? 30
  const padding = options.padding ?? 10
  const fontSize = options.fontSize ?? 12
  ctx.save()
  ctx.font = `500 ${fontSize}px ${SHARE_SANS}`
  const width = ctx.measureText(text).width + padding * 2
  ctx.strokeStyle = options.accent ? palette.accent : palette.line
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)
  ctx.fillStyle = options.accent ? palette.accent : palette.muted
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + padding, y + height / 2 + 0.5)
  ctx.restore()
  return width
}

const KEY_PATTERNS: RegExp[] = [
  /不是[^，。！？；\n]{0,18}?[，,]?而是([^，。！？；\n]{2,18})/,
  /真正([^，。！？；\n]{2,16})/,
  /(?:关键|核心|本质)(?:是|在于)([^，。！？；\n]{2,16})/,
  /意味着([^，。！？；\n]{2,18})/,
  /转向([^，。！？；\n]{2,18})/,
  /“([^”]{2,18})”/,
]

const KEY_WORDS = /(不是|而是|真正|关键|核心|本质|意味着|所以|只有|其实|方法|判断|标准)/

function trimPhrase(text: string, maxLength: number): string {
  const clean = text.replace(/^[\s，。；：、,.;:!?！？]+|[\s，。；：、,.;:!?！？]+$/g, '')
  if (clean.length <= maxLength) return clean
  const words = segmentText(clean)
  let out = ''
  for (const word of words) {
    if ((out + word).length > maxLength) break
    out += word
  }
  return out || clean.slice(0, maxLength)
}

/** 本地提取一个适合高亮的关键短语，不调用模型。 */
export function findKeyPhrase(text: string, maxLength = 14): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  for (const pattern of KEY_PATTERNS) {
    const match = normalized.match(pattern)
    if (match?.[1]) {
      const phrase = trimPhrase(match[1], maxLength)
      if (phrase.length >= 2) return phrase
    }
  }
  const clauses = normalized
    .split(/[，。；：！？\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4)
  if (clauses.length === 0) return ''
  const best = clauses
    .map((part) => ({
      part,
      score: (KEY_WORDS.test(part) ? 3 : 0) + Math.min(part.length / 20, 1.5),
    }))
    .sort((a, b) => b.score - a.score)[0]?.part
  return trimPhrase(best ?? '', Math.max(4, Math.min(maxLength, 12)))
}

/** 在已经排好行的文本里高亮短语；短语跨行时尽量高亮能匹配的前缀。 */
export function drawEmphasizedLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  font: string,
  phrase: string,
  palette: SharePalette,
  color: string,
): void {
  ctx.font = font
  const key = phrase.trim()
  if (key) {
    for (const [index, line] of lines.entries()) {
      let matched = ''
      for (let length = Math.min(key.length, line.length); length >= 3; length--) {
        if (line.includes(key.slice(0, length))) {
          matched = key.slice(0, length)
          break
        }
      }
      if (!matched) continue
      const start = line.indexOf(matched)
      if (start < 0) continue
      const before = line.slice(0, start)
      const width = ctx.measureText(matched).width
      const offset = ctx.measureText(before).width
      drawMarkerLine(ctx, palette, x + offset, y + index * lineHeight, width, lineHeight)
    }
  }
  ctx.fillStyle = color
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight))
}


/** 超大的低对比数字，用来填补版面上的空白，不抢正文。 */
export function drawGhostNumber(
  ctx: CanvasRenderingContext2D,
  text: string,
  right: number,
  baseline: number,
  size: number,
  color: string,
  alpha = 0.055,
): void {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.font = `500 ${size}px ${SHARE_SERIF}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, right, baseline)
  ctx.restore()
}
