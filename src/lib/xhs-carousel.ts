import { t } from '../lib/i18n.js'
import type { ChapterMeta, Note } from '../../shared/types.js'

import { titleRepeatsContent } from './note-display.js'

import {
  SHARE_SANS,
  findKeyPhrase,
  drawTracked,
  drawTrackedRight,
  segmentText,
  type ShareTheme,
} from './share-visual.js'

export type XhsScope = 'chapter' | 'book'
export type XhsTheme = ShareTheme

export interface XhsCarouselCard {
  id: string
  number: number
  heading: string
  body: string
  quote: string | null
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
const CONTENT_HEIGHT = 940
const CARD_GAP = 44
const HEADING_SIZE = 42
const HEADING_LINE_HEIGHT = 58
const BODY_SIZE = 28
const BODY_LINE_HEIGHT = 50
const META_HEIGHT = 44

const SANS = SHARE_SANS

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

/** 小红书卡片标题要短；把过长标题的后半句放回正文。 */
function cutHeading(text: string, max = 28): { display: string; rest: string } {
  const colonParts = text.split(/[：:]/)
  if (colonParts.length > 1 && colonParts[0]!.length >= 8 && /[、,，]/.test(colonParts.slice(1).join('：'))) {
    return { display: colonParts[0]!.trim(), rest: colonParts.slice(1).join('：').trim() }
  }
  if (text.length <= max) return { display: text, rest: '' }
  const candidates = [
    text.split(/[：:]/)[0],
    text.split(/[，,]/)[0],
    text.split(/[；;]/)[0],
    text.split(/[、]/)[0],
  ]
  for (const candidate of candidates) {
    const value = candidate?.trim() ?? ''
    if (value.length >= 8 && value.length <= max) {
      const rest = text.slice(value.length).replace(/^[，,：:；;、\s]+/, '').trim()
      return { display: value, rest }
    }
  }
  let cut = text.slice(0, max - 1).trim()
  const lastSpace = cut.lastIndexOf(' ')
  if (lastSpace > max * 0.5) cut = cut.slice(0, lastSpace)
  return { display: `${cut}…`, rest: text.slice(cut.length).replace(/^[，,：:；;、\s]+/, '').trim() }
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
  const shortHeading = flatten(heading) || content.slice(0, 48)
  const cut = cutHeading(shortHeading, 28)
  if (cut.rest) body = [cut.rest, body].filter(Boolean).join(' ')
  if (body && body.length > 120) body = summarizeBody(body, 120)
  return {
    id: note.id,
    number,
    heading: cut.display,
    body,
    quote: note.quote ? flatten(note.quote) : null,
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
      chapterTitle: chapterId ? titles.get(chapterId) ?? null : t('未分章'),
      notes: items,
    }))
}

function packCards(
  cards: XhsCarouselCard[],
  chapterTitle: string | null,
  measure: MeasureContext,
  perPage = 2,
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
    if (current.length >= perPage) flush()
    const headingLines = wrapLines(
      measure,
      card.heading,
      CONTENT_WIDTH - 92,
      HEADING_SIZE,
      SANS,
      '700',
    )
    const bodyLines = card.body
      ? wrapLines(measure, card.body, CONTENT_WIDTH - 92, BODY_SIZE, SANS, '400')
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
      if (cursor < bodyLines.length || current.length >= perPage) flush()
    }
  }
  flush()
  return pages
}

/** 一条卡片作为“观点”的强度，用于精选和结尾选句。 */
function cardScore(card: XhsCarouselCard): number {
  const text = `${card.heading} ${card.body}`
  let value = 0
  if (/不是|而是|与其|不如|真正|关键|本质|意味着/.test(text)) value += 4
  if (/\d/.test(text)) value += 1
  if (/[？?]/.test(card.heading)) value += 2
  if (card.tags.length > 0) value += 1
  return value
}

/**
 * 精选模式：不从第一张开始按顺序截断，而是挑出更像“观点”的卡片，
 * 优先对比句、数字、问句和有标签的卡片，再按原顺序排成一条叙事线。
 */
function pickStoryCards(cards: XhsCarouselCard[], limit = 7): XhsCarouselCard[] {
  if (cards.length <= limit) return cards
  return cards
    .map((card, index) => ({ card, index, score: cardScore(card) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.card)
}

/** 封面钩子：优先完整、短、口语的句子，避开技术名词罗列。 */
function hookScore(card: XhsCarouselCard): number {
  const heading = flatten(card.heading)
  let score = cardScore(card)
  if (/[？?]$/.test(heading)) score += 5
  if (heading.length >= 12 && heading.length <= 26) score += 4
  else if (heading.length < 12) score -= 2
  else if (heading.length > 34) score -= 5
  if (/、/.test(heading)) score -= 4
  if ((heading.match(/[A-Za-z]{2,}/g) ?? []).length >= 2) score -= 4
  if (/cookie|localStorage|sessionStorage|URL|JWT|HTTP|API|GET|POST|PUT|PATCH|DELETE/i.test(heading)) score -= 3
  return score
}

function clipHook(text: string, maxLength = 24): string {
  const plain = text.replace(/\s+/g, ' ').trim()
  if (plain.length <= maxLength) return plain
  const clauses = plain.split(/[，,；;]/)
  let result = ''
  for (const clause of clauses) {
    const next = result ? `${result}，${clause}` : clause
    if (next.length > maxLength) break
    result = next
  }
  if (result) return result
  return `${plain.slice(0, maxLength - 1)}…`
}

function coverHook(cards: XhsCarouselCard[]): string {
  if (cards.length === 0) return ''
  const ranked = cards
    .filter(
      (card) =>
        /不是|而是|与其|不如|真正|关键|本质|意味着|为什么|[？?！!]/.test(card.heading) &&
        hookScore(card) >= 3,
    )
    .sort((left, right) => hookScore(right) - hookScore(left))
  const chosen = ranked[0]
  if (!chosen) return ''
  let text = flatten(chosen.heading)
    .replace(/^第[一二三四五六七八九十百]+[章节篇][：:、\s]*/, '')
    .trim()
  const clause = text.split(/[：:]/)[0]?.trim()
  if (clause && clause.length >= 8) text = clause
  const dash = text.split(/——|—/)[0]?.trim()
  if (dash && dash.length >= 8) text = dash
  return clipHook(text).replace(/[。.]$/, '')
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
  const selectedCards = input.concise ? pickStoryCards(cards, 7) : cards
  // 小红书单篇最多 18 张；先按这个上限估算每页几张，保证字号还能看清。
  const perPage = Math.max(2, Math.min(5, Math.ceil(selectedCards.length / 16)))
  const contentPages = groups.flatMap((group) => {
    const groupCards = selectedCards.filter((card) =>
      group.notes.some((note) => note.id === card.id),
    )
    return packCards(groupCards, group.chapterTitle, input.measure, perPage)
  })
  const singleCardPages = contentPages.flatMap((page) =>
    page.parts.map((part) => ({ ...page, parts: [part] })),
  )
  const effectivePages = singleCardPages.length + 2 <= 18 ? singleCardPages : contentPages
  const chapterTitles = [...new Set(selectedCards.map((card) => card.chapterTitle).filter(Boolean))] as string[]
  const fallbackTitle =
    input.scope === 'chapter'
      ? coverHook(selectedCards) ||
        (selectedCards.length > 0
          ? `${t('这一章，我划了 ')}${selectedCards.length}${t(' 句重点')}`
          : input.chapterTitle || input.bookTitle)
      : input.bookTitle
  const title = input.title?.trim() || fallbackTitle
  const subtitle =
    input.scope === 'chapter'
      ? `${input.bookTitle}${input.author ? ` · ${input.author}` : ''}`
      : `${input.author || t('未署名')} · ${chapterTitles.length}${t(' 节')}`
  const pages: XhsCarouselPage[] = [
    { kind: 'cover', chapterTitle: null, parts: [] },
    ...effectivePages,
    { kind: 'closing', chapterTitle: null, parts: [] },
  ]
  const covered = new Set(effectivePages.flatMap((page) => page.parts.map((part) => part.cardId))).size
  const warnings: string[] = []
  if (selectedCards.length === 0) warnings.push(t('还没有核心观点卡片。'))
  if (pages.length > 18) warnings.push(`${t('共 ')}${pages.length}${t(' 页，小红书单篇最多 18 张，建议按章节生成或分多篇发布。')}`)
  if (selectedCards.length > 60) warnings.push(t('知识点较多，整套图会很长，建议按章节拆分。'))
  if (covered !== selectedCards.length) warnings.push(`${t('有 ')}${selectedCards.length - covered}${t(' 个知识点没有排进页面。')}`)

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
  if (typeof document === 'undefined') throw new Error(t('当前环境没有可用的 Canvas。'))
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('无法创建画布。'))
  return ctx
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

interface XhsPalette {
  bg: string
  ink: string
  soft: string
  muted: string
  accent: string
  accentSoft: string
  highlight: string
  line: string
  dark: boolean
}

const XHS_PALETTES: Record<XhsTheme, XhsPalette> = {
  paper: {
    bg: '#fff5e9',
    ink: '#221a15',
    soft: '#4d423a',
    muted: '#8f8074',
    accent: '#ff3b30',
    accentSoft: 'rgba(255, 59, 48, 0.10)',
    highlight: '#ffd166',
    line: 'rgba(34, 26, 21, 0.14)',
    dark: false,
  },
  ink: {
    bg: '#141110',
    ink: '#fff7ea',
    soft: '#ddcfbe',
    muted: '#9c8f80',
    accent: '#ff5470',
    accentSoft: 'rgba(255, 84, 112, 0.16)',
    highlight: '#ffd166',
    line: 'rgba(255, 247, 234, 0.16)',
    dark: true,
  },
  sage: {
    bg: '#edf2e2',
    ink: '#1c2418',
    soft: '#46543c',
    muted: '#7d8a71',
    accent: '#e4572e',
    accentSoft: 'rgba(228, 87, 46, 0.10)',
    highlight: '#f2c14e',
    line: 'rgba(28, 36, 24, 0.14)',
    dark: false,
  },
}

/** 把按行拆开的文本拼回去；中文之间不补空格，英文单词之间保留空格。 */
function joinText(lines: string[]): string {
  return lines
    .join(' ')
    .replace(/\s+([，。！？；：、）》」』】…·])/g, '$1')
    .replace(/([（《「『【])\s+/g, '$1')
    .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

function paletteFor(theme: XhsTheme): XhsPalette {
  return XHS_PALETTES[theme]
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string,
): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

function strokeRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string,
): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.stroke()
}

function drawSticker(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
  bg: string,
  ink: string,
): void {
  ctx.save()
  ctx.translate(centerX, centerY)
  ctx.rotate(-0.07)
  ctx.font = `700 24px ${SANS}`
  const width = ctx.measureText(text).width + 54
  fillRoundRect(ctx, -width / 2, -30, width, 60, 30, bg)
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 0, 2)
  ctx.restore()
}

function drawTopBar(
  ctx: CanvasRenderingContext2D,
  leftText: string,
  rightText: string,
  color: string,
): void {
  drawTracked(ctx, leftText, LEFT, 62, `700 20px ${SANS}`, color, 2)
  drawTrackedRight(ctx, rightText, PAGE_WIDTH - RIGHT, 62, `700 20px ${SANS}`, color, 1.4)
}

function drawDots(
  ctx: CanvasRenderingContext2D,
  palette: XhsPalette,
  pageIndex: number,
  total: number,
  onColor = false,
): void {
  const gap = 14
  const width = 9
  const totalWidth = Math.max(0, total - 1) * gap + width
  let x = (PAGE_WIDTH - totalWidth) / 2
  const y = PAGE_HEIGHT - 108
  for (let index = 0; index < total; index++) {
    const color = index <= pageIndex
      ? onColor
        ? '#fff8ef'
        : palette.accent
      : onColor
        ? 'rgba(255, 248, 239, 0.32)'
        : palette.line
    fillRoundRect(ctx, x, y, width, 5, 2.5, color)
    x += gap
  }
}

function drawSpine(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 16, PAGE_HEIGHT)
}

function drawGhost(ctx: CanvasRenderingContext2D, text: string, palette: XhsPalette): void {
  ctx.save()
  ctx.globalAlpha = palette.dark ? 0.045 : 0.04
  ctx.fillStyle = palette.accent
  ctx.font = `800 300px ${SANS}`
  ctx.textAlign = 'right'
  ctx.fillText(text, PAGE_WIDTH - RIGHT + 24, 318)
  ctx.restore()
  ctx.textAlign = 'left'
}

function drawTagPills(
  ctx: CanvasRenderingContext2D,
  tags: string[],
  x: number,
  y: number,
  palette: XhsPalette,
): void {
  let cursor = x
  for (const tag of tags.slice(0, 3)) {
    ctx.font = `600 17px ${SANS}`
    const width = ctx.measureText(tag).width + 30
    fillRoundRect(ctx, cursor, y, width, 36, 18, palette.accentSoft)
    ctx.fillStyle = palette.accent
    ctx.textBaseline = 'middle'
    ctx.fillText(tag, cursor + 15, y + 19)
    ctx.textBaseline = 'top'
    cursor += width + 10
  }
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  palette: XhsPalette,
  brand = '',
  onColor = false,
): void {
  ctx.fillStyle = onColor ? 'rgba(255, 248, 239, 0.72)' : palette.muted
  ctx.font = `600 18px ${SANS}`
  ctx.fillText('页边 · ThinRead', LEFT, PAGE_HEIGHT - 58)
  if (brand.trim()) {
    ctx.textAlign = 'right'
    ctx.fillText(brand.trim().slice(0, 28), PAGE_WIDTH - RIGHT, PAGE_HEIGHT - 58)
    ctx.textAlign = 'left'
  }
}

function drawCover(ctx: CanvasRenderingContext2D, plan: XhsCarouselPlan, palette: XhsPalette, total: number): void {
  const ground = palette.dark ? '#171210' : palette.accent
  const ink = '#fff8ef'
  ctx.fillStyle = ground
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
  drawSpine(ctx, palette.highlight)

  ctx.save()
  ctx.globalAlpha = palette.dark ? 0.08 : 0.12
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(PAGE_WIDTH - 70, PAGE_HEIGHT - 240, 360, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  drawTopBar(ctx, '页边 · 读书笔记', `${total}${t(' 页')}`, 'rgba(255, 248, 239, 0.78)')

  const chapterLine =
    plan.scope === 'chapter'
      ? plan.cards[0]?.chapterTitle ?? ''
      : t('整本书的读书笔记')
  if (chapterLine && chapterLine !== plan.title) {
    ctx.globalAlpha = 0.82
    drawTracked(ctx, chapterLine, LEFT, 196, `600 23px ${SANS}`, ink, 1.4)
    ctx.globalAlpha = 1
  }

  const title = fitText(ctx, plan.title, CONTENT_WIDTH, 560, 106, 58, 1.14, SANS, '800')
  const titleTop = 252
  ctx.font = title.font
  title.lines.forEach((line, index) => {
    const tail = title.lines.length === 1 ? line.match(/^(.*?)(\d[\s\S]*)$/) : null
    if (tail) {
      ctx.fillStyle = ink
      ctx.fillText(tail[1]!, LEFT, titleTop)
      ctx.fillStyle = palette.highlight
      ctx.fillText(tail[2]!, LEFT + ctx.measureText(tail[1]!).width, titleTop)
      return
    }
    ctx.fillStyle =
      title.lines.length > 1 && index === title.lines.length - 1 ? palette.highlight : ink
    ctx.fillText(line, LEFT, titleTop + index * title.lineHeight)
  })
  const titleBottom = titleTop + title.lines.length * title.lineHeight

  ctx.fillStyle = palette.highlight
  ctx.fillRect(LEFT, titleBottom + 28, 190, 10)

  const meta = `《${plan.bookTitle}》${plan.author ? ` · ${plan.author}` : ''}`
  ctx.globalAlpha = 0.86
  ctx.font = `500 27px ${SANS}`
  ctx.fillStyle = ink
  ctx.fillText(meta, LEFT, titleBottom + 66)
  ctx.globalAlpha = 1

  const noteSource = plan.cards
    .filter(
      (card) =>
        card.heading !== plan.title &&
        card.heading.length >= 10 &&
        card.heading.length <= 30 &&
        !/[A-Za-z0-9、；;]/.test(card.heading),
    )
    .sort((left, right) => hookScore(right) - hookScore(left))[0]
  const noteTop = titleBottom + 150
  if (noteSource && noteTop + 190 < PAGE_HEIGHT - 400) {
    const width = CONTENT_WIDTH - 120
    const height = 178
    const noteText = noteSource.heading.replace(/[；;，,。.\s]+$/, '')
    const note = fitText(ctx, noteText, width - 56, 92, 34, 24, 1.3, SANS, '700')
    ctx.save()
    ctx.translate(LEFT + width / 2, noteTop + height / 2)
    ctx.rotate(-0.025)
    fillRoundRect(ctx, -width / 2, -height / 2, width, height, 22, '#fff8ef')
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    drawTracked(ctx, t('P.S. 这句我划了线'), -width / 2 + 28, -height / 2 + 28, `700 18px ${SANS}`, ground, 1.8)
    ctx.fillStyle = '#221a15'
    ctx.font = note.font
    note.lines.forEach((line, index) => ctx.fillText(line, -width / 2 + 28, -height / 2 + 70 + index * note.lineHeight))
    ctx.restore()
  }

  drawSticker(ctx, t('建议收藏'), PAGE_WIDTH - RIGHT - 96, PAGE_HEIGHT - 470, ink, ground)

  fillRoundRect(ctx, LEFT, PAGE_HEIGHT - 360, CONTENT_WIDTH, 220, 28, 'rgba(255, 248, 239, 0.14)')
  strokeRoundRect(ctx, LEFT, PAGE_HEIGHT - 360, CONTENT_WIDTH, 220, 28, 'rgba(255, 248, 239, 0.22)')
  ctx.fillStyle = ink
  ctx.font = `800 52px ${SANS}`
  ctx.fillText(`${plan.totalCards}${t(' 条划重点')}`, LEFT + 40, PAGE_HEIGHT - 300)
  ctx.globalAlpha = 0.78
  ctx.font = `500 25px ${SANS}`
  ctx.fillText(`${total}${t(' 页 · 向右滑 →')}`, LEFT + 40, PAGE_HEIGHT - 228)
  ctx.globalAlpha = 1

  drawDots(ctx, palette, 0, total, true)
  drawFooter(ctx, palette, plan.brand, true)
}

function drawHighlightedLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  size: number,
  lineHeight: number,
  font: string,
  phrase: string,
  palette: XhsPalette,
  color: string,
): void {
  ctx.font = font
  lines.forEach((line, index) => {
    const hit = phrase ? line.indexOf(phrase) : -1
    if (hit >= 0) {
      const prefix = line.slice(0, hit)
      ctx.save()
      ctx.globalAlpha = palette.dark ? 0.2 : 0.36
      ctx.fillStyle = palette.highlight
      ctx.fillRect(
        x + ctx.measureText(prefix).width - 3,
        y + index * lineHeight + size * 0.12,
        ctx.measureText(phrase).width + 6,
        size * 1.06,
      )
      ctx.restore()
    }
    ctx.fillStyle = color
    ctx.fillText(line, x, y + index * lineHeight)
  })
}

function drawFeature(
  ctx: CanvasRenderingContext2D,
  page: XhsCarouselPage,
  palette: XhsPalette,
): void {
  const part = page.parts[0]!
  const top = 300
  const bottom = PAGE_HEIGHT - 216
  const padding = 40
  const chip = 74

  const headingText = joinText(part.headingLines)
  const bodyText = joinText(part.bodyLines)
  const heading = fitText(ctx, headingText, CONTENT_WIDTH - padding * 2, 300, 64, 40, 1.32, SANS, '800')
  const body = bodyText
    ? fitText(ctx, bodyText, CONTENT_WIDTH - padding * 2, 420, 38, 26, 1.68, SANS, '400')
    : null
  const headingHeight = heading.lines.length * heading.lineHeight
  const bodyHeight = body ? body.lines.length * body.lineHeight : 0
  const tagsHeight = part.tags.length > 0 ? 46 : 0
  const contentHeight = chip + 34 + headingHeight + 30 + bodyHeight + tagsHeight
  const cardHeight = Math.max(520, contentHeight + padding * 2)
  const cardTop = top + Math.max(0, (bottom - top - cardHeight) / 2)
  const surface = palette.dark ? 'rgba(255, 247, 234, 0.035)' : 'rgba(34, 26, 21, 0.035)'

  fillRoundRect(ctx, LEFT, cardTop, CONTENT_WIDTH, cardHeight, 28, surface)
  strokeRoundRect(ctx, LEFT, cardTop, CONTENT_WIDTH, cardHeight, 28, palette.line)

  let y = cardTop + padding
  fillRoundRect(ctx, LEFT + padding, y, chip, chip, 20, palette.accent)
  ctx.fillStyle = palette.dark ? '#1a1210' : '#fff8ef'
  ctx.font = `800 28px ${SANS}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(part.number).padStart(2, '0'), LEFT + padding + chip / 2, y + chip / 2 + 1)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  drawTracked(ctx, t('划重点'), LEFT + padding + chip + 24, y + 24, `700 22px ${SANS}`, palette.muted, 2)
  y += chip + 34

  ctx.fillStyle = palette.ink
  ctx.font = heading.font
  heading.lines.forEach((line, index) => ctx.fillText(line, LEFT + padding, y + index * heading.lineHeight))
  y += headingHeight + 30

  if (body) {
    drawHighlightedLines(
      ctx,
      body.lines,
      LEFT + padding,
      y,
      body.size,
      body.lineHeight,
      body.font,
      findKeyPhrase(bodyText),
      palette,
      palette.soft,
    )
    y += bodyHeight
  }

  if (part.tags.length > 0) {
    drawTagPills(ctx, part.tags, LEFT + padding, y + 18, palette)
  }
}

function drawStack(
  ctx: CanvasRenderingContext2D,
  page: XhsCarouselPage,
  palette: XhsPalette,
): void {
  const parts = page.parts
  const top = 300
  const bottom = PAGE_HEIGHT - 216
  const gap = 24
  const padding = 26
  const blockHeight = (part: XhsCarouselPart): number => {
    const heading = part.headingLines.length * HEADING_LINE_HEIGHT
    const body = part.bodyLines.length * BODY_LINE_HEIGHT
    const tags = part.tags.length > 0 ? 40 : 0
    return heading + (heading > 0 ? 20 : 0) + body + tags
  }
  const cardHeight = (part: XhsCarouselPart): number => blockHeight(part) + padding * 2
  const totalHeight =
    parts.reduce((sum, part) => sum + cardHeight(part), 0) + Math.max(0, parts.length - 1) * gap
  let y = top + Math.max(0, (bottom - top - totalHeight) / 2)
  const surface = palette.dark ? 'rgba(255, 247, 234, 0.035)' : 'rgba(34, 26, 21, 0.035)'

  parts.forEach((part) => {
    const height = cardHeight(part)
    fillRoundRect(ctx, LEFT, y, CONTENT_WIDTH, height, 24, surface)
    strokeRoundRect(ctx, LEFT, y, CONTENT_WIDTH, height, 24, palette.line)

    const chip = 58
    fillRoundRect(ctx, LEFT + padding, y + padding, chip, chip, 16, palette.accent)
    ctx.fillStyle = palette.dark ? '#1a1210' : '#fff8ef'
    ctx.font = `800 23px ${SANS}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(part.number).padStart(2, '0'), LEFT + padding + chip / 2, y + padding + chip / 2 + 1)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'

    const textX = LEFT + padding + chip + 24
    let cursor = y + padding
    if (part.headingLines.length > 0) {
      ctx.fillStyle = palette.ink
      ctx.font = `700 ${HEADING_SIZE}px ${SANS}`
      part.headingLines.forEach((line, lineIndex) => {
        ctx.fillText(line, textX, cursor + lineIndex * HEADING_LINE_HEIGHT)
      })
      cursor += part.headingLines.length * HEADING_LINE_HEIGHT + 18
    }
    if (part.bodyLines.length > 0) {
      drawHighlightedLines(
        ctx,
        part.bodyLines,
        textX,
        cursor,
        BODY_SIZE,
        BODY_LINE_HEIGHT,
        `400 ${BODY_SIZE}px ${SANS}`,
        findKeyPhrase(joinText(part.bodyLines)),
        palette,
        palette.soft,
      )
      cursor += part.bodyLines.length * BODY_LINE_HEIGHT
    }
    if (part.tags.length > 0) {
      drawTagPills(ctx, part.tags, textX, cursor + 10, palette)
    }
    y += height + gap
  })
}

function drawContent(
  ctx: CanvasRenderingContext2D,
  plan: XhsCarouselPlan,
  page: XhsCarouselPage,
  pageIndex: number,
  total: number,
  palette: XhsPalette,
): void {
  ctx.fillStyle = palette.bg
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
  drawSpine(ctx, palette.accent)
  drawGhost(ctx, String(page.parts[0]?.number ?? pageIndex + 1).padStart(2, '0'), palette)

  drawTopBar(
    ctx,
    '页边 · 读书笔记',
    `${String(pageIndex + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`,
    palette.muted,
  )

  const chapter = page.chapterTitle ?? plan.title
  const header = fitText(ctx, chapter, CONTENT_WIDTH - 60, 52, 34, 23, 1.22, SANS, '800')
  ctx.fillStyle = palette.accent
  ctx.fillRect(LEFT, 158, 8, 38)
  ctx.fillStyle = palette.ink
  ctx.font = header.font
  ctx.fillText(header.lines[0] ?? '', LEFT + 26, 156)
  ctx.fillStyle = palette.muted
  ctx.font = `600 18px ${SANS}`
  ctx.fillText(`《${plan.bookTitle}》`, LEFT + 26, 206)

  ctx.fillStyle = palette.line
  ctx.fillRect(LEFT, 252, CONTENT_WIDTH, 1)

  if (page.parts.length === 1) drawFeature(ctx, page, palette)
  else drawStack(ctx, page, palette)

  drawDots(ctx, palette, pageIndex, total)
  drawFooter(ctx, palette, plan.brand)
}

/** 结尾金句更看重“人话”和反差，而不是信息量。 */
function closingScore(card: XhsCarouselCard): number {
  let score = 0
  if (/不是|而是|真正|关键|本质|意味着|与其|不如/.test(card.heading)) score += 6
  if (/[？?]$/.test(card.heading)) score += 3
  if (card.heading.length >= 10 && card.heading.length <= 30) score += 2
  if (/\d/.test(card.heading)) score -= 2
  return score
}

function drawClosing(ctx: CanvasRenderingContext2D, plan: XhsCarouselPlan, palette: XhsPalette, total: number): void {
  const ground = palette.dark ? '#171210' : palette.accent
  const ink = '#fff8ef'
  ctx.fillStyle = ground
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
  drawSpine(ctx, palette.highlight)

  ctx.save()
  ctx.globalAlpha = palette.dark ? 0.08 : 0.12
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(120, PAGE_HEIGHT - 220, 330, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  drawTopBar(ctx, '页边 · 读书笔记', `LAST / ${String(total).padStart(2, '0')}`, 'rgba(255, 248, 239, 0.78)')
  ctx.globalAlpha = 0.82
  drawTracked(ctx, t('LAST PAGE / 先收藏'), LEFT, 190, `700 22px ${SANS}`, ink, 2.2)
  ctx.globalAlpha = 1

  const title = fitText(ctx, t('先收藏，再慢慢读。'), CONTENT_WIDTH, 240, 82, 54, 1.16, SANS, '800')
  ctx.fillStyle = ink
  ctx.font = title.font
  title.lines.forEach((line, index) => ctx.fillText(line, LEFT, 240 + index * title.lineHeight))
  const titleBottom = 240 + title.lines.length * title.lineHeight

  ctx.fillStyle = palette.highlight
  ctx.fillRect(LEFT, titleBottom + 26, 170, 10)

  const takeaway =
    plan.cards
      .filter(
        (card) =>
          card.heading.length >= 8 &&
          card.heading.length <= 40 &&
          !/[A-Za-z]{2,}/.test(card.heading),
      )
      .sort((left, right) => closingScore(right) - closingScore(left))[0] ?? plan.cards[plan.cards.length - 1]
  let ctaTop = 858
  if (takeaway) {
    const quoteText = takeaway.heading.replace(/[。.]$/, '')
    const quote = fitText(ctx, quoteText, CONTENT_WIDTH - 72, 176, 42, 28, 1.42, SANS, '700')
    const cardHeight = 150 + quote.lines.length * quote.lineHeight
    fillRoundRect(ctx, LEFT, 520, CONTENT_WIDTH, cardHeight, 28, 'rgba(255, 248, 239, 0.14)')
    strokeRoundRect(ctx, LEFT, 520, CONTENT_WIDTH, cardHeight, 28, 'rgba(255, 248, 239, 0.22)')
    ctx.globalAlpha = 0.76
    drawTracked(ctx, t('最想留给你的一句'), LEFT + 36, 548, `700 19px ${SANS}`, ink, 2)
    ctx.globalAlpha = 1
    ctx.fillStyle = ink
    ctx.font = quote.font
    quote.lines.forEach((line, index) => ctx.fillText(line, LEFT + 36, 586 + index * quote.lineHeight))
    ctaTop = 520 + cardHeight + 56
  }

  ctx.fillStyle = ink
  ctx.font = `700 30px ${SANS}`
  ctx.fillText(t('哪一句最戳你？评论区聊聊。'), LEFT, ctaTop)
  ctx.globalAlpha = 0.72
  ctx.font = `500 20px ${SANS}`
  ctx.fillText(
    plan.scope === 'chapter'
      ? `${plan.bookTitle}${takeaway?.chapterTitle ? ` · ${takeaway.chapterTitle}` : ''}`
      : `${plan.bookTitle} · ${plan.author || t('未署名')}`,
    LEFT,
    ctaTop + 50,
  )
  ctx.globalAlpha = 1

  drawDots(ctx, palette, total - 1, total, true)
  drawFooter(ctx, palette, plan.brand, true)
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
  if (!ctx) throw new Error(t('无法创建画布。'))
  ctx.textBaseline = 'top'
  const palette = paletteFor(theme)
  const page = plan.pages[pageIndex]
  if (!page) throw new Error(t('页面不存在。'))
  if (page.kind === 'cover') drawCover(ctx, plan, palette, plan.pages.length)
  else if (page.kind === 'closing') drawClosing(ctx, plan, palette, plan.pages.length)
  else drawContent(ctx, plan, page, pageIndex, plan.pages.length, palette)
}

export function xhsPageFilename(plan: XhsCarouselPlan, pageIndex: number): string {
  const page = plan.pages[pageIndex]
  const number = String(pageIndex + 1).padStart(2, '0')
  const title = (page?.kind === 'cover' ? t('封面') : page?.kind === 'closing' ? t('结尾') : page?.chapterTitle ?? t('知识点'))
    .replace(/[\\/:*?"<>|#%{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16)
  return `${t('页边-')}${number}-${title || t('小红书')}.png`
}
