import path from 'node:path'

import type { NewChapter } from '../db.js'

interface PdfTextItem {
  str?: string
  hasEOL?: boolean
}

interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>
}

interface PdfDocument {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPage>
  getMetadata(): Promise<{ info?: { Title?: string; Author?: string } } | null>
  destroy(): Promise<void>
}

type PdfJs = {
  getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocument> }
}

const PAGES_PER_CHAPTER = 10
const MAX_PDF_PAGES = 800

export async function parsePdf(buffer: Buffer, sourceName: string): Promise<{ title: string; author: string; chapters: NewChapter[] }> {
  // 动态导入 legacy 构建：它不依赖 DOM，可以在 Electron 主进程里直接解析 PDF。
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  }).promise

  try {
    const pages: string[] = []
    const pageCount = Math.min(doc.numPages, MAX_PDF_PAGES)
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue
        text += item.str
        if (item.hasEOL) text += '\n'
      }
      pages.push(`[第 ${pageNumber} 页]\n${normalizePageText(text)}`)
    }

    const chapters: NewChapter[] = []
    for (let start = 0; start < pages.length; start += PAGES_PER_CHAPTER) {
      const end = Math.min(pages.length, start + PAGES_PER_CHAPTER)
      const title = start + 1 === end ? `第 ${start + 1} 页` : `第 ${start + 1}–${end} 页`
      const text = pages.slice(start, end).join('\n\n').trim()
      if (text.replace(/\s/g, '').length < 20) continue
      chapters.push({ title, text, html: null })
    }

    const metadata = await doc.getMetadata().catch(() => null)
    const title = metadata?.info?.Title?.trim() || path.basename(sourceName, path.extname(sourceName))
    const author = metadata?.info?.Author?.trim() ?? ''
    if (chapters.length === 0) throw new Error('这本 PDF 没有可提取的文字层，可能是扫描版。')
    return { title, author, chapters }
  } finally {
    await doc.destroy().catch(() => undefined)
  }
}

function normalizePageText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
