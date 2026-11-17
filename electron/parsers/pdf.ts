import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import type { NewChapter } from '../db.js'
import {
  buildOutlineChapters,
  buildPagedChapters,
  detectPdfChapterStarts,
  type PdfChapterStart,
  type PdfPageText,
} from './pdf-chapters.js'

interface PdfTextItem {
  str?: string
  hasEOL?: boolean
}

interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>
  getOperatorList?(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>
}

interface PdfOutlineNode {
  title?: string
  dest?: unknown
  items?: PdfOutlineNode[]
}

export interface PdfDocument {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPage>
  getMetadata(): Promise<{ info?: { Title?: string; Author?: string } } | null>
  getOutline?(): Promise<PdfOutlineNode[] | null>
  getDestination?(id: string): Promise<unknown[] | null>
  getPageIndex?(ref: unknown): Promise<number>
  destroy(): Promise<void>
}

type PdfJs = {
  getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocument> }
  OPS?: {
    constructPath?: number
    paintImageXObject?: number
    paintJpegXObject?: number
    paintInlineImageXObject?: number
    paintImageMaskXObject?: number
  }
}

const PAGES_PER_CHAPTER = 10
const MAX_PDF_PAGES = 800
const MIN_FIGURE_PATHS = 30

export interface PdfParseOptions {
  /** 为含图表的页面生成 JPEG 预览；不传则不生成。 */
  imageDir?: string
}

/** 只读取页数，用于视觉解析前的费用预估。 */
export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  }).promise
  try {
    return doc.numPages
  } finally {
    await doc.destroy().catch(() => undefined)
  }
}

export async function parsePdf(
  buffer: Buffer,
  sourceName: string,
  options: PdfParseOptions = {},
): Promise<{ title: string; author: string; chapters: NewChapter[] }> {
  // 动态导入 legacy 构建：它不依赖 DOM，可以在 Electron 主进程里直接解析 PDF。
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  }).promise

  try {
    const pages: PdfPageText[] = []
    const figurePages: number[] = []
    const canRenderFigures = Boolean(options.imageDir) && process.platform === 'darwin'
    const pageCount = Math.min(doc.numPages, MAX_PDF_PAGES)
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      if (canRenderFigures && page.getOperatorList) {
        const ops = await page.getOperatorList().catch(() => null)
        if (ops && looksLikeFigurePage(ops, pdfjs.OPS)) figurePages.push(pageNumber)
      }
      let text = ''
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue
        text += item.str
        if (item.hasEOL) text += '\n'
      }
      pages.push({ page: pageNumber, text: normalizePageText(text) })
    }

    const metadata = await doc.getMetadata().catch(() => null)
    const title = metadata?.info?.Title?.trim() || path.basename(sourceName, path.extname(sourceName))
    const author = metadata?.info?.Author?.trim() ?? ''

    // 优先用 PDF 书签，其次用页面开头的章节标题，最后才按固定页数分组。
    const outline = await readOutlineStarts(doc, pageCount)
    let chapters = buildOutlineChapters(pages, outline, pageCount)
    if (chapters.length < 2) {
      chapters = buildOutlineChapters(pages, detectPdfChapterStarts(pages), pageCount)
    }
    if (chapters.length < 2) {
      chapters = buildPagedChapters(pages, PAGES_PER_CHAPTER)
    }

    if (chapters.length === 0) throw new Error('这本 PDF 没有可提取的文字层，可能是扫描版。请回到导入窗口，改用「扫描版 PDF（OCR）」。')

    if (options.imageDir && figurePages.length > 0) {
      const rendered = await renderPdfPages(sourceName, options.imageDir, figurePages)
      const images = await readRenderedImages(options.imageDir, rendered)
      if (images.size > 0) {
        chapters = chapters.map((chapter) => ({ ...chapter, html: chapterHtmlWithImages(chapter.text, images) }))
      }
    }

    return { title, author, chapters }
  } finally {
    await doc.destroy().catch(() => undefined)
  }
}

function flattenOutline(items: PdfOutlineNode[], depth = 0): Array<PdfChapterStart & { dest?: unknown }> {
  const result: Array<PdfChapterStart & { dest?: unknown }> = []
  for (const item of items) {
    if (item && typeof item === 'object' && typeof item.title === 'string' && item.title.trim()) {
      result.push({ page: 0, title: item.title, depth, ...(item.dest !== undefined ? { dest: item.dest } : {}) })
    }
    if (Array.isArray(item?.items) && item.items.length > 0) {
      result.push(...flattenOutline(item.items, depth + 1))
    }
  }
  return result
}

async function resolveDestinationPage(doc: PdfDocument, dest: unknown): Promise<number | null> {
  let target = dest
  if (typeof target === 'string') {
    if (!doc.getDestination) return null
    target = await doc.getDestination(target).catch(() => null)
  }
  if (!Array.isArray(target) || target.length === 0) return null
  const first = target[0]
  if (typeof first === 'number' && Number.isFinite(first)) return first + 1
  if (first && typeof first === 'object') {
    if (!doc.getPageIndex) return null
    const index = await doc.getPageIndex(first).catch(() => null)
    return typeof index === 'number' && Number.isFinite(index) ? index + 1 : null
  }
  return null
}

export async function readOutlineStarts(doc: PdfDocument, pageCount: number): Promise<PdfChapterStart[]> {
  if (!doc.getOutline) return []
  const outline = await doc.getOutline().catch(() => null)
  if (!Array.isArray(outline) || outline.length === 0) return []
  const flat = flattenOutline(outline)
  const resolved = await Promise.all(
    flat.map(async (item) => ({
      title: item.title,
      depth: item.depth ?? 0,
      page: await resolveDestinationPage(doc, item.dest),
    })),
  )
  const valid = resolved.filter(
    (item): item is { title: string; depth: number; page: number } =>
      typeof item.page === 'number' && item.page >= 1 && item.page <= pageCount,
  )
  if (valid.length === 0) return []

  // 顶层通常就是章节；只有顶层太少时，才下钻一层。
  const top = valid.filter((item) => item.depth === 0)
  if (top.length >= 3) return top
  const next = valid.filter((item) => item.depth === 1)
  if (next.length >= 2) return next
  return top.length >= 2 ? top : valid
}

function normalizePageText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function looksLikeFigurePage(
  ops: { fnArray: number[] },
  OPS: PdfJs['OPS'],
): boolean {
  if (!OPS) return false
  let paths = 0
  let images = 0
  const imageOps = new Set(
    [OPS.paintImageXObject, OPS.paintJpegXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].filter(
      (value): value is number => typeof value === 'number',
    ),
  )
  for (const fn of ops.fnArray) {
    if (fn === OPS.constructPath) paths++
    else if (imageOps.has(fn)) images++
  }
  return paths >= MIN_FIGURE_PATHS || images > 0
}

function findRenderScript(): string | null {
  const resources = (process as unknown as { resourcesPath?: string }).resourcesPath
  const candidates = [
    ...(resources ? [path.join(resources, 'scripts', 'pdf-render.swift')] : []),
    path.join(process.cwd(), 'scripts', 'pdf-render.swift'),
    path.join(__dirname, '..', 'scripts', 'pdf-render.swift'),
    path.join(__dirname, '..', '..', 'scripts', 'pdf-render.swift'),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

export async function renderPdfPages(sourcePath: string, imageDir: string, pages: number[]): Promise<number[]> {
  if (process.platform !== 'darwin' || pages.length === 0 || !fs.existsSync(sourcePath)) return []
  const script = findRenderScript()
  if (!script) return []
  await fsp.rm(imageDir, { recursive: true, force: true })
  await fsp.mkdir(imageDir, { recursive: true })
  const child = spawn('swift', [script, sourcePath, imageDir, pages.join(','), '1.25', '0.72'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const code = await new Promise<number>((resolve) => {
    const timer = setTimeout(() => {
      child.kill()
      resolve(-1)
    }, 120_000)
    child.on('error', () => {
      clearTimeout(timer)
      resolve(-1)
    })
    child.on('close', (value) => {
      clearTimeout(timer)
      resolve(value ?? -1)
    })
  })
  if (code !== 0) {
    if (stderr.trim()) console.warn('[pdf] 页面图片渲染失败', stderr.trim().slice(0, 300))
    return []
  }
  return pages.filter((page) => fs.existsSync(path.join(imageDir, `page-${page}.jpg`)))
}

export async function readRenderedImages(imageDir: string, pages: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  for (const page of pages) {
    try {
      const bytes = await fsp.readFile(path.join(imageDir, `page-${page}.jpg`))
      if (bytes.length > 0) result.set(page, `data:image/jpeg;base64,${bytes.toString('base64')}`)
    } catch {
      // 单页图片失败不影响文字导入。
    }
  }
  return result
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function chapterHtmlWithImages(text: string, images: Map<number, string>): string {
  const parts = text.split(/(?=\[第 \d+ 页\])/)
  const html: string[] = []
  for (const part of parts) {
    if (!part.trim()) continue
    const match = part.match(/^\[第 (\d+) 页\]\n?/)
    if (!match) {
      html.push(`<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`)
      continue
    }
    const page = Number(match[1])
    const body = part.slice(match[0].length)
    const image = images.get(page)
    html.push(
      `<section class="pdf-page-block"><div class="page-marker">第 ${page} 页</div>` +
        `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>` +
        (image
          ? `<figure class="pdf-page-figure"><img src="${image}" alt="第 ${page} 页版式" loading="lazy"></figure>`
          : '') +
        '</section>',
    )
  }
  return html.join('\n')
}

/** 读取 PDF 书签和元数据，供 Docling 深度解析复用章节边界。 */
export async function readPdfOutlineFile(sourcePath: string): Promise<{
  title: string
  author: string
  pageCount: number
  outline: PdfChapterStart[]
}> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs
  const buffer = await fsp.readFile(sourcePath)
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  }).promise
  try {
    const pageCount = Math.min(doc.numPages, MAX_PDF_PAGES)
    const metadata = await doc.getMetadata().catch(() => null)
    const title = metadata?.info?.Title?.trim() || path.basename(sourcePath, path.extname(sourcePath))
    const author = metadata?.info?.Author?.trim() ?? ''
    return { title, author, pageCount, outline: await readOutlineStarts(doc, pageCount) }
  } finally {
    await doc.destroy().catch(() => undefined)
  }
}
