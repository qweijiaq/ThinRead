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
    background: '#dfe1da',
    sheet: '#f7f6f1',
    ink: '#141311',
    soft: '#3d3a34',
    muted: '#7a756b',
    line: '#d6d5cc',
    accent: '#c92b1e',
    accentSoft: 'rgba(201, 43, 30, 0.08)',
    marker: '#f2d544',
    markerSoft: 'rgba(242, 213, 68, 0.42)',
    grid: 'rgba(20, 19, 17, 0.045)',
    dark: false,
  },
  ink: {
    background: '#0b0d10',
    sheet: '#14161a',
    ink: '#e9eae3',
    soft: '#c9cbc4',
    muted: '#8a8f98',
    line: '#2a2f36',
    accent: '#f2d544',
    accentSoft: 'rgba(242, 213, 68, 0.12)',
    marker: '#f2d544',
    markerSoft: 'rgba(242, 213, 68, 0.24)',
    grid: 'rgba(233, 234, 227, 0.035)',
    dark: true,
  },
  sage: {
    background: '#dde0d3',
    sheet: '#f2f3e9',
    ink: '#171b15',
    soft: '#40483a',
    muted: '#737b68',
    line: '#d0d4c3',
    accent: '#b04a2d',
    accentSoft: 'rgba(176, 74, 45, 0.10)',
    marker: '#e6d45a',
    markerSoft: 'rgba(230, 212, 90, 0.40)',
    grid: 'rgba(23, 27, 21, 0.04)',
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

/** 画一张纸：整版底色、内层纸面、细边框和颗粒。 */
export function paintSharePage(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: SharePalette,
  inset = 0,
): void {
  ctx.fillStyle = palette.sheet
  ctx.fillRect(0, 0, width, height)
  if (palette.grid !== 'transparent') {
    const step = 36
    const left = inset + step
    const top = inset + step
    ctx.save()
    ctx.strokeStyle = palette.grid
    ctx.lineWidth = 1
    for (let x = left; x < width - inset; x += step) {
      ctx.beginPath()
      ctx.moveTo(x, inset)
      ctx.lineTo(x, height - inset)
      ctx.stroke()
    }
    for (let y = top; y < height - inset; y += step) {
      ctx.beginPath()
      ctx.moveTo(inset, y)
      ctx.lineTo(width - inset, y)
      ctx.stroke()
    }
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

/** 页眉：左侧品牌方块 + 字标，右侧可选标签。 */
export function drawMasthead(
  ctx: CanvasRenderingContext2D,
  palette: SharePalette,
  left: number,
  right: number,
  top = 62,
  rightLabel?: string,
): void {
  drawTracked(ctx, '页边 THINREAD', left, top, `500 12px ${SHARE_MONO}`, palette.muted, 2.4)
  if (rightLabel) {
    drawTrackedRight(ctx, rightLabel, right, top, `500 11px ${SHARE_MONO}`, palette.accent, 2)
  }
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.strokeStyle = palette.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(left, top + 26)
  ctx.lineTo(right, top + 26)
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
  width = 46,
  height = 3,
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

/** 模拟 daily-post 的荧光笔：浅色主题铺底色，深色主题画下划线。 */
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
  if (palette.dark) {
    ctx.globalAlpha = 0.85
    ctx.fillStyle = palette.marker
    ctx.fillRect(x, y + lineHeight - 14, width, 7)
  } else {
    ctx.fillStyle = palette.markerSoft
    ctx.fillRect(x - 4, y - 3, width + 8, lineHeight - 6)
  }
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
  ctx.font = `500 ${fontSize}px ${SHARE_MONO}`
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
