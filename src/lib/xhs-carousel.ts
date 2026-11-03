import type { ChapterMeta, Note } from '../../shared/types.js'

import { titleRepeatsContent } from './note-display.js'

export type XhsScope = 'chapter' | 'book'
export type XhsTheme = 'paper' | 'ink'

export interface XhsCarouselCard {
  id: string
  number: number
  heading: string
  body: string
  tags: string[]
  chapterId: string | null
  chapterTitle: string | null
  bookTitle: string
}

export interface XhsCarouselPart {
  cardId: string
  number: number
  headingLines: string[]
  bodyLines: string[]
  tags: string[]
  continuation: boolean
}

export interface XhsCarouselPage {
  kind: 'cover' | 'content' | 'closing'
  chapterTitle: string | null
  parts: XhsCarouselPart[]
}

export interface XhsCarouselPlan {
  scope: XhsScope
  title: string
  subtitle: string
  bookTitle: string
  author: string
  cards: XhsCarouselCard[]
  pages: XhsCarouselPage[]
  chapterTitles: string[]
  totalCards: number
  coveredCards: number
  warnings: string[]
}

interface MeasureContext {
  font: string
  measureText(text: string): { width: number }
}

interface PlanInput {
  scope: XhsScope
  bookTitle: string
  author: string
  chapterId?: string | null
  chapterTitle?: string | null
  chapters: ChapterMeta[]
  notes: Note[]
  title?: string
  concise?: boolean
  measure: MeasureContext
}

const PAGE_WIDTH = 1080
const PAGE_HEIGHT = 1440
const LEFT = 96
const RIGHT = 96
const CONTENT_WIDTH = PAGE_WIDTH - LEFT - RIGHT
const CONTENT_HEIGHT = 1000
const CARD_GAP = 26
const HEADING_SIZE = 36
const HEADING_LINE_HEIGHT = 48
const BODY_SIZE = 26
const BODY_LINE_HEIGHT = 40
const META_HEIGHT = 24

const SERIF = '"Songti SC", "STSong", "Noto Serif CJK SC", "SimSun", Georgia, serif'
const SANS = '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif'

interface Palette {
  background: string
  sheet: string
  ink: string
  soft: string
  muted: string
  line: string
  accent: string
}

const PALETTES: Record<XhsTheme, Palette> = {
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

function flatten(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function tokenize(text: string): string[] {
  return text.match(/[㐀-鿿]|[^\s㐀-鿿]+|\s+/g) ?? []
}

function wrapLines(ctx: MeasureContext, text: string, width: number, size: number, family: string, weight: string): string[] {
  ctx.font = `${weight} ${size}px ${family}`
  const lines: string[] = []
  let line = ''
  for (const token of tokenize(flatten(text)).flatMap((part) =>
    ctx.measureText(part).width > width && part !== ' ' ? [...part] : [part],
  )) {
    if (token === ' ') {
      if (line && !line.endsWith(' ')) line += ' '
      continue
    }
    if (!line.trim() && lines.length > 0 && /^[，。！？；：、）》」』】…·,.;:!?)]$/.test(token)) {
      lines[lines.length - 1] += token
      continue
    }
    const next = line + token
    if (ctx.measureText(next).width > width && line.trim()) {
      lines.push(line.trimEnd())
      line = token
    } else {
      line = next
    }
  }
  if (line.trim()) lines.push(line.trimEnd())
  // 兜底：把仍然落在行首的标点挪回上一行。
  for (let index = 1; index < lines.length; index++) {
    while (/^[，。！？；：、）》」』】…·,.;:!?)]/.test(lines[index]!)) {
      lines[index - 1] += lines[index]![0]
      lines[index] = lines[index]!.slice(1).trimStart()
      if (!lines[index]) {
        lines.splice(index, 1)
        index--
        break
      }
    }
  }
  return lines.filter((line) => line.length > 0)
}

function summarizeBody(text: string, maxChars = 120): string {
  const flat = flatten(text)
  if (flat.length <= maxChars) return flat
  const sentences = flat
    .split(/(?<=[。！？!?])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 10)
  if (sentences.length === 0) return `${flat.slice(0, maxChars - 1)}…`
  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    score: (/(不是|而是|真正|关键|方法|本质|应该|所以|只有|意味着)/.test(sentence) ? 2 : 0) + sentence.length / 60,
  }))
  const picked = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence)
    .join('')
  return picked.length > maxChars ? `${picked.slice(0, maxChars - 1)}…` : picked
}

function splitLead(content: string): { heading: string; body: string } {
  const text = flatten(content)
  if (!text) return { heading: '', body: '' }
  const sentence = text.match(/^.{12,82}?[。！？!?；;]/u)?.[0]
  if (sentence) {
    return { heading: sentence.trim(), body: text.slice(sentence.length).trim() }
  }
  if (text.length <= 82) return { heading: text, body: '' }
  return { heading: text.slice(0, 74).trim(), body: text.slice(74).trim() }
}

function normalizeCard(note: Note, number: number, bookTitle: string, chapterTitle: string | null): XhsCarouselCard | null {
  const content = flatten(
    note.content
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/`([^`]+)`/g, '$1'),
  )
  if (!content) return null
  const title = flatten(note.title)
  let heading = title
  let body = ''
  if (!title || titleRepeatsContent(note)) {
    const split = splitLead(content)
    heading = split.heading
    body = split.body
  } else {
    body = content
  }
  if (body && body.length > 180) body = summarizeBody(body, 180)
  const shortHeading = flatten(heading)
  return {
    id: note.id,
    number,
    heading: shortHeading.length > 80 ? `${shortHeading.slice(0, 79)}…` : shortHeading || content.slice(0, 48),
    body,
    tags: note.tags.slice(0, 4),
    chapterId: note.chapterId,
    chapterTitle,
    bookTitle,
  }
}

function contentGroups(input: PlanInput): Array<{ chapterTitle: string | null; notes: Note[] }> {
  const visible = input.chapters.filter((chapter) => !chapter.hidden).sort((left, right) => left.idx - right.idx)
  const order = new Map(visible.map((chapter, index) => [chapter.id, index]))
  const titles = new Map(visible.map((chapter) => [chapter.id, chapter.title]))
  const knowledge = input.notes.filter(
    (note) => (note.kind === 'point' || note.kind === 'claim') && note.content.trim(),
  )
  const unique = new Map<string, Note>()
  for (const note of knowledge) {
    if (!unique.has(note.id)) unique.set(note.id, note)
  }
  const notes = [...unique.values()]
  if (input.scope === 'chapter') {
    return [{ chapterTitle: input.chapterTitle ?? null, notes }]
  }
  const groups = new Map<string | null, Note[]>()
  for (const note of notes) {
    const chapterId = note.chapterId && order.has(note.chapterId) ? note.chapterId : note.chapterId ? null : null
    if (note.chapterId && !order.has(note.chapterId)) continue
    const key = chapterId ?? null
    const bucket = groups.get(key) ?? []
    bucket.push(note)
    groups.set(key, bucket)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === null) return 1
      if (right === null) return -1
      return (order.get(left) ?? 0) - (order.get(right) ?? 0)
    })
    .map(([chapterId, items]) => ({
      chapterTitle: chapterId ? titles.get(chapterId) ?? null : '未分章',
      notes: items,
    }))
}

function packCards(
  cards: XhsCarouselCard[],
  chapterTitle: string | null,
  measure: MeasureContext,
): XhsCarouselPage[] {
  const pages: XhsCarouselPage[] = []
  let current: XhsCarouselPart[] = []
  let used = 0
  const flush = (): void => {
    if (current.length === 0) return
    pages.push({ kind: 'content', chapterTitle, parts: current })
    current = []
    used = 0
  }

  for (const card of cards) {
    const headingLines = wrapLines(
      measure,
      card.heading,
      CONTENT_WIDTH - 54,
      HEADING_SIZE,
      SERIF,
      '600',
    )
    const bodyLines = card.body
      ? wrapLines(measure, card.body, CONTENT_WIDTH - 54, BODY_SIZE, SERIF, '400')
      : []
    let cursor = 0
    let first = true
    while (first || cursor < bodyLines.length) {
      const gap = current.length > 0 ? CARD_GAP : 0
      const available = CONTENT_HEIGHT - used - gap
      const headingHeight = first ? headingLines.length * HEADING_LINE_HEIGHT + 8 : 26
      const metaHeight = first && card.tags.length > 0 ? META_HEIGHT : 0
      let maxBody = Math.floor((available - headingHeight - metaHeight) / BODY_LINE_HEIGHT)
      if (maxBody <= 0) {
        if (current.length > 0) {
          flush()
          continue
        }
        maxBody = 1
      }
      if (current.length > 0 && maxBody < 2) {
        flush()
        continue
      }
      const chunk = bodyLines.slice(cursor, cursor + maxBody)
      current.push({
        cardId: card.id,
        number: card.number,
        headingLines: first ? headingLines : [],
        bodyLines: chunk,
        tags: first ? card.tags : [],
        continuation: !first,
      })
      used += gap + headingHeight + chunk.length * BODY_LINE_HEIGHT + metaHeight
      cursor += chunk.length
      first = false
      if (cursor < bodyLines.length) flush()
    }
  }
  flush()
  return pages
}

export function planXhsCarousel(input: PlanInput): XhsCarouselPlan {
  const groups = contentGroups(input)
  const cards: XhsCarouselCard[] = []
  for (const group of groups) {
    for (const note of group.notes) {
      const card = normalizeCard(note, cards.length + 1, input.bookTitle, group.chapterTitle)
      if (card) cards.push(card)
    }
  }
  const selectedCards = input.concise ? cards.slice(0, 3) : cards
  const contentPages = groups.flatMap((group) => {
    const groupCards = selectedCards.filter((card) =>
      group.notes.some((note) => note.id === card.id),
    )
    return packCards(groupCards, group.chapterTitle, input.measure)
  })
  const singleCardPages = contentPages.flatMap((page) =>
    page.parts.map((part) => ({ ...page, parts: [part] })),
  )
  const effectivePages = singleCardPages.length + 2 <= 18 ? singleCardPages : contentPages
  const chapterTitles = [...new Set(selectedCards.map((card) => card.chapterTitle).filter(Boolean))] as string[]
  const title = input.title?.trim() || (input.scope === 'chapter' ? input.chapterTitle ?? input.bookTitle : input.bookTitle)
  const subtitle =
    input.scope === 'chapter'
      ? `${input.bookTitle}${input.author ? ` · ${input.author}` : ''}`
      : `${input.author || '未署名'} · ${chapterTitles.length} 节`
  const pages: XhsCarouselPage[] = [
    { kind: 'cover', chapterTitle: null, parts: [] },
    ...effectivePages,
    { kind: 'closing', chapterTitle: null, parts: [] },
  ]
  const covered = new Set(effectivePages.flatMap((page) => page.parts.map((part) => part.cardId))).size
  const warnings: string[] = []
  if (selectedCards.length === 0) warnings.push('还没有核心知识点卡片。')
  if (pages.length > 18) warnings.push(`共 ${pages.length} 页，小红书单篇最多 18 张，建议按章节生成或分多篇发布。`)
  if (selectedCards.length > 60) warnings.push('知识点较多，整套图会很长，建议按章节拆分。')
  if (covered !== selectedCards.length) warnings.push(`有 ${selectedCards.length - covered} 个知识点没有排进页面。`)

  return {
    scope: input.scope,
    title,
    subtitle,
    bookTitle: input.bookTitle,
    author: input.author,
    cards: selectedCards,
    pages,
    chapterTitles,
    totalCards: selectedCards.length,
    coveredCards: covered,
    warnings,
  }
}

export function defaultMeasureContext(): CanvasRenderingContext2D {
  if (typeof document === 'undefined') throw new Error('当前环境没有可用的 Canvas。')
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布。')
  return ctx
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function drawFrame(ctx: CanvasRenderingContext2D, palette: Palette): void {
  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
  ctx.save()
  ctx.shadowColor = 'rgba(20, 18, 14, 0.18)'
  ctx.shadowBlur = 36
  ctx.shadowOffsetY = 18
  ctx.fillStyle = palette.sheet
  roundRect(ctx, 42, 42, PAGE_WIDTH - 84, PAGE_HEIGHT - 84, 30)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = palette.line
  ctx.lineWidth = 2
  roundRect(ctx, 42, 42, PAGE_WIDTH - 84, PAGE_HEIGHT - 84, 30)
  ctx.stroke()

  ctx.fillStyle = palette.accent
  ctx.fillRect(LEFT, 92, 44, 5)
  ctx.fillStyle = palette.ink
  ctx.font = `600 28px ${SERIF}`
  ctx.fillText('页边', LEFT, 112)
  ctx.fillStyle = palette.muted
  ctx.font = `500 16px ${SANS}`
  ctx.fillText('小红书图文', 178, 122)
}

function drawPageNo(ctx: CanvasRenderingContext2D, index: number, total: number, palette: Palette): void {
  ctx.fillStyle = palette.muted
  ctx.font = `500 16px ${SANS}`
  ctx.textAlign = 'right'
  ctx.fillText(`${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, PAGE_WIDTH - LEFT, 118)
  ctx.textAlign = 'left'
}

function drawFooter(ctx: CanvasRenderingContext2D, palette: Palette): void {
  ctx.strokeStyle = palette.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(LEFT, PAGE_HEIGHT - 92)
  ctx.lineTo(PAGE_WIDTH - RIGHT, PAGE_HEIGHT - 92)
  ctx.stroke()
  ctx.fillStyle = palette.muted
  ctx.font = `400 15px ${SANS}`
  ctx.fillText('页边 ThinRead · 书和笔记都留在本机', LEFT, PAGE_HEIGHT - 58)
  ctx.textAlign = 'right'
  ctx.fillText('THINREAD / XHS', PAGE_WIDTH - RIGHT, PAGE_HEIGHT - 58)
  ctx.textAlign = 'left'
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  maxHeight: number,
  maxSize: number,
  minSize: number,
  lineHeightRatio: number,
  family: string,
  weight: string,
): { lines: string[]; size: number; lineHeight: number } {
  for (let size = maxSize; size >= minSize; size -= 2) {
    const lines = wrapLines(ctx, text, width, size, family, weight)
    const lineHeight = Math.round(size * lineHeightRatio)
    if (lines.length * lineHeight <= maxHeight) return { lines, size, lineHeight }
  }
  const size = minSize
  const lineHeight = Math.round(size * lineHeightRatio)
  const lines = wrapLines(ctx, text, width, size, family, weight)
  return {
    lines: lines.slice(0, Math.max(1, Math.floor(maxHeight / lineHeight))),
    size,
    lineHeight,
  }
}

function drawCover(ctx: CanvasRenderingContext2D, plan: XhsCarouselPlan, palette: Palette, total: number): void {
  drawFrame(ctx, palette)
  drawPageNo(ctx, 0, total, palette)
  ctx.fillStyle = palette.accent
  ctx.font = `600 21px ${SANS}`
  ctx.fillText(plan.scope === 'chapter' ? 'CHAPTER NOTES / 章节图文' : 'BOOK NOTES / 整本书图文', LEFT, 196)

  const title = fitText(ctx, plan.title, CONTENT_WIDTH, 300, 76, 44, 1.22, SERIF, '700')
  ctx.fillStyle = palette.ink
  ctx.font = `700 ${title.size}px ${SERIF}`
  title.lines.forEach((line, index) => ctx.fillText(line, LEFT, 266 + index * title.lineHeight))
  const titleBottom = 266 + title.lines.length * title.lineHeight

  ctx.fillStyle = palette.soft
  ctx.font = `400 24px ${SANS}`
  ctx.fillText(plan.subtitle, LEFT, titleBottom + 30)

  ctx.fillStyle = palette.ink
  ctx.font = `600 22px ${SANS}`
  ctx.fillText(`${plan.totalCards} 个知识点`, LEFT, titleBottom + 82)
  ctx.fillStyle = palette.muted
  ctx.font = `400 18px ${SANS}`
  ctx.fillText(`已覆盖 ${plan.coveredCards} / ${plan.totalCards} · 无遗漏`, LEFT, titleBottom + 112)

  ctx.strokeStyle = palette.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(LEFT, titleBottom + 150)
  ctx.lineTo(PAGE_WIDTH - RIGHT, titleBottom + 150)
  ctx.stroke()

  const listTop = Math.max(titleBottom + 188, 560)
  const sample = plan.cards[0]
  ctx.fillStyle = palette.accent
  ctx.font = `600 15px ${SANS}`
  ctx.fillText('SELECTED / 选读', LEFT, listTop)

  if (sample) {
    const quoteText = [sample.heading, sample.body].filter(Boolean).join(' ')
    const quote = fitText(ctx, quoteText, CONTENT_WIDTH - 40, 500, 44, 28, 1.58, SERIF, '400')
    const quoteHeight = quote.lines.length * quote.lineHeight
    const quoteTop = listTop + 100 + Math.max(0, (PAGE_HEIGHT - 320 - (listTop + 100) - quoteHeight) / 2)

    ctx.save()
    ctx.fillStyle = palette.accent
    ctx.globalAlpha = 0.16
    ctx.font = `400 170px ${SERIF}`
    ctx.fillText('“', LEFT - 10, quoteTop - 52)
    ctx.restore()

    ctx.fillStyle = palette.ink
    ctx.font = `400 ${quote.size}px ${SERIF}`
    quote.lines.forEach((line, index) => ctx.fillText(line, LEFT + 24, quoteTop + index * quote.lineHeight))
  }

  ctx.save()
  ctx.globalAlpha = 0.06
  ctx.fillStyle = palette.ink
  ctx.font = `700 220px ${SERIF}`
  ctx.textAlign = 'right'
  ctx.fillText(String(plan.totalCards).padStart(2, '0'), PAGE_WIDTH - LEFT, PAGE_HEIGHT - 260)
  ctx.restore()
  ctx.textAlign = 'left'

  ctx.fillStyle = palette.muted
  ctx.font = `400 17px ${SANS}`
  ctx.fillText(`共 ${plan.totalCards} 个知识点 · 已覆盖 ${plan.coveredCards} / ${plan.totalCards}`, LEFT, PAGE_HEIGHT - 152)

  if (plan.warnings.length > 0) {
    ctx.fillStyle = palette.accent
    ctx.font = `400 14px ${SANS}`
    ctx.fillText(plan.warnings[0]!, LEFT, PAGE_HEIGHT - 142)
  }

  drawFooter(ctx, palette)
}

function drawContent(ctx: CanvasRenderingContext2D, plan: XhsCarouselPlan, page: XhsCarouselPage, pageIndex: number, total: number, palette: Palette): void {
  drawFrame(ctx, palette)
  drawPageNo(ctx, pageIndex, total, palette)
  const header = fitText(ctx, page.chapterTitle ?? plan.title, CONTENT_WIDTH, 24, 16, 12, 1.2, SANS, '600')
  ctx.fillStyle = palette.accent
  ctx.font = `600 ${header.size}px ${SANS}`
  ctx.fillText(header.lines[0] ?? '', LEFT, 178)
  ctx.strokeStyle = palette.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(LEFT, 200)
  ctx.lineTo(PAGE_WIDTH - RIGHT, 200)
  ctx.stroke()

  const blockHeight = (part: XhsCarouselPart): number => {
    const heading = part.headingLines.length * HEADING_LINE_HEIGHT
    const body = part.bodyLines.length * BODY_LINE_HEIGHT
    const tags = part.tags.length > 0 ? META_HEIGHT : 0
    return heading + (heading > 0 ? 10 : 0) + body + tags + (part.continuation ? 26 : 0)
  }
  const contentTop = 240
  const contentBottom = PAGE_HEIGHT - 150
  const parts = page.parts
  if (parts.length === 1) {
    const part = parts[0]!
    const headingText = part.headingLines.join(' ').trim()
    const bodyText = part.bodyLines.join(' ').trim()
    const heading = fitText(ctx, headingText, CONTENT_WIDTH - 120, 240, 50, 32, 1.32, SERIF, '600')
    const body = fitText(ctx, bodyText, CONTENT_WIDTH - 120, 320, 32, 24, 1.72, SERIF, '400')
    const headingHeight = heading.lines.length * heading.lineHeight
    const bodyHeight = body.lines.length * body.lineHeight
    const panelHeight = Math.max(130 + headingHeight + bodyHeight, 360)
    const panelTop = contentTop + (contentBottom - contentTop - panelHeight) / 2

    ctx.save()
    ctx.globalAlpha = 0.065
    ctx.fillStyle = palette.accent
    roundRect(ctx, LEFT - 22, panelTop, CONTENT_WIDTH + 44, panelHeight, 24)
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = palette.accent
    ctx.fillRect(LEFT - 22, panelTop, 6, panelHeight)

    let cursor = panelTop + (panelHeight - (headingHeight + bodyHeight + 80)) / 2
    ctx.fillStyle = palette.accent
    ctx.font = `600 17px ${SANS}`
    ctx.fillText(String(part.number).padStart(2, '0'), LEFT + 6, cursor + 4)
    cursor += 34

    ctx.fillStyle = palette.ink
    ctx.font = `600 ${heading.size}px ${SERIF}`
    heading.lines.forEach((line, index) => ctx.fillText(line, LEFT + 52, cursor + index * heading.lineHeight))
    cursor += headingHeight + 26

    if (body.lines.length > 0) {
      ctx.fillStyle = palette.soft
      ctx.font = `400 ${body.size}px ${SERIF}`
      body.lines.forEach((line, index) => ctx.fillText(line, LEFT + 52, cursor + index * body.lineHeight))
      cursor += bodyHeight
    }
    if (part.tags.length > 0) {
      ctx.fillStyle = palette.accent
      ctx.font = `400 15px ${SANS}`
      ctx.fillText(part.tags.join(' · '), LEFT + 52, cursor + 14)
    }
    drawFooter(ctx, palette)
    return
  }

  const totalHeight =
    parts.reduce((sum, part) => sum + blockHeight(part) + 40, 0) + Math.max(0, parts.length - 1) * 22
  let y = contentTop + Math.max(0, (contentBottom - contentTop - totalHeight) / 2)

  parts.forEach((part) => {
    const height = blockHeight(part)
    ctx.save()
    ctx.globalAlpha = 0.055
    ctx.fillStyle = palette.accent
    roundRect(ctx, LEFT - 22, y - 20, CONTENT_WIDTH + 44, height + 40, 18)
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = palette.accent
    ctx.fillRect(LEFT - 22, y - 20, 4, height + 40)

    ctx.fillStyle = palette.accent
    ctx.font = `600 15px ${SANS}`
    ctx.fillText(String(part.number).padStart(2, '0'), LEFT, y + 4)
    let cursor = y
    if (part.continuation) {
      ctx.fillStyle = palette.muted
      ctx.font = `400 14px ${SANS}`
      ctx.fillText('续', LEFT, y + 26)
      cursor += 26
    }
    if (part.headingLines.length > 0) {
      ctx.fillStyle = palette.ink
      ctx.font = `600 ${HEADING_SIZE}px ${SERIF}`
      part.headingLines.forEach((line, lineIndex) => {
        ctx.fillText(line, LEFT + 52, cursor + lineIndex * HEADING_LINE_HEIGHT)
      })
      cursor += part.headingLines.length * HEADING_LINE_HEIGHT + 10
    }
    if (part.bodyLines.length > 0) {
      ctx.fillStyle = palette.soft
      ctx.font = `400 ${BODY_SIZE}px ${SERIF}`
      part.bodyLines.forEach((line, lineIndex) => {
        ctx.fillText(line, LEFT + 52, cursor + lineIndex * BODY_LINE_HEIGHT)
      })
      cursor += part.bodyLines.length * BODY_LINE_HEIGHT
    }
    if (part.tags.length > 0) {
      ctx.fillStyle = palette.accent
      ctx.font = `400 15px ${SANS}`
      ctx.fillText(part.tags.join(' · '), LEFT + 52, cursor + 8)
    }
    y += height + 40 + 22
  })

  drawFooter(ctx, palette)
}

function drawClosing(ctx: CanvasRenderingContext2D, plan: XhsCarouselPlan, palette: Palette, total: number): void {
  drawFrame(ctx, palette)
  drawPageNo(ctx, total - 1, total, palette)
  ctx.fillStyle = palette.accent
  ctx.font = `600 20px ${SANS}`
  ctx.fillText('THE LAST PAGE / 读到这里', LEFT, 210)
  const title =
    plan.scope === 'chapter'
      ? `这一章，留下 ${plan.totalCards} 个知识点`
      : `这本书，留下 ${plan.totalCards} 个知识点`
  const block = fitText(ctx, title, CONTENT_WIDTH, 300, 66, 44, 1.25, SERIF, '700')
  ctx.fillStyle = palette.ink
  ctx.font = `700 ${block.size}px ${SERIF}`
  block.lines.forEach((line, index) => ctx.fillText(line, LEFT, 290 + index * block.lineHeight))
  let y = 290 + block.lines.length * block.lineHeight + 38
  ctx.fillStyle = palette.soft
  ctx.font = `400 24px ${SERIF}`
  ctx.fillText(`全部 ${plan.totalCards} 个知识点已排进这套图，没有遗漏。`, LEFT, y)
  y += 48
  ctx.fillStyle = palette.muted
  ctx.font = `400 19px ${SANS}`
  ctx.fillText(plan.scope === 'chapter' ? plan.bookTitle : `${plan.author || '未署名'} · ${plan.bookTitle}`, LEFT, y)
  y += 104
  ctx.strokeStyle = palette.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(LEFT, y)
  ctx.lineTo(PAGE_WIDTH - RIGHT, y)
  ctx.stroke()
  ctx.fillStyle = palette.accent
  ctx.font = `600 18px ${SANS}`
  ctx.fillText('页边 · 把一本书读成自己的', LEFT, y + 46)
  drawFooter(ctx, palette)
}

export function renderXhsPage(
  canvas: HTMLCanvasElement,
  plan: XhsCarouselPlan,
  pageIndex: number,
  theme: XhsTheme,
): void {
  canvas.width = PAGE_WIDTH
  canvas.height = PAGE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布。')
  ctx.textBaseline = 'top'
  const palette = PALETTES[theme]
  const page = plan.pages[pageIndex]
  if (!page) throw new Error('页面不存在。')
  if (page.kind === 'cover') drawCover(ctx, plan, palette, plan.pages.length)
  else if (page.kind === 'closing') drawClosing(ctx, plan, palette, plan.pages.length)
  else drawContent(ctx, plan, page, pageIndex, plan.pages.length, palette)
}

export function xhsPageFilename(plan: XhsCarouselPlan, pageIndex: number): string {
  const page = plan.pages[pageIndex]
  const number = String(pageIndex + 1).padStart(2, '0')
  const title = (page?.kind === 'cover' ? '封面' : page?.kind === 'closing' ? '结尾' : page?.chapterTitle ?? '知识点')
    .replace(/[\\/:*?"<>|#%{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16)
  return `页边-${number}-${title || '小红书'}.png`
}
