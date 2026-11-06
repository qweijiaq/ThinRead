import { getReadingSummary } from './reading-stats.js'

import {
  SHARE_MONO,
  SHARE_SANS,
  drawAccentRule,
  drawHairline,
  drawMarkerLine,
  drawMasthead,
  drawEmphasizedLines,
  findKeyPhrase,
  drawTracked,
  drawTrackedRight,
  paintSharePage,
  segmentText,
  sharePalette as paletteFor,
  type SharePalette,
  type ShareTheme,
} from './share-visual.js'

export type { ShareTheme } from './share-visual.js'

export type ShareTemplate = 'quote' | 'knowledge' | 'condensed' | 'book' | 'deck' | 'badge'
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
  brand?: string
}

type Palette = SharePalette

export function sharePalette(theme: ShareTheme): SharePalette {
  return paletteFor(theme)
}

const SERIF = SHARE_SANS
const SANS = SHARE_SANS
const MONO = SHARE_MONO

const TEMPLATE_KICKER: Record<ShareTemplate, string> = {
  quote: 'QUOTE / 原文摘录',
  knowledge: 'CONCEPT / 知识点',
  condensed: 'DIGEST / 读薄',
  book: 'BOOK / 整本书',
  deck: 'EXCERPTS / 摘录集',
  badge: 'MILESTONE / 里程碑',
}

const MARGIN = 88
const HEADER_TOP = 64

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
  return segmentText(text)
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
  font: string
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
      const last = lines[lines.length - 1]?.trim() ?? ''
      if (lines.length > 1 && last.length <= 2 && size > options.minSize) continue
      return { lines, size, lineHeight, font: `${options.weight} ${size}px ${options.family}` }
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
  return { lines, size, lineHeight, font: `${options.weight} ${size}px ${options.family}` }
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  block: FittedBlock,
  x: number,
  y: number,
  color: string,
): number {
  ctx.font = block.font
  ctx.fillStyle = color
  block.lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * block.lineHeight)
  })
  return block.lines.length * block.lineHeight
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  input: ShareCardInput,
  palette: Palette,
  width: number,
  height: number,
  showSource = true,
): void {
  const left = MARGIN
  const right = width - MARGIN
  drawHairline(ctx, palette, left, right, height - 140)
  const source = showSource && !input.hideSource ? input.source.trim() : ''
  if (source) {
    ctx.fillStyle = palette.soft
    ctx.font = `400 18px ${MONO}`
    const fitted = fitBlock(ctx, source, {
      width: Math.max(200, right - left - 160),
      maxHeight: 28,
      maxSize: 18,
      minSize: 15,
      lineHeight: 1.3,
      family: MONO,
      weight: '400',
    })
    ctx.fillText(fitted.lines[0] ?? '', left, height - 112)
  }
  const tags = input.hideTags ? [] : input.tags.slice(0, 4).filter(Boolean)
  if (tags.length > 0) {
    drawTracked(ctx, tags.join('  ·  '), left, height - 78, `500 12px ${MONO}`, palette.accent, 1.4)
  }
  const brand = input.brand?.trim() || '页边 THINREAD'
  drawTrackedRight(ctx, brand.slice(0, 40), right, height - 78, `500 12px ${MONO}`, palette.muted, 1.4)
}

function drawQuote(
  ctx: CanvasRenderingContext2D,
  input: ShareCardInput,
  palette: Palette,
  width: number,
  height: number,
): void {
  const left = MARGIN
  const right = width - MARGIN
  const contentWidth = right - left
  const compact = height < 1200
  const quoteBlock = fitBlock(ctx, toPlainText(input.quote || input.body || input.title), {
    width: contentWidth - 50,
    maxHeight: compact ? 380 : 540,
    maxSize: compact ? 48 : 60,
    minSize: compact ? 34 : 40,
    lineHeight: 1.46,
    family: SERIF,
    weight: '500',
  })
  const titleBlock = input.title.trim()
    ? fitBlock(ctx, toPlainText(input.title), {
        width: contentWidth - 40,
        maxHeight: 82,
        maxSize: 28,
        minSize: 22,
        lineHeight: 1.45,
        family: SANS,
        weight: '500',
      })
    : null
  const quoteHeight = quoteBlock.lines.length * quoteBlock.lineHeight
  const titleHeight = titleBlock ? titleBlock.lines.length * titleBlock.lineHeight : 0
  const sourceHeight = titleBlock && !input.hideSource && input.source.trim() ? 78 : 0
  const totalHeight = quoteHeight + 52 + 32 + titleHeight + sourceHeight
  const contentTop = compact ? 150 : 160
  const contentBottom = height - 154
  const bodyTop = contentTop + Math.max(0, (contentBottom - contentTop - totalHeight) / 2)

  ctx.fillStyle = palette.accent
  ctx.fillRect(left, bodyTop + 4, 6, Math.max(48, quoteHeight - 8))
  drawEmphasizedLines(
    ctx,
    quoteBlock.lines,
    left + 28,
    bodyTop,
    quoteBlock.lineHeight,
    quoteBlock.font,
    findKeyPhrase(input.quote || input.body || input.title),
    palette,
    palette.ink,
  )

  let y = bodyTop + quoteHeight + 52
  drawAccentRule(ctx, palette, left + 28, y, 64, 5)
  y += 34
  if (titleBlock) {
    const titleHeight = drawLines(ctx, titleBlock, left + 28, y, palette.soft)
    y += titleHeight + 18
    const source = input.hideSource ? '' : input.source.trim()
    if (source) {
      const sourceBlock = fitBlock(ctx, `—— ${source}`, {
        width: contentWidth - 40,
        maxHeight: 60,
        maxSize: 20,
        minSize: 16,
        lineHeight: 1.5,
        family: MONO,
        weight: '400',
      })
      drawLines(ctx, sourceBlock, left + 28, y, palette.muted)
    }
  }
  drawFooter(ctx, input, palette, width, height, false)
}

function drawKnowledge(
  ctx: CanvasRenderingContext2D,
  input: ShareCardInput,
  palette: Palette,
  width: number,
  height: number,
): void {
  const left = MARGIN
  const right = width - MARGIN
  const contentWidth = right - left
  const compact = height < 1200
  const kicker = input.source.split(' · ')[0]?.trim()

  const titleBlock = fitBlock(ctx, toPlainText(input.title || input.body), {
    width: contentWidth,
    maxHeight: compact ? 280 : 380,
    maxSize: compact ? 58 : 68,
    minSize: 36,
    lineHeight: 1.3,
    family: SERIF,
    weight: '600',
  })
  const hasBody = input.body.trim() && input.body.trim() !== input.title.trim()
  const titleHeight = titleBlock.lines.length * titleBlock.lineHeight
  const bodyBlock = hasBody
    ? fitBlock(ctx, toPlainText(input.body), {
        width: contentWidth - 30,
        maxHeight: Math.max(120, height - 330 - titleHeight - 77),
        maxSize: compact ? 30 : 34,
        minSize: 21,
        lineHeight: 1.8,
        family: SERIF,
        weight: '400',
      })
    : null
  const bodyHeight = bodyBlock ? bodyBlock.lines.length * bodyBlock.lineHeight : 0
  const totalHeight = titleHeight + 28 + 3 + 46 + bodyHeight
  const contentTop = compact ? 150 : 160
  const contentBottom = height - 154
  const top = contentTop + Math.max(0, (contentBottom - contentTop - totalHeight) / 2)

  if (kicker) {
    drawTracked(ctx, `《${kicker}》`, left, top - 40, `500 13px ${MONO}`, palette.muted, 1.4)
  }
  if (titleBlock.lines[0]) {
    drawMarkerLine(ctx, palette, left, top, Math.min(contentWidth, ctx.measureText(titleBlock.lines[0]).width), titleBlock.lineHeight)
  }
  const titleUsed = drawLines(ctx, titleBlock, left, top, palette.ink)
  let y = top + titleUsed + 28
  drawAccentRule(ctx, palette, left, y, 92, 6)
  y += 46
  if (bodyBlock) {
    drawEmphasizedLines(
      ctx,
      bodyBlock.lines,
      left,
      y,
      bodyBlock.lineHeight,
      bodyBlock.font,
      findKeyPhrase(input.body),
      palette,
      palette.soft,
    )
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
  const left = MARGIN
  const right = width - MARGIN
  const contentWidth = right - left
  const compact = height < 1200
  const sourceParts = input.source.split(' · ')
  const kicker = sourceParts[0]?.trim()
  const chapter = sourceParts[sourceParts.length - 1]?.trim()
  let bodyText = toPlainText(input.body)
  if (chapter && bodyText.startsWith(chapter)) bodyText = bodyText.slice(chapter.length).trim()
  const points = input.points && input.points.length > 0 ? input.points : keyPoints(bodyText, compact ? 3 : 4)
  const genericTitle = /读薄稿|摘录|知识点/.test(input.title)
  const displayTitle = genericTitle && chapter ? chapter : input.title

  if (kicker) {
    drawTracked(ctx, `《${kicker}》`, left, 174, `500 13px ${MONO}`, palette.muted, 1.4)
  }
  const titleBlock = fitBlock(ctx, toPlainText(displayTitle), {
    width: contentWidth,
    maxHeight: 210,
    maxSize: compact ? 44 : 54,
    minSize: 30,
    lineHeight: 1.26,
    family: SERIF,
    weight: '600',
  })
  const titleTop = compact ? 208 : 216
  const titleHeight = drawLines(ctx, titleBlock, left, titleTop, palette.ink)
  let y = titleTop + titleHeight + 26
  drawAccentRule(ctx, palette, left, y, 92, 6)
  y += 54

  const gap = compact ? 20 : 26
  const blocks = points.map((point) =>
    fitBlock(ctx, point, {
      width: contentWidth - 58,
      maxHeight: 180,
      maxSize: compact ? 26 : 30,
      minSize: 21,
      lineHeight: 1.65,
      family: SERIF,
      weight: '400',
    }),
  )
  const totalHeight =
    blocks.reduce((sum, block) => sum + Math.max(block.lines.length * block.lineHeight, 44), 0) +
    Math.max(0, blocks.length - 1) * gap
  const listTop = y + Math.max(0, (height - 210 - y - totalHeight) / 2)
  let cursor = listTop
  blocks.forEach((block, index) => {
    const point = points[index] ?? ''
    drawTracked(ctx, String(index + 1).padStart(2, '0'), left, cursor + 2, `600 16px ${MONO}`, palette.accent, 1.6)
    drawEmphasizedLines(
      ctx,
      block.lines,
      left + 52,
      cursor,
      block.lineHeight,
      block.font,
      findKeyPhrase(point),
      palette,
      palette.soft,
    )
    const used = block.lines.length * block.lineHeight
    cursor += Math.max(used, 44) + gap
    if (index < blocks.length - 1) {
      drawHairline(ctx, palette, left + 52, right, cursor - gap / 2)
    }
  })

  const chars = bodyText.replace(/\s/g, '').length
  const minutes = Math.max(1, Math.round(chars / 400))
  drawTracked(
    ctx,
    `${chars.toLocaleString()} 字 · 约 ${minutes} 分钟`,
    left,
    height - 160,
    `400 13px ${MONO}`,
    palette.muted,
    1.2,
  )
  drawFooter(ctx, input, palette, width, height)
}

function drawStat(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  x: number,
  y: number,
  value: string,
  label: string,
): void {
  ctx.fillStyle = palette.ink
  ctx.font = `600 42px ${SERIF}`
  ctx.fillText(value, x, y)
  drawTracked(ctx, label, x, y + 48, `500 16px ${MONO}`, palette.muted, 1.4)
}

function drawBook(
  ctx: CanvasRenderingContext2D,
  input: ShareCardInput,
  palette: Palette,
  width: number,
  height: number,
): void {
  const left = MARGIN
  const right = width - MARGIN
  const contentWidth = right - left
  const compact = height < 1200
  const book = input.book

  const titleBlock = fitBlock(ctx, input.title || book?.title || '', {
    width: contentWidth,
    maxHeight: compact ? 190 : 230,
    maxSize: compact ? 62 : 74,
    minSize: 34,
    lineHeight: 1.25,
    family: SERIF,
    weight: '600',
  })
  const titleTop = 186
  let y = titleTop + drawLines(ctx, titleBlock, left, titleTop, palette.ink)

  const meta = [book?.author, book ? `${book.chapterCount} 节` : '', book ? `${book.noteCount} 条笔记` : '']
    .filter(Boolean)
    .join(' · ')
  if (meta) {
    ctx.fillStyle = palette.muted
    ctx.font = `400 18px ${MONO}`
    ctx.fillText(meta, left, y + 18)
  }
  y += 76

  const statY = y
  drawStat(ctx, palette, left, statY, String(book?.chapterCount ?? '—'), '章节')
  drawStat(ctx, palette, left + 190, statY, String(book?.noteCount ?? '—'), '笔记')
  drawStat(ctx, palette, left + 380, statY, String(book?.cards.length ?? 0), '知识点')
  y = statY + 92
  drawHairline(ctx, palette, left, right, y)
  y += 34

  const cards = (book?.cards ?? []).slice(0, compact ? 2 : 3)
  const blocks = cards.map((card) => {
    const title = fitBlock(ctx, toPlainText(card.title), {
      width: contentWidth - 58,
      maxHeight: 88,
      maxSize: 30,
      minSize: 20,
      lineHeight: 1.42,
      family: SERIF,
      weight: '600',
    })
    const body = fitBlock(ctx, toPlainText(card.content), {
      width: contentWidth - 58,
      maxHeight: compact ? 90 : 108,
      maxSize: 24,
      minSize: 18,
      lineHeight: 1.65,
      family: SERIF,
      weight: '400',
    })
    const height = Math.max(title.lines.length * title.lineHeight + 8 + body.lines.length * body.lineHeight, 76) + 24
    return { title, body, height, phrase: findKeyPhrase(card.content) }
  })
  const reserve = input.body.trim() ? 120 : 0
  const totalHeight = blocks.reduce((sum, block) => sum + block.height, 0)
  y += Math.max(0, (height - 200 - reserve - y - totalHeight) / 2)
  blocks.forEach((block, index) => {
    drawTracked(ctx, String(index + 1).padStart(2, '0'), left, y + 4, `600 16px ${MONO}`, palette.accent, 1.6)
    const used = drawLines(ctx, block.title, left + 52, y, palette.ink)
    drawEmphasizedLines(
      ctx,
      block.body.lines,
      left + 52,
      y + used + 8,
      block.body.lineHeight,
      block.body.font,
      block.phrase,
      palette,
      palette.soft,
    )
    y += block.height
    if (index < blocks.length - 1) drawHairline(ctx, palette, left + 52, right, y - 12)
  })

  if (input.body.trim() && y < height - 240) {
    const tail = fitBlock(ctx, toPlainText(input.body), {
      width: contentWidth,
      maxHeight: 70,
      maxSize: 22,
      minSize: 18,
      lineHeight: 1.6,
      family: SERIF,
      weight: '400',
    })
    drawLines(ctx, tail, left, y + 6, palette.soft)
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
  const headerHeight = 260
  const sectionHeight = 260
  const height = headerHeight + notes.length * sectionHeight + 148
  const palette = paletteFor(input.theme)
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布。')
  ctx.textBaseline = 'top'
  paintSharePage(ctx, width, height, palette, 32)

  const left = MARGIN
  const right = width - MARGIN
  const contentWidth = right - left
  drawMasthead(ctx, palette, left, right, HEADER_TOP, TEMPLATE_KICKER.deck)

  const headTitle = fitBlock(ctx, input.title || '读书摘录', {
    width: contentWidth,
    maxHeight: 68,
    maxSize: 44,
    minSize: 34,
    lineHeight: 1.3,
    family: SERIF,
    weight: '600',
  })
  drawLines(ctx, headTitle, left, 130, palette.ink)
  if (!input.hideSource && input.source.trim()) {
    drawTracked(ctx, input.source, left, 214, `400 13px ${MONO}`, palette.muted, 1.2)
  }
  drawHairline(ctx, palette, left, right, 250)

  let y = headerHeight + 24
  notes.forEach((note, index) => {
    const section = deckSection(note)
    drawTracked(ctx, String(index + 1).padStart(2, '0'), left, y + 4, `700 16px ${MONO}`, palette.accent, 1.6)

    const title = fitBlock(ctx, section.title, {
      width: contentWidth - 58,
      maxHeight: 78,
      maxSize: 32,
      minSize: 22,
      lineHeight: 1.42,
      family: SERIF,
      weight: '600',
    })
    const used = drawLines(ctx, title, left + 52, y, palette.ink)
    const body = fitBlock(ctx, section.body, {
      width: contentWidth - 58,
      maxHeight: sectionHeight - used - 74,
      maxSize: 24,
      minSize: 18,
      lineHeight: 1.65,
      family: SERIF,
      weight: '400',
    })
    drawEmphasizedLines(
      ctx,
      body.lines,
      left + 52,
      y + used + 12,
      body.lineHeight,
      body.font,
      findKeyPhrase(section.body),
      palette,
      palette.soft,
    )

    ctx.fillStyle = palette.muted
    ctx.font = `400 14px ${MONO}`
    ctx.fillText(
      note.chapterTitle ? `${note.bookTitle} · ${note.chapterTitle}` : note.bookTitle,
      left + 52,
      y + used + 12 + body.lines.length * body.lineHeight + 14,
    )
    if (index < notes.length - 1) {
      drawHairline(ctx, palette, left, right, y + sectionHeight - 12)
    }
    y += sectionHeight
  })

  const brand = input.brand?.trim() || '页边 THINREAD'
  drawHairline(ctx, palette, left, right, height - 140)
  ctx.fillStyle = palette.soft
  ctx.font = `400 13px ${MONO}`
  ctx.fillText('由页边 ThinRead 整理 · 书和笔记都留在本机', left, height - 108)
  drawTrackedRight(ctx, brand.slice(0, 40), right, height - 78, `500 11px ${MONO}`, palette.muted, 1.4)
}

function drawBadges(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  width: number,
  height: number,
): void {
  const summary = getReadingSummary()
  const left = MARGIN
  const right = width - MARGIN
  const compact = height < 1200

  drawTracked(ctx, 'CONTINUOUS READING / 连续阅读', left, 184, `500 12px ${MONO}`, palette.accent, 2.2)

  ctx.fillStyle = palette.accent
  ctx.font = `700 ${compact ? 94 : 112}px ${SERIF}`
  ctx.fillText(String(summary.currentStreak), left, 226)
  const numberWidth = ctx.measureText(String(summary.currentStreak)).width
  drawTracked(ctx, '天', left + numberWidth + 16, 344, `500 18px ${MONO}`, palette.muted, 2)

  drawTracked(ctx, `最长连续 ${summary.longestStreak} 天`, left, 420, `400 14px ${MONO}`, palette.muted, 1.4)
  drawHairline(ctx, palette, left, right, 470)

  const rows = [7, 30, 100]
  const gap = 14
  const boxWidth = (right - left - gap * 2) / 3
  const boxTop = compact ? 520 : 548
  const boxHeight = compact ? 180 : 220
  rows.forEach((value, index) => {
    const unlocked = summary.longestStreak >= value
    const x = left + index * (boxWidth + gap)
    ctx.fillStyle = unlocked ? palette.accentSoft : 'transparent'
    ctx.fillRect(x, boxTop, boxWidth, boxHeight)
    ctx.strokeStyle = unlocked ? palette.accent : palette.line
    ctx.lineWidth = unlocked ? 2 : 1
    ctx.strokeRect(x + 0.5, boxTop + 0.5, boxWidth - 1, boxHeight - 1)
    ctx.fillStyle = unlocked ? palette.accent : palette.muted
    ctx.font = `700 ${compact ? 44 : 52}px ${SERIF}`
    ctx.fillText(String(value), x + 22, boxTop + 24)
    drawTracked(ctx, 'DAYS', x + 24, boxTop + boxHeight - 64, `500 11px ${MONO}`, palette.muted, 2)
    drawTracked(
      ctx,
      unlocked ? '已达成' : '未解锁',
      x + 24,
      boxTop + boxHeight - 38,
      `500 12px ${MONO}`,
      unlocked ? palette.accent : palette.muted,
      1.4,
    )
  })

  ctx.fillStyle = palette.muted
  ctx.font = `400 13px ${MONO}`
  ctx.fillText(`页边 · ${new Date().toLocaleDateString()}`, left, height - 64)
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
  const palette = paletteFor(input.theme)

  ctx.textBaseline = 'top'
  paintSharePage(ctx, width, height, palette, 32)
  drawMasthead(ctx, palette, MARGIN, width - MARGIN, HEADER_TOP, TEMPLATE_KICKER[input.template])

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
