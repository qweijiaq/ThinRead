import { getReadingSummary } from './reading-stats.js'

export type ShareTemplate = 'quote' | 'knowledge' | 'condensed' | 'book' | 'deck' | 'badge'
export type ShareTheme = 'paper' | 'ink'
export type ShareRatio = 'portrait' | 'square'

export interface ShareNote {
  id: string
  title: string
  content: string
  quote: string | null
  tags: string[]
  bookTitle: string
  chapterTitle: string | null
  kind: string
}

export interface ShareBook {
  title: string
  author: string
  chapterCount: number
  noteCount: number
  cards: Array<{ title: string; content: string }>
}

export interface ShareCardInput {
  template: ShareTemplate
  theme: ShareTheme
  ratio: ShareRatio
  title: string
  body: string
  quote: string
  source: string
  tags: string[]
  hideSource: boolean
  hideTags: boolean
  book: ShareBook | null
  deck: ShareNote[] | null
  points?: string[] | null
}

interface Palette {
  background: string
  sheet: string
  ink: string
  soft: string
  muted: string
  line: string
  accent: string
}

export function sharePalette(theme: ShareTheme): Palette {
  return PALETTES[theme]
}

const PALETTES: Record<ShareTheme, Palette> = {
  paper: {
    background: '#e8dfcd',
    sheet: '#fcf8ef',
    ink: '#221e18',
    soft: '#4a4237',
    muted: '#8c7f6b',
    line: '#e0d4bf',
    accent: '#a8452a',
  },
  ink: {
    background: '#111417',
    sheet: '#1b1f23',
    ink: '#f2eadb',
    soft: '#d1c5b3',
    muted: '#938878',
    line: '#343a40',
    accent: '#d68a62',
  },
}

const SERIF = '"Songti SC", "STSong", "Noto Serif CJK SC", "SimSun", Georgia, serif'
const SANS = '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif'

const TEMPLATE_LABEL: Record<ShareTemplate, string> = {
  quote: '原文摘录',
  knowledge: '一个知识点',
  condensed: '读薄',
  book: '整本书',
  deck: '摘录集',
  badge: '里程碑',
}

function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*\n?/g, ''))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^-{3,}$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function keyPoints(text: string, limit: number): string[] {
  const plain = toPlainText(text)
  const sentences = plain
    .split(/(?<=[。！？!?])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.replace(/\s/g, '').length >= 12)
  if (sentences.length <= 1) return [plain]
  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    score:
      (/(不是|而是|真正|关键|方法|本质|应该|所以|只有|意味着)/.test(sentence) ? 2 : 0) +
      Math.min(sentence.length / 60, 1),
  }))
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence)
}

function tokenize(text: string): string[] {
  return text.match(/[\u3400-\u9fff]|[^\s\u3400-\u9fff]+|\s+/g) ?? []
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  const tokens = tokenize(text.replace(/\s+/g, ' ').trim()).flatMap((token) =>
    ctx.measureText(token).width > maxWidth && token !== ' ' ? [...token] : [token],
  )
  for (const token of tokens) {
    if (token === ' ') {
      if (line && !line.endsWith(' ')) line += ' '
      continue
    }
    if (!line.trim() && lines.length > 0 && /^[，。！？；：、）》」』】…·,.;:!?)]$/.test(token)) {
      lines[lines.length - 1] += token
      continue
    }
    const next = line + token
    if (ctx.measureText(next).width > maxWidth && line.trim()) {
      lines.push(line.trimEnd())
      line = token
    } else {
      line = next
    }
  }
  if (line.trim()) lines.push(line.trimEnd())
  return lines
}

interface FittedBlock {
  lines: string[]
  size: number
  lineHeight: number
}

function fitBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  options: {
    width: number
    maxHeight: number
    maxSize: number
    minSize: number
    lineHeight: number
    family: string
    weight: string
  },
): FittedBlock {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  for (let size = options.maxSize; size >= options.minSize; size -= 2) {
    ctx.font = `${options.weight} ${size}px ${options.family}`
    const lines = wrapText(ctx, normalized, options.width)
    const lineHeight = Math.round(size * options.lineHeight)
    if (lines.length * lineHeight <= options.maxHeight) {
      return { lines, size, lineHeight }
    }
  }
  const size = options.minSize
  ctx.font = `${options.weight} ${size}px ${options.family}`
  const lineHeight = Math.round(size * options.lineHeight)
  const maxLines = Math.max(1, Math.floor(options.maxHeight / lineHeight))
  const lines = wrapText(ctx, normalized, options.width).slice(0, maxLines)
  if (lines.length === maxLines && lines.length > 0) {
    lines[maxLines - 1] = `${lines[maxLines - 1]!.replace(/[，。；、,.;:]?$/, '')}…`
  }
  return { lines, size, lineHeight }
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  block: FittedBlock,
  x: number,
  y: number,
  color: string,
): number {
  ctx.fillStyle = color
  block.lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * block.lineHeight)
  })
  return block.lines.length * block.lineHeight
}

function drawLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, palette: Palette): void {
  ctx.fillStyle = palette.accent
  ctx.font = `600 24px ${SANS}`
  ctx.fillText(label, x, y)
}

function drawFrame(ctx: CanvasRenderingContext2D, width: number, height: number, palette: Palette): void {
  const pad = 42
  ctx.save()
  ctx.shadowColor = 'rgba(20, 18, 14, 0.18)'
  ctx.shadowBlur = 36
  ctx.shadowOffsetY = 18
  ctx.fillStyle = palette.sheet
  ctx.beginPath()
  ctx.roundRect(pad, pad, width - pad * 2, height - pad * 2, 30)
  ctx.fill()
  ctx.restore()

  ctx.strokeStyle = palette.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(pad, pad, width - pad * 2, height - pad * 2, 30)
  ctx.stroke()

  // 页边 motif：左侧细线 + 页码，和产品名形成一个具体的版式记号。
  const marginX = 92
  ctx.strokeStyle = palette.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(marginX, 190)
  ctx.lineTo(marginX, height - 182)
  ctx.stroke()

  ctx.save()
  ctx.translate(62, height - 196)
  ctx.rotate(-Math.PI / 2)
  ctx.fillStyle = palette.muted
  ctx.font = `500 18px ${SANS}`
  ctx.fillText('页边 · THINREAD', 0, 0)
  ctx.restore()

  ctx.fillStyle = palette.accent
  ctx.fillRect(120, 104, 44, 5)
  ctx.fillStyle = palette.ink
  ctx.font = `600 28px ${SERIF}`
  ctx.fillText('页边', 120, 126)
  ctx.fillStyle = palette.muted
  ctx.font = `500 17px ${SANS}`
  ctx.fillText('读书笔记', 188, 136)
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  input: ShareCardInput,
  palette: Palette,
  width: number,
  height: number,
): void {
  const left = 126
  const maxWidth = width - left - 120
  ctx.strokeStyle = palette.line
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(left, height - 224)
  ctx.lineTo(width - 120, height - 224)
  ctx.stroke()
  let y = height - 178
  if (!input.hideTags && input.tags.length > 0) {
    ctx.fillStyle = palette.accent
    ctx.font = `500 21px ${SANS}`
    const tags = input.tags.slice(0, 5).join(' · ')
    ctx.fillText(fitBlock(ctx, tags, { width: maxWidth, maxHeight: 28, maxSize: 21, minSize: 17, lineHeight: 1.3, family: SANS, weight: '500' }).lines[0] ?? '', left, y)
    y += 36
  }
  if (!input.hideSource && input.source.trim()) {
    ctx.fillStyle = palette.muted
    ctx.font = `400 22px ${SANS}`
    const fitted = fitBlock(ctx, input.source, {
      width: maxWidth,
      maxHeight: 58,
      maxSize: 22,
      minSize: 17,
      lineHeight: 1.35,
      family: SANS,
      weight: '400',
    })
    drawLines(ctx, fitted, left, y, palette.muted)
  }
}

function drawQuote(
  ctx: CanvasRenderingContext2D,
  input: ShareCardInput,
  palette: Palette,
  width: number,
  height: number,
): void {
  const left = 126
  const contentWidth = width - left - 120
  const compact = height < 1200
drawLabel(ctx, TEMPLATE_LABEL.quote, left, 226, palette)

  ctx.save()
  ctx.fillStyle = palette.accent
  ctx.globalAlpha = 0.18
  ctx.font = `400 ${compact ? 210 : 250}px ${SERIF}`
  ctx.fillText('“', left - 16, 246)
  ctx.restore()

  const quoteBlock = fitBlock(ctx, toPlainText(input.quote || input.body || input.title), {
    width: contentWidth,
    maxHeight: compact ? 470 : 590,
    maxSize: compact ? 58 : 68,
    minSize: 40,
    lineHeight: 1.52,
    family: SERIF,
    weight: '400',
  })
  drawLines(ctx, quoteBlock, left, compact ? 500 : 540, palette.ink)

  const titleTop = (compact ? 500 : 540) + quoteBlock.lines.length * quoteBlock.lineHeight + 42
  if (input.title.trim()) {
    const titleBlock = fitBlock(ctx, input.title, {
      width: contentWidth,
      maxHeight: 90,
      maxSize: 30,
      minSize: 24,
      lineHeight: 1.4,
      family: SANS,
      weight: '500',
    })
    drawLines(ctx, titleBlock, left, Math.min(titleTop, height - 300), palette.soft)
  }
  drawFooter(ctx, input, palette, width, height)
}

function drawKnowledge(
  ctx: CanvasRenderingContext2D,
  input: ShareCardInput,
  palette: Palette,
  width: number,
  height: number,
): void {
  const left = 126
  const contentWidth = width - left - 120
  const compact = height < 1200
  drawLabel(ctx, TEMPLATE_LABEL.knowledge, left, 214, palette)
  const kicker = input.source.split(' · ')[0]?.trim()
  if (kicker) {
    ctx.fillStyle = palette.muted
    ctx.font = `500 23px ${SANS}`
    ctx.fillText(`《${kicker}》`, left, 250)
  }

  const titleBlock = fitBlock(ctx, toPlainText(input.title || input.body), {
    width: contentWidth,
    maxHeight: compact ? 330 : 420,
    maxSize: compact ? 64 : 76,
    minSize: 42,
    lineHeight: 1.32,
    family: SERIF,
    weight: '600',
  })
  const titleHeight = titleBlock.lines.length * titleBlock.lineHeight
  const hasBody = input.body.trim() && input.body.trim() !== input.title.trim()
  const bodyBlock = hasBody
    ? fitBlock(ctx, toPlainText(input.body), {
        width: contentWidth,
        maxHeight: height - 300 - 300 - titleHeight,
        maxSize: compact ? 34 : 38,
        minSize: 26,
        lineHeight: 1.78,
        family: SERIF,
        weight: '400',
      })
    : null
  const top = 300 + Math.max(0, (height - 300 - 300 - titleHeight - 120) / 2)
  drawLines(ctx, titleBlock, left, top, palette.ink)
  if (bodyBlock) drawLines(ctx, bodyBlock, left, top + titleHeight + 44, palette.soft)
  drawFooter(ctx, input, palette, width, height)
}

function drawCondensed(
  ctx: CanvasRenderingContext2D,
  input: ShareCardInput,
  palette: Palette,
  width: number,
  height: number,
): void {
  const left = 126
  const contentWidth = width - left - 120
  const compact = height < 1200
  const label = TEMPLATE_LABEL.condensed
  const sourceParts = input.source.split(' · ')
  const kicker = sourceParts[0]?.trim()
  const chapter = sourceParts[sourceParts.length - 1]?.trim()
  let bodyText = toPlainText(input.body)
  if (chapter && bodyText.startsWith(chapter)) bodyText = bodyText.slice(chapter.length).trim()
  const points = input.points && input.points.length > 0 ? input.points : keyPoints(bodyText, compact ? 3 : 4)
  const genericTitle = /读薄稿|摘录|知识点/.test(input.title)
  const displayTitle = genericTitle && chapter ? chapter : input.title

  drawLabel(ctx, label, left, 200, palette)
  if (kicker) {
    ctx.fillStyle = palette.muted
    ctx.font = `500 23px ${SANS}`
    ctx.fillText(`《${kicker}》`, left, 238)
  }

  const titleBlock = fitBlock(ctx, toPlainText(displayTitle), {
    width: contentWidth,
    maxHeight: 210,
    maxSize: compact ? 54 : 62,
    minSize: 34,
    lineHeight: 1.26,
    family: SERIF,
    weight: '600',
  })
  const titleTop = 282
  drawLines(ctx, titleBlock, left, titleTop, palette.ink)
  const titleBottom = titleTop + titleBlock.lines.length * titleBlock.lineHeight

  ctx.strokeStyle = palette.accent
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(left, titleBottom + 26)
  ctx.lineTo(left + 64, titleBottom + 26)
  ctx.stroke()

  let y = titleBottom + 62
  points.forEach((point, index) => {
    ctx.fillStyle = palette.accent
    ctx.font = `600 24px ${SANS}`
    ctx.fillText(String(index + 1).padStart(2, '0'), left, y + 4)

    const block = fitBlock(ctx, point, {
      width: contentWidth - 74,
      maxHeight: 150,
      maxSize: compact ? 30 : 34,
      minSize: 24,
      lineHeight: 1.62,
      family: SERIF,
      weight: '400',
    })
    drawLines(ctx, block, left + 70, y, palette.soft)
    y += Math.max(block.lines.length * block.lineHeight, 44) + 24
  })

  const chars = bodyText.replace(/\s/g, '').length
  const minutes = Math.max(1, Math.round(chars / 400))
  ctx.fillStyle = palette.muted
  ctx.font = `400 19px ${SANS}`
  ctx.fillText(`${chars.toLocaleString()} 字 · 约 ${minutes} 分钟`, left, height - 268)
  drawFooter(ctx, input, palette, width, height)
}

function drawBook(
  ctx: CanvasRenderingContext2D,
  input: ShareCardInput,
  palette: Palette,
  width: number,
  height: number,
): void {
  const left = 126
  const contentWidth = width - left - 120
  const book = input.book
drawLabel(ctx, TEMPLATE_LABEL.book, left, 226, palette)

  const titleBlock = fitBlock(ctx, input.title || book?.title || '', {
    width: contentWidth,
    maxHeight: height < 1200 ? 210 : 250,
    maxSize: height < 1200 ? 66 : 78,
    minSize: 40,
    lineHeight: 1.3,
    family: SERIF,
    weight: '600',
  })
  let y = 282 + drawLines(ctx, titleBlock, left, 280, palette.ink)

  ctx.fillStyle = palette.muted
  ctx.font = `400 26px ${SANS}`
  const meta = [book?.author, book ? `${book.chapterCount} 节` : '', book ? `${book.noteCount} 条笔记` : '']
    .filter(Boolean)
    .join(' · ')
  ctx.fillText(meta, left, y + 12)
  y += 58

  ctx.strokeStyle = palette.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(left, y)
  ctx.lineTo(width - 120, y)
  ctx.stroke()
  y += 38

  const cards = (book?.cards ?? []).slice(0, height < 1200 ? 2 : 3)
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index]!
    ctx.fillStyle = palette.accent
    ctx.font = `600 26px ${SANS}`
    ctx.fillText(String(index + 1).padStart(2, '0'), left, y)

    const cardTitle = fitBlock(ctx, toPlainText(card.title), {
      width: contentWidth - 70,
      maxHeight: 76,
      maxSize: 30,
      minSize: 22,
      lineHeight: 1.4,
      family: SERIF,
      weight: '600',
    })
    const used = drawLines(ctx, cardTitle, left + 68, y - 2, palette.ink)
    const body = fitBlock(ctx, toPlainText(card.content), {
      width: contentWidth - 70,
      maxHeight: 90,
      maxSize: 23,
      minSize: 19,
      lineHeight: 1.6,
      family: SERIF,
      weight: '400',
    })
    drawLines(ctx, body, left + 68, y + used + 8, palette.soft)
    y += Math.max(used + 8 + body.lines.length * body.lineHeight, 86) + 28
  }

  if (input.body.trim() && y < height - 300) {
    ctx.fillStyle = palette.soft
    ctx.font = `400 24px ${SERIF}`
    const tail = fitBlock(ctx, toPlainText(input.body), {
      width: contentWidth,
      maxHeight: 80,
      maxSize: 24,
      minSize: 19,
      lineHeight: 1.6,
      family: SERIF,
      weight: '400',
    })
    drawLines(ctx, tail, left, y, palette.soft)
  }
  drawFooter(ctx, input, palette, width, height)
}

function deckSection(note: ShareNote): { title: string; body: string } {
  const title = toPlainText(note.title) || note.content.replace(/\s+/g, ' ').slice(0, 40)
  const body = toPlainText(note.quote?.trim() || note.content.trim())
  return { title, body }
}

function renderDeck(canvas: HTMLCanvasElement, input: ShareCardInput): void {
  const notes = (input.deck ?? []).slice(0, 12)
  const width = 1080
  const headerHeight = 300
  const sectionHeight = 430
  const height = headerHeight + notes.length * sectionHeight + 170
  const palette = PALETTES[input.theme]
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布。')
  ctx.textBaseline = 'top'
  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, width, height)

  const pad = 42
  ctx.fillStyle = palette.sheet
  ctx.beginPath()
  ctx.roundRect(pad, pad, width - pad * 2, height - pad * 2, 30)
  ctx.fill()
  ctx.strokeStyle = palette.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(pad, pad, width - pad * 2, height - pad * 2, 30)
  ctx.stroke()

  const left = 126
  const contentWidth = width - left - 120
  ctx.fillStyle = palette.accent
  ctx.fillRect(left, 104, 44, 5)
  ctx.fillStyle = palette.ink
  ctx.font = `600 30px ${SERIF}`
  ctx.fillText('页边', left, 124)
  ctx.fillStyle = palette.muted
  ctx.font = `500 17px ${SANS}`
  ctx.fillText(`${notes.length} 张摘录 · THINREAD`, 188, 136)

  ctx.fillStyle = palette.ink
  ctx.font = `600 56px ${SERIF}`
  const headTitle = fitBlock(ctx, input.title || '读书摘录', {
    width: contentWidth,
    maxHeight: 80,
    maxSize: 56,
    minSize: 34,
    lineHeight: 1.3,
    family: SERIF,
    weight: '600',
  })
  drawLines(ctx, headTitle, left, 190, palette.ink)
  if (!input.hideSource && input.source.trim()) {
    ctx.fillStyle = palette.muted
    ctx.font = `400 22px ${SANS}`
    ctx.fillText(input.source, left, 264)
  }

  const marginX = 92
  ctx.strokeStyle = palette.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(marginX, 324)
  ctx.lineTo(marginX, height - 120)
  ctx.stroke()

  let y = headerHeight + 20
  notes.forEach((note, index) => {
    const section = deckSection(note)
    if (index > 0) {
      ctx.strokeStyle = palette.line
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(left, y - 18)
      ctx.lineTo(width - 120, y - 18)
      ctx.stroke()
    }
    ctx.fillStyle = palette.accent
    ctx.font = `600 24px ${SANS}`
    ctx.fillText(String(index + 1).padStart(2, '0'), left, y + 4)

    const title = fitBlock(ctx, section.title, {
      width: contentWidth - 70,
      maxHeight: 82,
      maxSize: 38,
      minSize: 25,
      lineHeight: 1.4,
      family: SERIF,
      weight: '600',
    })
    const used = drawLines(ctx, title, left + 70, y, palette.ink)
    const body = fitBlock(ctx, section.body, {
      width: contentWidth - 70,
      maxHeight: sectionHeight - used - 104,
      maxSize: 27,
      minSize: 21,
      lineHeight: 1.65,
      family: SERIF,
      weight: '400',
    })
    drawLines(ctx, body, left + 70, y + used + 12, palette.soft)
    ctx.fillStyle = palette.muted
    ctx.font = `400 18px ${SANS}`
    ctx.fillText(
      note.chapterTitle ? `${note.bookTitle} · ${note.chapterTitle}` : note.bookTitle,
      left + 70,
      y + sectionHeight - 48,
    )
    y += sectionHeight
  })

  ctx.fillStyle = palette.muted
  ctx.font = `400 18px ${SANS}`
  ctx.fillText('由页边 ThinRead 整理 · 书和笔记都留在本机', left, height - 98)
}

function drawBadges(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  width: number,
  height: number,
): void {
  const summary = getReadingSummary()
  const left = 126
  drawLabel(ctx, TEMPLATE_LABEL.badge, left, 226, palette)
  ctx.fillStyle = palette.ink
  ctx.font = `600 58px ${SERIF}`
  ctx.fillText('阅读里程碑', left, 286)
  ctx.fillStyle = palette.muted
  ctx.font = `400 24px ${SANS}`
  ctx.fillText(`连续阅读 ${summary.currentStreak} 天 · 最长 ${summary.longestStreak} 天`, left, 366)

  const values = [7, 30, 100]
  values.forEach((value, index) => {
    const unlocked = summary.longestStreak >= value
    const y = 530 + index * 250
    ctx.beginPath()
    ctx.arc(width / 2, y, 72, 0, Math.PI * 2)
    ctx.fillStyle = unlocked ? palette.accent : palette.line
    ctx.fill()

    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = unlocked ? palette.sheet : palette.muted
    ctx.font = `58px ${SERIF}`
    ctx.fillText(unlocked ? '★' : '☆', width / 2, y + 2)
    ctx.restore()

    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = unlocked ? palette.ink : palette.muted
    ctx.font = `500 30px ${SERIF}`
    ctx.fillText(`${value} 天`, width / 2, y + 100)
    ctx.fillStyle = palette.muted
    ctx.font = `400 19px ${SANS}`
    ctx.fillText(unlocked ? '已达成' : '未解锁', width / 2, y + 138)
    ctx.restore()
  })

  ctx.fillStyle = palette.muted
  ctx.font = `400 18px ${SANS}`
  ctx.fillText(`页边 · ${new Date().toLocaleDateString()}`, left, height - 98)
}

export function renderShareCard(canvas: HTMLCanvasElement, input: ShareCardInput): void {
  if (input.template === 'deck') {
    renderDeck(canvas, input)
    return
  }
  const width = 1080
  const height = input.ratio === 'square' ? 1080 : 1440
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布。')
  const palette = PALETTES[input.theme]

  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'top'
  drawFrame(ctx, width, height, palette)

  if (input.template === 'badge') drawBadges(ctx, palette, width, height)
  else if (input.template === 'quote') drawQuote(ctx, input, palette, width, height)
  else if (input.template === 'knowledge') drawKnowledge(ctx, input, palette, width, height)
  else if (input.template === 'condensed') drawCondensed(ctx, input, palette, width, height)
  else drawBook(ctx, input, palette, width, height)
}

export function shareText(input: ShareCardInput): string {
  if (input.template === 'deck') {
    return (input.deck ?? [])
      .map((note, index) => {
        const source = `${note.bookTitle}${note.chapterTitle ? ` · ${note.chapterTitle}` : ''}`
        return `${index + 1}. ${note.title}\n${note.quote?.trim() || note.content.trim()}\n—— ${source}`
      })
      .join('\n\n')
  }
  if (input.template === 'badge') {
    const summary = getReadingSummary()
    return `阅读里程碑\n连续阅读 ${summary.currentStreak} 天 · 最长 ${summary.longestStreak} 天`
  }
  if (input.template === 'quote') {
    const source = input.source.trim()
    return [input.quote.trim(), source ? `—— ${source}` : ''].filter(Boolean).join('\n\n')
  }
  return [input.title.trim(), input.body.trim(), input.source.trim()].filter(Boolean).join('\n\n')
}

export function shareFilename(input: ShareCardInput): string {
  const base =
    input.template === 'book'
      ? input.book?.title ?? input.title
      : input.template === 'deck'
        ? `${input.title || '摘录集'}-${input.deck?.length ?? 0}张`
        : input.title || input.quote
  const clean = base.replace(/[\\/:*?"<>|#%{}]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20)
  return `页边-${clean || '分享卡'}.png`
}
