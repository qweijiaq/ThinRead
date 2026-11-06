import type { ChapterMeta, Note } from '../../shared/types.js'

import { titleRepeatsContent } from './note-display.js'

import {
  SHARE_MONO,
  SHARE_SANS,
  drawAccentRule,
  drawChip,
  drawEmphasizedLines,
  drawHairline,
  drawMarkerLine,
  findKeyPhrase,
  drawMasthead,
  drawTracked,
  drawTrackedRight,
  paintSharePage,
  segmentText,
  sharePalette,
  type SharePalette,
  type ShareTheme,
} from './share-visual.js'

export type XhsScope = 'chapter' | 'book'
export type XhsTheme = ShareTheme

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
  brand: string
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
  brand?: string
  chapters: ChapterMeta[]
  notes: Note[]
  title?: string
  concise?: boolean
  measure: MeasureContext
}

const PAGE_WIDTH = 1080
const PAGE_HEIGHT = 1440
const LEFT = 88
const RIGHT = 88
const CONTENT_WIDTH = PAGE_WIDTH - LEFT - RIGHT
const CONTENT_HEIGHT = 1000
const CARD_GAP = 26
const HEADING_SIZE = 34
const HEADING_LINE_HEIGHT = 48
const BODY_SIZE = 25
const BODY_LINE_HEIGHT = 42
const META_HEIGHT = 30

const SERIF = SHARE_SANS
const SANS = SHARE_SANS
const MONO = SHARE_MONO
type Palette = SharePalette

function flatten(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function tokenize(text: string): string[] {
  return segmentText(text)
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
    brand: input.brand?.trim() ?? '',
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

function drawFrame(ctx: CanvasRenderingContext2D, palette: Palette): void {
  paintSharePage(ctx, PAGE_WIDTH, PAGE_HEIGHT, palette, 28)
}

function drawPageNo(ctx: CanvasRenderingContext2D, index: number, total: number, palette: Palette): void {
  drawTrackedRight(
    ctx,
    `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`,
    PAGE_WIDTH - RIGHT,
    68,
    `500 10px ${MONO}`,
    palette.muted,
    1.8,
  )
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
): { lines: string[]; size: number; lineHeight: number; font: string } {
  for (let size = maxSize; size >= minSize; size -= 2) {
    const lines = wrapLines(ctx, text, width, size, family, weight)
    const lineHeight = Math.round(size * lineHeightRatio)
    if (lines.length * lineHeight <= maxHeight) {
      const last = lines[lines.length - 1]?.trim() ?? ''
      if (lines.length > 1 && last.length <= 2 && size > minSize) continue
      return { lines, size, lineHeight, font: `${weight} ${size}px ${family}` }
    }
  }
  const size = minSize
  const lineHeight = Math.round(size * lineHeightRatio)
  const lines = wrapLines(ctx, text, width, size, family, weight)
  return {
    lines: lines.slice(0, Math.max(1, Math.floor(maxHeight / lineHeight))),
    size,
    lineHeight,
    font: `${weight} ${size}px ${family}`,
  }
}

function drawFooter(ctx: CanvasRenderingContext2D, palette: Palette, brand = ''): void {
  drawHairline(ctx, palette, LEFT, PAGE_WIDTH - RIGHT, PAGE_HEIGHT - 90)
  drawTracked(ctx, '页边 / 小红书图文', LEFT, PAGE_HEIGHT - 64, `500 10px ${MONO}`, palette.muted, 1.6)
  drawTrackedRight(
    ctx,
    brand || 'THINREAD / XHS',
    PAGE_WIDTH - RIGHT,
    PAGE_HEIGHT - 64,
    `500 10px ${MONO}`,
    palette.muted,
    1.6,
  )
}

function drawProgress(ctx: CanvasRenderingContext2D, palette: Palette, pageIndex: number, total: number): void {
  const width = PAGE_WIDTH - LEFT - RIGHT
  const y = PAGE_HEIGHT - 126
  ctx.fillStyle = palette.line
  ctx.fillRect(LEFT, y, width, 2)
  ctx.fillStyle = palette.accent
  ctx.fillRect(LEFT, y, width * Math.min(1, (pageIndex + 1) / Math.max(1, total)), 2)
}

function drawCover(ctx: CanvasRenderingContext2D, plan: XhsCarouselPlan, palette: Palette, total: number): void {
  drawFrame(ctx, palette)
  drawMasthead(ctx, palette, LEFT, PAGE_WIDTH - RIGHT, 66)
  drawPageNo(ctx, 0, total, palette)

  drawTracked(
    ctx,
    plan.scope === 'chapter' ? 'CHAPTER NOTES / 章节图文' : 'BOOK NOTES / 整本书图文',
    LEFT,
    164,
    `500 11px ${MONO}`,
    palette.accent,
    2.2,
  )

  const title = fitText(ctx, plan.title, CONTENT_WIDTH, 250, 58, 40, 1.32, SERIF, '600')
  ctx.fillStyle = palette.ink
  ctx.font = title.font
  if (title.lines[0]) {
    drawMarkerLine(ctx, palette, LEFT, 206, Math.min(CONTENT_WIDTH, ctx.measureText(title.lines[0]).width), title.lineHeight)
  }
  ctx.fillStyle = palette.ink
  title.lines.forEach((line, index) => ctx.fillText(line, LEFT, 206 + index * title.lineHeight))
  const titleBottom = 206 + title.lines.length * title.lineHeight

  drawAccentRule(ctx, palette, LEFT, titleBottom + 18, 96, 6)
  ctx.fillStyle = palette.soft
  ctx.font = `400 22px ${SANS}`
  ctx.fillText(plan.subtitle, LEFT, titleBottom + 44)

  const statsY = titleBottom + 100
  const chipWidth = drawChip(ctx, `${plan.totalCards} 个知识点`, LEFT, statsY, palette, { accent: true })
  drawChip(ctx, `已覆盖 ${plan.coveredCards} / ${plan.totalCards}`, LEFT + chipWidth + 8, statsY, palette)
  drawHairline(ctx, palette, LEFT, PAGE_WIDTH - RIGHT, statsY + 44)

  const sample = plan.cards[0]
  if (sample) {
    const selectedTop = Math.max(statsY + 106, 628)
    drawAccentRule(ctx, palette, LEFT, selectedTop, 40, 3)
    drawTracked(ctx, 'SELECTED / 选读', LEFT + 54, selectedTop - 6, `500 11px ${MONO}`, palette.accent, 2)

    const quoteTop = selectedTop + 64
    const quoteText = [sample.heading, sample.body].filter(Boolean).join(' ')
    const quote = fitText(
      ctx,
      quoteText,
      CONTENT_WIDTH - 30,
      PAGE_HEIGHT - 294 - quoteTop,
      32,
      24,
      1.75,
      SERIF,
      '400',
    )
    ctx.fillStyle = palette.ink
    ctx.font = `400 ${quote.size}px ${SERIF}`
    drawEmphasizedLines(
      ctx,
      quote.lines,
      LEFT,
      quoteTop,
      quote.lineHeight,
      quote.font,
      findKeyPhrase(quoteText),
      palette,
      palette.ink,
    )
  }

  const metaY = PAGE_HEIGHT - 174
  drawAccentRule(ctx, palette, LEFT, metaY - 34, 28, 2)
  drawTracked(
    ctx,
    `${plan.totalCards} 个知识点 · ${total} 页`,
    LEFT,
    metaY,
    `500 14px ${MONO}`,
    palette.muted,
    1.4,
  )
  drawTrackedRight(ctx, '向右滑 →', PAGE_WIDTH - RIGHT, metaY, `500 14px ${MONO}`, palette.accent, 1.8)

  drawProgress(ctx, palette, 0, total)
  drawFooter(ctx, palette, plan.brand)
}

function drawContent(
  ctx: CanvasRenderingContext2D,
  plan: XhsCarouselPlan,
  page: XhsCarouselPage,
  pageIndex: number,
  total: number,
  palette: Palette,
): void {
  drawFrame(ctx, palette)
  drawMasthead(ctx, palette, LEFT, PAGE_WIDTH - RIGHT, 66)
  drawPageNo(ctx, pageIndex, total, palette)

  const header = fitText(ctx, page.chapterTitle ?? plan.title, CONTENT_WIDTH - 120, 22, 14, 11, 1.2, SANS, '600')
  ctx.fillStyle = palette.accent
  ctx.font = `600 ${header.size}px ${MONO}`
  ctx.fillText(header.lines[0] ?? '', LEFT, 156)
  drawHairline(ctx, palette, LEFT, PAGE_WIDTH - RIGHT, 188)

  const contentTop = 226
  const contentBottom = PAGE_HEIGHT - 152
  const parts = page.parts

  if (parts.length === 1) {
    const part = parts[0]!
    const headingText = part.headingLines.join(' ').trim()
    const bodyText = part.bodyLines.join(' ').trim()
    const heading = fitText(ctx, headingText, CONTENT_WIDTH - 60, 300, 44, 32, 1.4, SERIF, '600')
    const body = fitText(ctx, bodyText, CONTENT_WIDTH - 60, 520, 30, 22, 1.8, SERIF, '400')
    const headingHeight = heading.lines.length * heading.lineHeight
    const bodyHeight = body.lines.length * body.lineHeight
    const tagsHeight = part.tags.length > 0 ? 40 : 0
    const totalHeight = headingHeight + 30 + bodyHeight + tagsHeight
    let cursor = contentTop + Math.max(0, (contentBottom - contentTop - totalHeight) / 2)

    drawTracked(ctx, String(part.number).padStart(2, '0'), LEFT, cursor + 2, `700 32px ${MONO}`, palette.accent, 1.8)
    cursor += 54
    ctx.fillStyle = palette.ink
    ctx.font = `800 ${heading.size}px ${SERIF}`
    heading.lines.forEach((line, index) => ctx.fillText(line, LEFT, cursor + index * heading.lineHeight))
    cursor += headingHeight + 30

    if (body.lines.length > 0) {
      ctx.fillStyle = palette.soft
      ctx.font = body.font
      drawEmphasizedLines(
        ctx,
        body.lines,
        LEFT,
        cursor,
        body.lineHeight,
        body.font,
        findKeyPhrase(bodyText),
        palette,
        palette.soft,
      )
      cursor += bodyHeight + 20
    }
    if (part.tags.length > 0) {
      drawTracked(ctx, part.tags.slice(0, 3).join('  ·  '), LEFT, cursor, `500 14px ${MONO}`, palette.accent, 1.4)
    }

    ctx.save()
    ctx.globalAlpha = 0.045
    ctx.fillStyle = palette.accent
    ctx.textAlign = 'right'
    ctx.font = `700 240px ${SERIF}`
    ctx.fillText(String(part.number).padStart(2, '0'), PAGE_WIDTH - RIGHT, PAGE_HEIGHT - 470)
    ctx.restore()
    ctx.textAlign = 'left'

    drawProgress(ctx, palette, pageIndex, total)
    drawFooter(ctx, palette, plan.brand)
    return
  }

  const blockHeight = (part: XhsCarouselPart): number => {
    const heading = part.headingLines.length * HEADING_LINE_HEIGHT
    const body = part.bodyLines.length * BODY_LINE_HEIGHT
    const tags = part.tags.length > 0 ? META_HEIGHT : 0
    const continuation = part.continuation ? 24 : 0
    return heading + (heading > 0 ? 12 : 0) + body + tags + continuation
  }

  const gap = 34
  const totalHeight =
    parts.reduce((sum, part) => sum + blockHeight(part), 0) + Math.max(0, parts.length - 1) * gap
  let y = contentTop + Math.max(0, (contentBottom - contentTop - totalHeight) / 2)

  parts.forEach((part, index) => {
    if (index > 0) drawHairline(ctx, palette, LEFT, PAGE_WIDTH - RIGHT, y - gap / 2)
    drawTracked(ctx, String(part.number).padStart(2, '0'), LEFT, y + 2, `700 18px ${MONO}`, palette.accent, 1.8)
    let cursor = y
    if (part.continuation) {
      drawTracked(ctx, '续', LEFT + 38, y + 4, `500 13px ${MONO}`, palette.muted, 1)
      cursor += 24
    }
    if (part.headingLines.length > 0) {
      ctx.fillStyle = palette.ink
      ctx.font = `700 ${HEADING_SIZE}px ${SERIF}`
      part.headingLines.forEach((line, lineIndex) => {
        ctx.fillText(line, LEFT + 52, cursor + lineIndex * HEADING_LINE_HEIGHT)
      })
      cursor += part.headingLines.length * HEADING_LINE_HEIGHT + 12
    }
    if (part.bodyLines.length > 0) {
      ctx.fillStyle = palette.soft
      ctx.font = `400 ${BODY_SIZE}px ${SERIF}`
      drawEmphasizedLines(
        ctx,
        part.bodyLines,
        LEFT + 52,
        cursor,
        BODY_LINE_HEIGHT,
        `400 ${BODY_SIZE}px ${SERIF}`,
        findKeyPhrase(part.bodyLines.join('')),
        palette,
        palette.soft,
      )
      cursor += part.bodyLines.length * BODY_LINE_HEIGHT
    }
    if (part.tags.length > 0) {
      drawTracked(
        ctx,
        part.tags.slice(0, 3).join('  ·  '),
        LEFT + 52,
        cursor + 10,
        `500 14px ${MONO}`,
        palette.accent,
        1.4,
      )
    }
    y += blockHeight(part) + gap
  })

  drawProgress(ctx, palette, pageIndex, total)
  drawFooter(ctx, palette, plan.brand)
}

function drawClosing(ctx: CanvasRenderingContext2D, plan: XhsCarouselPlan, palette: Palette, total: number): void {
  drawFrame(ctx, palette)
  drawMasthead(ctx, palette, LEFT, PAGE_WIDTH - RIGHT, 66)
  drawPageNo(ctx, total - 1, total, palette)

  drawTracked(ctx, 'THE LAST PAGE / 回顾', LEFT, 174, `500 13px ${MONO}`, palette.accent, 2.2)
  const title =
    plan.scope === 'chapter'
      ? `这一章，留下 ${plan.totalCards} 个知识点`
      : `这本书，留下 ${plan.totalCards} 个知识点`
  const block = fitText(ctx, title, CONTENT_WIDTH, 240, 50, 34, 1.32, SERIF, '600')
  ctx.fillStyle = palette.ink
  ctx.font = block.font
  block.lines.forEach((line, index) => ctx.fillText(line, LEFT, 222 + index * block.lineHeight))
  let y = 222 + block.lines.length * block.lineHeight + 26
  drawAccentRule(ctx, palette, LEFT, y, 52, 3)
  y += 52

  const items =
    plan.scope === 'chapter'
      ? plan.cards.slice(0, 4).map((card) => card.heading)
      : plan.chapterTitles.slice(0, 6)
  items.forEach((item, index) => {
    drawTracked(ctx, String(index + 1).padStart(2, '0'), LEFT, y + 3, `700 18px ${MONO}`, palette.accent, 1.8)
    const line = fitText(ctx, item, CONTENT_WIDTH - 62, 56, 26, 19, 1.52, SERIF, '500')
    ctx.fillStyle = palette.soft
    ctx.font = line.font
    line.lines.forEach((text, lineIndex) => ctx.fillText(text, LEFT + 52, y + lineIndex * line.lineHeight))
    y += Math.max(48, line.lines.length * line.lineHeight) + 20
    if (index < items.length - 1) drawHairline(ctx, palette, LEFT + 52, PAGE_WIDTH - RIGHT, y - 9)
  })

  y += 18
  ctx.fillStyle = palette.muted
  ctx.font = `400 20px ${SANS}`
  ctx.fillText(`全部 ${plan.totalCards} 个知识点已排进这套图，没有遗漏。`, LEFT, y)
  y += 36
  ctx.fillStyle = palette.muted
  ctx.font = `400 16px ${MONO}`
  ctx.fillText(plan.scope === 'chapter' ? plan.bookTitle : `${plan.author || '未署名'} · ${plan.bookTitle}`, LEFT, y)

  drawProgress(ctx, palette, total - 1, total)
  drawFooter(ctx, palette, plan.brand)
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
  const palette = sharePalette(theme)
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
