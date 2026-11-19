import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { NewChapter } from '../db.js'
import { createLanguageModel } from '../ai/provider.js'
import type { ModelConfig } from '../ai/provider.js'
import { supportsVision } from '../ai/note-images.js'
import { tracedGenerateText } from '../ai/trace.js'
import {
  buildOutlineChapters,
  buildPagedChapters,
  detectPdfChapterStarts,
  type PdfPageText,
} from './pdf-chapters.js'
import { readOutlineStarts, renderPdfPages, readRenderedImages, type PdfDocument } from './pdf.js'

type PdfJs = {
  getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocument> }
}

export interface VisionPdfOptions {
  buffer: Buffer
  sourcePath: string
  config: ModelConfig
  onProgress?: (done: number, total: number) => void
  maintainFormat?: boolean
  pages?: string
  dataDir?: string
  signal?: AbortSignal
  extractStructure?: boolean
}

export interface VisionPdfResult {
  title: string
  author: string
  chapters: NewChapter[]
  pageCount: number
  failedPages: number
  structured: StructuredBlock[]
}

/** 单批页数。渲染与请求仍按批进行，但一次导入会循环处理整本。 */
export const VISION_BATCH_SIZE = 120
const CONCURRENCY = 2

export function parsePageSelection(spec: string | undefined, total: number): number[] {
  const raw = (spec ?? '').trim()
  if (!raw || /^全部$|^all$/i.test(raw)) {
    return Array.from({ length: Math.max(0, total) }, (_, index) => index + 1)
  }
  const pages = new Set<number>()
  for (const part of raw.split(/[,，\s]+/).filter(Boolean)) {
    const range = /^(\d+)\s*[-–~]\s*(\d+)$/.exec(part)
    if (range) {
      const start = Math.max(1, Number(range[1]))
      const end = Math.min(total, Number(range[2]))
      if (start > end) throw new Error(`页码范围无效：${part}`)
      for (let page = start; page <= end; page += 1) pages.add(page)
      continue
    }
    const page = Number(part)
    if (!Number.isInteger(page) || page < 1 || page > total) {
      throw new Error(`页码无效：${part}（这本 PDF 共 ${total} 页）`)
    }
    pages.add(page)
  }
  const selected = [...pages].sort((a, b) => a - b)
  if (selected.length === 0) throw new Error('没有选择要解析的页码。')
  return selected
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^\s*(?:以下是|这是|页面内容|Here is)[^\n]*\n/i, '')
    .trim()
}

function joinPages(pages: PdfPageText[]): PdfPageText[] {
  return pages.map((page) => ({ page: page.page, text: page.text.trim() }))
}

async function runPool<T>(count: number, concurrency: number, worker: (index: number) => Promise<T>): Promise<T[]> {
  const results = new Array<T>(count)
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, count) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= count) return
      results[index] = await worker(index)
    }
  })
  await Promise.all(runners)
  return results
}

async function pageFallbackText(doc: PdfDocument, pageNumber: number): Promise<string> {
  try {
    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    let text = ''
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue
      text += item.str
      if (item.hasEOL) text += '\n'
    }
    return text.trim()
  } catch {
    return ''
  }
}

/**
 * Zerox 式 PDF 解析：整页渲染成图片，让视觉模型输出 Markdown。
 * 适合扫描版、教材、图表/表格多的 PDF；不依赖文字层。
 */
export interface StructuredBlock {
  page: number
  kind: 'table' | 'formula'
  text: string
}

function extractStructuredBlocks(pages: PdfPageText[]): StructuredBlock[] {
  const blocks: StructuredBlock[] = []
  for (const page of pages) {
    const lines = page.text.split('\n')
    let table: string[] = []
    const flushTable = (): void => {
      if (table.length >= 2 && table.some((line) => /^\s*\|?\s*:?-{3,}/.test(line))) {
        blocks.push({ page: page.page, kind: 'table', text: table.join('\n') })
      }
      table = []
    }
    for (const line of lines) {
      if (/^\s*\|.*\|\s*$/.test(line)) table.push(line.trim())
      else flushTable()
    }
    flushTable()
    for (const match of page.text.matchAll(/\$\$([\s\S]+?)\$\$/g)) {
      const formula = match[1]?.trim()
      if (formula) blocks.push({ page: page.page, kind: 'formula', text: `$$${formula}$$` })
    }
    for (const match of page.text.matchAll(/```(?:latex|math)\s*\n([\s\S]+?)```/gi)) {
      const formula = match[1]?.trim()
      if (formula) blocks.push({ page: page.page, kind: 'formula', text: `$$${formula}$$` })
    }
  }
  return blocks.slice(0, 400)
}

function structuredChapter(blocks: StructuredBlock[]): NewChapter | null {
  if (blocks.length === 0) return null
  const tables = blocks.filter((block) => block.kind === 'table')
  const formulas = blocks.filter((block) => block.kind === 'formula')
  const parts: string[] = []
  if (tables.length > 0) {
    parts.push('## 表格', ...tables.map((block) => `第 ${block.page} 页\n\n${block.text}`))
  }
  if (formulas.length > 0) {
    parts.push('## 公式', ...formulas.map((block) => `第 ${block.page} 页\n\n${block.text}`))
  }
  return { title: '表格与公式索引', text: parts.join('\n\n'), html: null }
}

export async function parsePdfWithVision(options: VisionPdfOptions): Promise<VisionPdfResult> {
  if (!supportsVision(options.config)) {
    throw new Error('当前模型不支持视觉。请先在设置里选择一个支持图片的模型，再使用 PDF 视觉解析。')
  }
  if (!options.config.apiKey && options.config.provider !== 'ollama' && options.config.provider !== 'lmstudio') {
    throw new Error('还没有配置 API Key，无法使用 PDF 视觉解析。')
  }
  if (process.platform !== 'darwin') {
    throw new Error('PDF 视觉解析目前需要 macOS 的页面渲染能力；Windows / Linux 会先回退到普通 PDF 解析。')
  }

  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(options.buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  }).promise

  try {
    const pageNumbers = parsePageSelection(options.pages, doc.numPages)
    const imageDir = await fs.mkdtempSync(path.join(os.tmpdir(), 'thinread-vision-pdf-'))
    try {
      const model = createLanguageModel(options.config)
      const cacheDir = options.dataDir ? path.join(options.dataDir, 'vision-pdf-cache') : ''
      if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true })
      let done = 0
      let failed = 0
      let renderMissed = 0
      let renderedAny = false

      const loadBatchImages = async (batch: number[]): Promise<Map<number, string>> => {
        const rendered = await renderPdfPages(options.sourcePath, imageDir, batch)
        if (rendered.length === 0) {
          renderMissed += batch.length
          return new Map()
        }
        renderedAny = true
        renderMissed += Math.max(0, batch.length - rendered.length)
        return readRenderedImages(imageDir, rendered)
      }

      const ocrPage = async (page: number, image: string | undefined, previous: string): Promise<PdfPageText> => {
        options.signal?.throwIfAborted()
        let text = ''
        if (image) {
          const cacheKey = createHash('sha256')
            .update(`${options.config.model}\n${options.maintainFormat ? previous.slice(-1_500) : ''}\n${image}`)
            .digest('hex')
          const cachePath = cacheDir ? path.join(cacheDir, `${cacheKey}.md`) : ''
          if (cachePath) {
            try {
              const cached = fs.readFileSync(cachePath, 'utf8').trim()
              if (cached) text = cached
            } catch {
              // 没有缓存就走模型。
            }
          }
          if (!text) {
            try {
              const response = await tracedGenerateText(
                {
                  step: 'pdf-vision',
                  provider: options.config.provider,
                  model: options.config.model,
                  promptVersion: options.maintainFormat ? 'pdf-vision-format-v1' : 'pdf-vision-v1',
                  timeoutMs: 180_000,
                },
                {
                  model,
                  system:
                    '你是 PDF 页面转 Markdown 的助手。只转录页面内容，不总结、不翻译、不评论，不编造页面上没有的信息。',
                  messages: [
                    {
                      role: 'user',
                      content: [
                        {
                          type: 'text',
                          text: [
                            `这是 PDF 的第 ${page} 页。请完整转成 Markdown。`,
                            '保留标题层级、列表、表格、代码块和图表说明；页眉页脚可以省略。',
                            '表格用 Markdown 表格；代码用代码块；无法辨认的内容写 [无法辨认]。',
                            options.maintainFormat && previous
                              ? '上一页末尾内容如下，仅用于延续跨页表格、列表或代码块，不要重复输出：\n' +
                                previous.slice(-1_500)
                              : '',
                            '只输出 Markdown 正文，不要解释。',
                          ]
                            .filter(Boolean)
                            .join('\n'),
                        },
                        { type: 'image', image: image.replace(/^data:[^;]+;base64,/, ''), mediaType: 'image/jpeg' },
                      ],
                    },
                  ],
                  temperature: 0.1,
                  maxOutputTokens: 4_000,
                  maxRetries: 1,
                  abortSignal: options.signal,
                },
              )
              text = cleanMarkdown(response.text)
              if (cachePath && text) fs.writeFileSync(cachePath, text)
            } catch {
              text = ''
            }
          }
        }
        if (!text) {
          if (image) failed += 1
          text = await pageFallbackText(doc, page)
        }
        return { page, text }
      }

      const pages: PdfPageText[] = []
      if (options.maintainFormat) {
        // 串行模式需要上一页正文；分批只影响渲染，跨批仍能延续表格和代码块。
        let previous = ''
        for (let start = 0; start < pageNumbers.length; start += VISION_BATCH_SIZE) {
          const batch = pageNumbers.slice(start, start + VISION_BATCH_SIZE)
          const images = await loadBatchImages(batch)
          for (const page of batch) {
            const result = await ocrPage(page, images.get(page), previous)
            pages.push(result)
            previous = result.text
            done += 1
            options.onProgress?.(done, pageNumbers.length)
          }
        }
      } else {
        for (let start = 0; start < pageNumbers.length; start += VISION_BATCH_SIZE) {
          const batch = pageNumbers.slice(start, start + VISION_BATCH_SIZE)
          const images = await loadBatchImages(batch)
          const results = await runPool(batch.length, CONCURRENCY, async (index) => {
            const page = batch[index]!
            const result = await ocrPage(page, images.get(page), '')
            done += 1
            options.onProgress?.(Math.min(done, pageNumbers.length), pageNumbers.length)
            return result
          })
          pages.push(...results)
        }
      }

      if (!renderedAny) {
        throw new Error('PDF 页面渲染失败，请确认文件可正常打开，或改用普通 PDF 解析。')
      }
      if (pages.length === 0) {
        throw new Error('没有可解析的页面。')
      }
      if (failed === pages.length) {
        throw new Error('视觉解析没有返回可用内容。请换一个支持图片的模型，或改用普通 PDF 解析。')
      }

      const metadata = await doc.getMetadata().catch(() => null)
      const title = metadata?.info?.Title?.trim() || path.basename(options.sourcePath, path.extname(options.sourcePath))
      const author = metadata?.info?.Author?.trim() ?? ''
      const outline = await readOutlineStarts(doc, doc.numPages)
      let chapters = buildOutlineChapters(joinPages(pages), outline, doc.numPages)
      if (chapters.length < 2) {
        chapters = buildOutlineChapters(joinPages(pages), detectPdfChapterStarts(pages), doc.numPages)
      }
      if (chapters.length < 2) chapters = buildPagedChapters(joinPages(pages), 10)
      if (chapters.length === 0) throw new Error('视觉解析没有生成可用的章节。')
      if (pageNumbers.length < doc.numPages) {
        chapters.push({
          title: '未解析的页面',
          text: `这本 PDF 共 ${doc.numPages} 页，本次视觉解析了 ${pageNumbers.length} 页（${pageNumbers[0]}–${pageNumbers[pageNumbers.length - 1]}）。需要其余页面时，请按页码区间再次导入同一份 PDF，再在书架里用「合并书籍」合成一本。`,
          html: null,
        })
      }
      const structuredBlocks = options.extractStructure !== false ? extractStructuredBlocks(pages) : []
      if (structuredBlocks.length > 0) {
        const structured = structuredChapter(structuredBlocks)
        if (structured) chapters.push(structured)
      }
      if (failed > 0 || renderMissed > 0) {
        const details = [
          failed > 0 ? `${failed} 页模型识别失败` : '',
          renderMissed > 0 ? `${renderMissed} 页未能渲染成图片` : '',
        ].filter(Boolean)
        chapters.push({
          title: '视觉解析提示',
          text: `本次有 ${details.join('、')}，已回退到 PDF 文字层；这些页面可能缺少图表或表格。`,
          html: null,
        })
      }
      return { title, author, chapters, pageCount: doc.numPages, failedPages: failed, structured: structuredBlocks }
    } finally {
      await fsp.rm(imageDir, { recursive: true, force: true }).catch(() => undefined)
    }
  } finally {
    await doc.destroy().catch(() => undefined)
  }
}
