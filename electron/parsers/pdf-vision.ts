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
  maxPages?: number
}

export interface VisionPdfResult {
  title: string
  author: string
  chapters: NewChapter[]
  pageCount: number
  failedPages: number
}

const MAX_VISION_PAGES = 120
const CONCURRENCY = 2

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
    const limit = Math.min(doc.numPages, options.maxPages ?? MAX_VISION_PAGES)
    const imageDir = await fs.mkdtempSync(path.join(os.tmpdir(), 'thinread-vision-pdf-'))
    try {
      const pageNumbers = Array.from({ length: limit }, (_, index) => index + 1)
      const rendered = await renderPdfPages(options.sourcePath, imageDir, pageNumbers)
      if (rendered.length === 0) {
        throw new Error('PDF 页面渲染失败，请确认文件可正常打开，或改用普通 PDF 解析。')
      }
      const images = await readRenderedImages(imageDir, rendered)
      const model = createLanguageModel(options.config)
      let done = 0
      let failed = 0
      const pages = await runPool(pageNumbers.length, CONCURRENCY, async (index) => {
        const page = pageNumbers[index]!
        const image = images.get(page)
        let text = ''
        if (image) {
          try {
            const response = await tracedGenerateText(
              {
                step: 'pdf-vision',
                provider: options.config.provider,
                model: options.config.model,
                promptVersion: 'pdf-vision-v1',
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
                          '只输出 Markdown 正文，不要解释。',
                        ].join('\n'),
                      },
                      { type: 'image', image: image.replace(/^data:[^;]+;base64,/, ''), mediaType: 'image/jpeg' },
                    ],
                  },
                ],
                temperature: 0.1,
                maxOutputTokens: 4_000,
                maxRetries: 1,
              },
            )
            text = cleanMarkdown(response.text)
          } catch {
            text = ''
          }
        }
        if (!text) {
          failed += 1
          text = await pageFallbackText(doc, page)
        }
        done += 1
        options.onProgress?.(done, pageNumbers.length)
        return { page, text } satisfies PdfPageText
      })

      if (failed === pages.length) {
        throw new Error('视觉解析没有返回可用内容。请换一个支持图片的模型，或改用普通 PDF 解析。')
      }

      const metadata = await doc.getMetadata().catch(() => null)
      const title = metadata?.info?.Title?.trim() || path.basename(options.sourcePath, path.extname(options.sourcePath))
      const author = metadata?.info?.Author?.trim() ?? ''
      const outline = await readOutlineStarts(doc, limit)
      let chapters = buildOutlineChapters(joinPages(pages), outline, limit)
      if (chapters.length < 2) chapters = buildOutlineChapters(joinPages(pages), detectPdfChapterStarts(pages), limit)
      if (chapters.length < 2) chapters = buildPagedChapters(joinPages(pages), 10)
      if (chapters.length === 0) throw new Error('视觉解析没有生成可用的章节。')
      if (doc.numPages > limit) {
        chapters.push({
          title: `未解析的页面（第 ${limit + 1}–${doc.numPages} 页）`,
          text: `这本 PDF 共 ${doc.numPages} 页，本次视觉解析了前 ${limit} 页。可以在导入后重新解析，或先拆分 PDF。`,
          html: null,
        })
      }
      return { title, author, chapters, pageCount: doc.numPages, failedPages: failed }
    } finally {
      await fsp.rm(imageDir, { recursive: true, force: true }).catch(() => undefined)
    }
  } finally {
    await doc.destroy().catch(() => undefined)
  }
}
