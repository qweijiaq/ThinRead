export interface PublishCoverInput {
  title: string
  author: string
  date: string
  description?: string
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

  const paper = ctx.createLinearGradient(0, 0, 1200, 630)
  paper.addColorStop(0, '#f6f0e4')
  paper.addColorStop(0.55, '#f9f5ec')
  paper.addColorStop(1, '#eee5d5')
  ctx.fillStyle = paper
  ctx.fillRect(0, 0, 1200, 630)

  ctx.strokeStyle = 'rgba(168, 74, 43, 0.16)'
  ctx.lineWidth = 1
  for (let y = 52; y < 630; y += 30) {
    ctx.beginPath()
    ctx.moveTo(72, y)
    ctx.lineTo(1128, y)
    ctx.stroke()
  }

  ctx.fillStyle = '#a84a2b'
  ctx.fillRect(86, 74, 6, 132)

  ctx.fillStyle = '#a84a2b'
  ctx.font = `600 18px ${SANS}`
  ctx.fillText('页边 · THINREAD', 120, 92)
  ctx.fillStyle = '#847967'
  ctx.font = `400 15px ${SANS}`
  ctx.fillText('读书笔记', 120, 116)

  const title = input.title.replace(/\s+/g, ' ').trim() || '未命名读书笔记'
  const fitted = fitTitle(ctx, title, 900, 250)
  const titleTop = 174
  ctx.fillStyle = '#2b2720'
  ctx.font = `600 ${fitted.size}px ${SERIF}`
  fitted.lines.forEach((line, index) => {
    ctx.fillText(line, 120, titleTop + index * fitted.lineHeight)
  })

  const ruleY = titleTop + fitted.lines.length * fitted.lineHeight + 24
  ctx.strokeStyle = '#d9cdba'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(120, ruleY)
  ctx.lineTo(1080, ruleY)
  ctx.stroke()

  const description = (input.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 72)
  if (description) {
    ctx.fillStyle = '#6d6253'
    ctx.font = `400 22px ${SERIF}`
    const descriptionLines = wrap(ctx, description, 960).slice(0, 2)
    descriptionLines.forEach((line, index) => {
      ctx.fillText(line, 120, ruleY + 42 + index * 31)
    })
  }

  ctx.fillStyle = '#2b2720'
  ctx.font = `600 20px ${SANS}`
  if (input.author.trim()) ctx.fillText(input.author.trim(), 120, 556)
  ctx.fillStyle = '#847967'
  ctx.font = `400 17px ${SANS}`
  ctx.fillText(input.date, 120, 588)

  ctx.fillStyle = '#a84a2b'
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
