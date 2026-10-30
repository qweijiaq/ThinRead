import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import * as cheerio from 'cheerio'

import type { NewChapter } from '../db.js'
import { htmlToText, sanitizeChapterHtml } from '../html.js'

interface MobiTocItemLike {
  label: string
  href: string
  children?: MobiTocItemLike[]
}

interface MobiBookLike {
  getMetadata(): { title?: string; author?: string[] }
  getSpine(): Array<{ id: string }>
  loadChapter(id: string): { html: string } | undefined
  getToc?(): MobiTocItemLike[]
  resolveHref?(href: string): { id: string; selector: string } | undefined
  destroy(): void
}

type MobiInitializer = (data: Uint8Array, resourceSaveDir: string) => Promise<MobiBookLike>

interface Attempt {
  format: 'mobi' | 'azw3'
  init: MobiInitializer
}

function patchKf8Loader(book: MobiBookLike): void {
  const target = book as unknown as {
    replace?: (html: string) => { html: string; css: unknown[] }
  }
  const original = target.replace
  if (typeof original !== 'function') return
  target.replace = function (html: string) {
    try {
      return original.call(this, html)
    } catch {
      const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html
      return { html: body, css: [] }
    }
  }
}

function chapterTitle(html: string, text: string, fallback: string): string {
  const $ = cheerio.load(html)
  const heading = $('h1, h2, h3').first().text().replace(/\s+/g, ' ').trim()
  if (heading && heading.length <= 80) return heading
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length >= 2 && line.length <= 60)
  return firstLine || fallback
}

async function parseWith(
  buffer: Buffer,
  attempt: Attempt,
  fallbackTitle: string,
): Promise<{ title: string; author: string; chapters: NewChapter[] } | null> {
  const resourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reading-notes-mobi-'))
  let book: MobiBookLike | undefined
  try {
    book = await attempt.init(new Uint8Array(buffer), resourceDir)
    if (attempt.format === 'azw3') patchKf8Loader(book)
    const tocTitles = new Map<string, string>()
    const visitToc = (items: MobiTocItemLike[] | undefined): void => {
      for (const item of items ?? []) {
        try {
          const resolved = book?.resolveHref?.(item.href)
          if (resolved?.id && !tocTitles.has(resolved.id)) tocTitles.set(resolved.id, item.label)
        } catch {
          // 坏掉的目录项不应该影响正文。
        }
        visitToc(item.children)
      }
    }
    visitToc(book.getToc?.())

    const chapters: NewChapter[] = []
    const spine = book.getSpine()
    for (const entry of spine) {
      let loaded: { html: string } | undefined
      try {
        loaded = book.loadChapter(entry.id)
      } catch {
        continue
      }
      if (!loaded?.html) continue
      const $chapter = cheerio.load(loaded.html)
      // MOBI 图片是单独的 Kindle 资源记录，直接保留会变成坏图。
      $chapter('img').remove()
      const html = sanitizeChapterHtml($chapter('body').html() ?? $chapter.html())
      const text = htmlToText(html)
      if (text.replace(/\s/g, '').length < 20) continue
      chapters.push({
        title: chapterTitle(loaded.html, text, tocTitles.get(entry.id) ?? `第 ${chapters.length + 1} 节`),
        text,
        html,
      })
    }
    if (chapters.length === 0) return null
    const metadata = book.getMetadata()
    return {
      title: metadata.title?.trim() || fallbackTitle,
      author: (metadata.author ?? []).map((author) => author.trim()).filter(Boolean).join(', '),
      chapters,
    }
  } finally {
    book?.destroy()
    await fs.rm(resourceDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function parseMobi(
  buffer: Buffer,
  sourceName: string,
): Promise<{ title: string; author: string; chapters: NewChapter[] }> {
  const { initMobiFile, initKf8File } = await import('@lingo-reader/mobi-parser')
  const extension = path.extname(sourceName).toLowerCase()
  const mobile: Attempt = { format: 'mobi', init: initMobiFile as MobiInitializer }
  const kf8: Attempt = { format: 'azw3', init: initKf8File as MobiInitializer }
  const attempts = extension === '.azw3' ? [kf8, mobile] : [mobile, kf8]
  const fallbackTitle = path.basename(sourceName, extension) || '未命名'
  let best: { title: string; author: string; chapters: NewChapter[] } | null = null
  let bestChars = 0
  for (const attempt of attempts) {
    try {
      const result = await parseWith(buffer, attempt, fallbackTitle)
      const chars = result?.chapters.reduce((sum, chapter) => sum + chapter.text.length, 0) ?? 0
      if (result && chars > bestChars) {
        best = result
        bestChars = chars
      }
      // 正常书不会只有几十个字；文本足够多时不再尝试另一种容器。
      if (bestChars >= 1000) break
    } catch {
      // .mobi 容器可能实际是 KF8，换另一种解析器再试。
    }
  }
  if (!best) {
    throw new Error('这本 MOBI 无法读取，可能是 DRM 保护、损坏或暂不支持的版本。')
  }
  return best
}
