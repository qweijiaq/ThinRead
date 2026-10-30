export type ShareTemplate = 'quote' | 'knowledge' | 'condensed' | 'book' | 'deck'
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

const PALETTES: Record<ShareTheme, Palette> = {
  paper: {
    background: '#e9e1d2',
    sheet: '#faf6ec',
    ink: '#26221b',
    soft: '#4d4539',
    muted: '#877a67',
    line: '#ddd2be',
    accent: '#a84a2b',
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

  const quoteBlock = fitBlock(ctx, input.quote || input.body || input.title, {
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
  drawLabel(ctx, TEMPLATE_LABEL.knowledge, left, 226, palette)

  const titleBlock = fitBlock(ctx, input.title || input.body, {
    width: contentWidth,
    maxHeight: compact ? 330 : 420,
    maxSize: compact ? 64 : 76,
    minSize: 42,
    lineHeight: 1.32,
    family: SERIF,
    weight: '600',
  })
  const titleBottom = 300 + drawLines(ctx, titleBlock, left, 292, palette.ink)

  if (input.body.trim() && input.body.trim() !== input.title.trim()) {
    const bodyBlock = fitBlock(ctx, input.body, {
      width: contentWidth,
      maxHeight: height - titleBottom - 300,
      maxSize: compact ? 34 : 38,
      minSize: 26,
      lineHeight: 1.78,
      family: SERIF,
      weight: '400',
    })
    drawLines(ctx, bodyBlock, left, titleBottom + 44, palette.soft)
  }
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
  drawLabel(ctx, TEMPLATE_LABEL.condensed, left, 226, palette)

  const titleBlock = fitBlock(ctx, input.title, {
    width: contentWidth,
    maxHeight: compact ? 160 : 190,
    maxSize: compact ? 42 : 48,
    minSize: 30,
    lineHeight: 1.35,
    family: SERIF,
    weight: '600',
  })
  const titleBottom = 286 + drawLines(ctx, titleBlock, left, 284, palette.ink)
  const bodyBlock = fitBlock(ctx, input.body, {
    width: contentWidth,
    maxHeight: height - titleBottom - 290,
    maxSize: compact ? 32 : 35,
    minSize: 24,
    lineHeight: 1.82,
    family: SERIF,
    weight: '400',
  })
  drawLines(ctx, bodyBlock, left, titleBottom + 38, palette.soft)
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

    const cardTitle = fitBlock(ctx, card.title, {
      width: contentWidth - 70,
      maxHeight: 76,
      maxSize: 30,
      minSize: 22,
      lineHeight: 1.4,
      family: SERIF,
      weight: '600',
    })
    const used = drawLines(ctx, cardTitle, left + 68, y - 2, palette.ink)
    const body = fitBlock(ctx, card.content, {
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
    const tail = fitBlock(ctx, input.body, {
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
  const title = note.title || note.content.replace(/\s+/g, ' ').slice(0, 40)
  const body = note.quote?.trim() || note.content.trim()
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

  if (input.template === 'quote') drawQuote(ctx, input, palette, width, height)
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
