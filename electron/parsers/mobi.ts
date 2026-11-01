import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  getCoverImage?(): string
  destroy(): void
}

type MobiInitializer = (data: Uint8Array, resourceSaveDir: string) => Promise<MobiBookLike>

interface Attempt {
  format: 'mobi' | 'azw3'
  init: MobiInitializer
}

interface ParsedMobi {
  title: string
  author: string
  chapters: NewChapter[]
  cover?: { data: Uint8Array; mime: string; extension: string }
}

const COVER_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}
const MAX_COVER_BYTES = 8 * 1024 * 1024
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_INLINE_IMAGE_TOTAL = 12 * 1024 * 1024
const MAX_INLINE_IMAGES = 30

async function inlineChapterImages(
  $: cheerio.CheerioAPI,
  resourceDir: string,
  budget: { used: number },
): Promise<void> {
  const images = $('img').toArray().slice(0, MAX_INLINE_IMAGES)
  for (const element of images) {
    const node = $(element)
    const source = node.attr('src')?.trim() ?? ''
    if (!source) {
      node.remove()
      continue
    }
    if (source.startsWith('data:')) continue
    if (/^[a-z]+:/i.test(source) && !source.startsWith('file://')) {
      node.remove()
      continue
    }
    let filePath: string
    try {
      filePath = source.startsWith('file://') ? fileURLToPath(source) : path.resolve(resourceDir, source)
    } catch {
      node.remove()
      continue
    }
    const resolvedDir = path.resolve(resourceDir)
    if (filePath !== resolvedDir && !filePath.startsWith(`${resolvedDir}${path.sep}`)) {
      node.remove()
      continue
    }
    const extension = path.extname(filePath).toLowerCase()
    const mime = COVER_MIME[extension]
    if (!mime || extension === '.svg') {
      node.remove()
      continue
    }
    try {
      const data = await fs.readFile(filePath)
      if (data.length === 0 || data.length > MAX_INLINE_IMAGE_BYTES || budget.used + data.length > MAX_INLINE_IMAGE_TOTAL) {
        node.remove()
        continue
      }
      budget.used += data.length
      node.attr('src', `data:${mime};base64,${data.toString('base64')}`)
    } catch {
      node.remove()
    }
  }
  $('img').slice(MAX_INLINE_IMAGES).remove()
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
): Promise<ParsedMobi | null> {
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
    const imageBudget = { used: 0 }
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
      // MOBI 图片是单独的 Kindle 资源记录；解析器已把它们写到临时目录，这里转成 data URL。
      await inlineChapterImages($chapter, resourceDir, imageBudget)
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
    let cover: { data: Uint8Array; mime: string; extension: string } | undefined
    try {
      const coverPath = book.getCoverImage?.()
      if (coverPath) {
        const extension = path.extname(coverPath).toLowerCase()
        const mime = COVER_MIME[extension]
        const data = await fs.readFile(coverPath)
        if (mime && data.length > 0 && data.length <= MAX_COVER_BYTES) {
          cover = { data: new Uint8Array(data), mime, extension }
        }
      }
    } catch {
      // 封面缺失不应该影响正文导入。
    }
    return {
      title: metadata.title?.trim() || fallbackTitle,
      author: (metadata.author ?? []).map((author) => author.trim()).filter(Boolean).join(', '),
      chapters,
      cover,
    }
  } finally {
    book?.destroy()
    await fs.rm(resourceDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function parseMobi(
  buffer: Buffer,
  sourceName: string,
): Promise<ParsedMobi> {
  const { initMobiFile, initKf8File } = await import('@lingo-reader/mobi-parser')
  const extension = path.extname(sourceName).toLowerCase()
  const mobile: Attempt = { format: 'mobi', init: initMobiFile as MobiInitializer }
  const kf8: Attempt = { format: 'azw3', init: initKf8File as MobiInitializer }
  const attempts = extension === '.azw3' ? [kf8, mobile] : [mobile, kf8]
  const fallbackTitle = path.basename(sourceName, extension) || '未命名'
  let best: ParsedMobi | null = null
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
