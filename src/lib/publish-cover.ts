export type PublishCoverStyle = 'paper' | 'ink' | 'minimal'

export interface PublishCoverInput {
  title: string
  author: string
  date: string
  description?: string
  style?: PublishCoverStyle
}

interface CoverPalette {
  background: [string, string, string]
  ink: string
  soft: string
  muted: string
  line: string
  accent: string
  grid: string
}

const PALETTES: Record<PublishCoverStyle, CoverPalette> = {
  paper: {
    background: ['#f6f0e4', '#f9f5ec', '#eee5d5'],
    ink: '#2b2720',
    soft: '#6d6253',
    muted: '#847967',
    line: '#d9cdba',
    accent: '#a84a2b',
    grid: 'rgba(168, 74, 43, 0.16)',
  },
  ink: {
    background: ['#0f1215', '#161b20', '#111417'],
    ink: '#f2eadb',
    soft: '#c7b9a7',
    muted: '#938878',
    line: '#343a40',
    accent: '#d68a62',
    grid: 'rgba(214, 138, 98, 0.12)',
  },
  minimal: {
    background: ['#fbfaf6', '#ffffff', '#f1f3f7'],
    ink: '#1e2329',
    soft: '#5f6670',
    muted: '#7b7a74',
    line: '#e2e4e8',
    accent: '#2f4f9e',
    grid: 'rgba(47, 79, 158, 0.10)',
  },
}

const SERIF = '"Songti SC", "STSong", "Noto Serif CJK SC", "SimSun", Georgia, serif'
const SANS = '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif'

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const char of text.replace(/\s+/g, ' ').trim()) {
    const next = line + char
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line.trimEnd())
      line = char.trimStart()
    } else {
      line = next
    }
  }
  if (line.trim()) lines.push(line.trimEnd())
  return lines
}

function fitTitle(
  ctx: CanvasRenderingContext2D,
  title: string,
  width: number,
  maxHeight: number,
): { lines: string[]; size: number; lineHeight: number } {
  for (let size = 88; size >= 46; size -= 4) {
    ctx.font = `600 ${size}px ${SERIF}`
    const lines = wrap(ctx, title, width)
    const lineHeight = Math.round(size * 1.32)
    if (lines.length <= 3 && lines.length * lineHeight <= maxHeight) {
      return { lines, size, lineHeight }
    }
  }
  ctx.font = `600 46px ${SERIF}`
  const lines = wrap(ctx, title, width).slice(0, 3)
  return { lines, size: 46, lineHeight: 61 }
}

/** 生成 1200×630 的发布封面，也作为 Open Graph 图片使用。 */
export function renderPublishCover(input: PublishCoverInput): string {
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 630
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建封面画布。')

  const palette = PALETTES[input.style ?? 'paper']
  const background = ctx.createLinearGradient(0, 0, 1200, 630)
  background.addColorStop(0, palette.background[0])
  background.addColorStop(0.55, palette.background[1])
  background.addColorStop(1, palette.background[2])
  ctx.fillStyle = background
  ctx.fillRect(0, 0, 1200, 630)

  ctx.strokeStyle = palette.grid
  ctx.lineWidth = 1
  for (let y = 52; y < 630; y += 30) {
    ctx.beginPath()
    ctx.moveTo(72, y)
    ctx.lineTo(1128, y)
    ctx.stroke()
  }

  ctx.fillStyle = palette.accent
  ctx.fillRect(86, 74, 6, 132)

  ctx.fillStyle = palette.accent
  ctx.font = `600 18px ${SANS}`
  ctx.fillText('页边 · THINREAD', 120, 92)
  ctx.fillStyle = palette.muted
  ctx.font = `400 15px ${SANS}`
  ctx.fillText('读书笔记', 120, 116)

  const title = input.title.replace(/\s+/g, ' ').trim() || '未命名读书笔记'
  const fitted = fitTitle(ctx, title, 900, 250)
  const titleTop = 174
  ctx.fillStyle = palette.ink
  ctx.font = `600 ${fitted.size}px ${SERIF}`
  fitted.lines.forEach((line, index) => {
    ctx.fillText(line, 120, titleTop + index * fitted.lineHeight)
  })

  const ruleY = titleTop + fitted.lines.length * fitted.lineHeight + 24
  ctx.strokeStyle = palette.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(120, ruleY)
  ctx.lineTo(1080, ruleY)
  ctx.stroke()

  const description = (input.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 72)
  if (description) {
    ctx.fillStyle = palette.soft
    ctx.font = `400 22px ${SERIF}`
    const descriptionLines = wrap(ctx, description, 960).slice(0, 2)
    descriptionLines.forEach((line, index) => {
      ctx.fillText(line, 120, ruleY + 42 + index * 31)
    })
  }

  ctx.fillStyle = palette.ink
  ctx.font = `600 20px ${SANS}`
  if (input.author.trim()) ctx.fillText(input.author.trim(), 120, 556)
  ctx.fillStyle = palette.muted
  ctx.font = `400 17px ${SANS}`
  ctx.fillText(input.date, 120, 588)

  ctx.fillStyle = palette.accent
  ctx.font = `500 16px ${SANS}`
  ctx.textAlign = 'right'
  ctx.fillText('把一本书读成自己的', 1080, 574)
  ctx.textAlign = 'left'

  return canvas.toDataURL('image/png')
}

export function coverBase64(dataUrl: string): string {
  const index = dataUrl.indexOf(',')
  return index >= 0 ? dataUrl.slice(index + 1) : dataUrl
}
