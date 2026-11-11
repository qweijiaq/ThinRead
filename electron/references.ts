import * as cheerio from 'cheerio'

import { htmlToText } from './html.js'
import { cleanHeading, isHeading, isReferenceHeading } from './parsers/text-book.js'

export interface ReferenceStripResult {
  removed: Array<{ text: string; reason: string }>
}

export interface HtmlReferenceStripResult extends ReferenceStripResult {
  html: string
}

export interface TextReferenceStripResult extends ReferenceStripResult {
  text: string
}

function headingLevel(tag: string): number | null {
  const match = /^h([1-6])$/.exec(tag)
  return match ? Number(match[1]) : null
}

function tagOf(node: unknown): string {
  return String((node as { tagName?: string }).tagName ?? '').toLowerCase()
}

function textOf($: cheerio.CheerioAPI, node: unknown): string {
  return $(node as never).text().replace(/\s+/g, ' ').trim()
}

function containsHeadingAtOrAbove($: cheerio.CheerioAPI, node: unknown, level: number): boolean {
  return $(node as never)
    .find('h1, h2, h3, h4, h5, h6')
    .toArray()
    .some((heading) => {
      const headingLevelValue = headingLevel(tagOf(heading))
      return headingLevelValue !== null && headingLevelValue <= level
    })
}

function pushRemoved(
  removed: Array<{ text: string; reason: string }>,
  seen: Set<string>,
  text: string,
): void {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return
  const key = cleaned.slice(0, 400)
  if (seen.has(key)) return
  seen.add(key)
  removed.push({ text: cleaned.slice(0, 400), reason: '参考文献 / 注释 / 索引' })
}

/** 从章节 HTML 中移除参考文献区：标题及其后内容，直到下一个同级或更高级标题。 */
export function stripReferenceSectionsFromHtml(html: string): HtmlReferenceStripResult {
  const $ = cheerio.load(`<div id="__reference_root">${html}</div>`)
  const root = $('#__reference_root')
  const removed: Array<{ text: string; reason: string }> = []
  const seen = new Set<string>()
  let skippingUntil: number | null = null

  const visit = (node: unknown): void => {
    const tag = tagOf(node)
    const level = headingLevel(tag)
    if (level !== null) {
      const text = textOf($, node)
      if (skippingUntil !== null) {
        if (level > skippingUntil) {
          pushRemoved(removed, seen, text)
          $(node as never).remove()
          return
        }
        // 遇到同级或更高级标题：参考文献区结束，这个标题保留。
        skippingUntil = null
        return
      }
      if (isReferenceHeading(text)) {
        pushRemoved(removed, seen, text)
        skippingUntil = level
        $(node as never).remove()
        return
      }
      return
    }

    if (skippingUntil !== null) {
      if (containsHeadingAtOrAbove($, node, skippingUntil)) {
        for (const child of [...((node as { children?: unknown[] }).children ?? [])]) visit(child)
        // 清空后的包装节点也一并移除。
        if ($(node as never).text().trim() === '' && $(node as never).children().length === 0) {
          $(node as never).remove()
        }
        return
      }
      pushRemoved(removed, seen, textOf($, node))
      $(node as never).remove()
      return
    }

    if (containsHeadingAtOrAbove($, node, 6)) {
      for (const child of [...((node as { children?: unknown[] }).children ?? [])]) visit(child)
    }
  }

  for (const child of [...((root[0] as { children?: unknown[] } | undefined)?.children ?? [])]) visit(child)
  return { html: root.html() ?? '', removed }
}

/** 从纯文本中移除参考文献区：从标题开始，通常直接删到章末。 */
export function stripReferenceSectionsFromText(text: string): TextReferenceStripResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const kept: string[] = []
  const removed: Array<{ text: string; reason: string }> = []
  const seen = new Set<string>()
  let skipping = false
  let skipped: string[] = []

  const finishSkip = (): void => {
    if (skipped.length > 0) pushRemoved(removed, seen, skipped.join('\n'))
    skipped = []
  }

  for (const line of lines) {
    if (skipping) {
      if (isHeading(line)) {
        // 下一个标题出现：结束参考文献区，保留这个标题及后续内容。
        finishSkip()
        skipping = false
        kept.push(line)
      } else {
        skipped.push(line)
      }
      continue
    }
    if (isHeading(line) && isReferenceHeading(cleanHeading(line))) {
      skipping = true
      skipped.push(line)
      continue
    }
    kept.push(line)
  }
  finishSkip()

  return {
    text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    removed,
  }
}

/** 统一处理导入/重新解析得到的章节。 */
export function stripReferencesFromChapters<T extends { text: string; html?: string | null }>(
  chapters: T[],
): T[] {
  return chapters
    .map((chapter) => {
      if (chapter.html) {
        const stripped = stripReferenceSectionsFromHtml(chapter.html)
        return {
          ...chapter,
          html: stripped.html,
          text: htmlToText(stripped.html),
        }
      }
      return { ...chapter, text: stripReferenceSectionsFromText(chapter.text).text }
    })
    .filter((chapter) => chapter.text.trim().length >= 20 || Boolean(chapter.html?.trim()))
}
