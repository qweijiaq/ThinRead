import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

import type { OcrProgress } from '../../shared/types.js'
import type { NewChapter } from '../db.js'

const MAX_OCR_PAGES = 300
const PAGES_PER_CHAPTER = 10
const MIN_CHAPTER_CHARS = 200
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000

const OCR_AD_TERMS = [
  '培训班',
  '网校',
  '招生',
  '报名',
  '学费',
  '课程',
  '优惠',
  '促销',
  '扫码',
  '二维码',
  '公众号',
  '加微信',
  '微信号',
  'QQ群',
  '咨询电话',
  '代理加盟',
  '点击链接',
  '灵语',
  'YY语音',
  '英语培训',
  '外教',
  '学员',
]

function isOcrNoisePage(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  if (/图书在版编目|ISBN\s*97[89]|版权所有|出版发行/.test(compact)) return true
  const hits = OCR_AD_TERMS.filter((term) => compact.includes(term)).length
  if (hits >= 3) return true
  return /(培训班|网校|招生|报名)/.test(compact) && /(微信|QQ|扫码|学费|课程|电话)/.test(compact)
}

export interface ScannedPdfResult {
  title: string
  author: string
  chapters: NewChapter[]
  sourceText: string
}

function findOcrScript(): string {
  const candidates = [
    path.join(process.cwd(), 'scripts', 'pdf-ocr.swift'),
    path.join(__dirname, '..', 'scripts', 'pdf-ocr.swift'),
    path.join(__dirname, '..', '..', 'scripts', 'pdf-ocr.swift'),
  ]
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) throw new Error('找不到扫描版 PDF 的 OCR 脚本。')
  return found
}

/** 逐页渲染 PDF 并用 macOS Vision OCR；脚本每完成一页输出一行 JSON。 */
export async function parseScannedPdf(
  sourcePath: string,
  onProgress?: (progress: OcrProgress) => void,
  signal?: AbortSignal,
): Promise<ScannedPdfResult> {
  if (process.platform !== 'darwin') throw new Error('扫描版 PDF 的 OCR 目前只支持 macOS。')
  if (signal?.aborted) throw new Error('OCR 已取消')
  const script = findOcrScript()
  const pages: Array<{ page: number; text: string }> = []
  let pageCount = 0
  let title = ''
  let author = ''
  const child = spawn('swift', [script, sourcePath, String(MAX_OCR_PAGES)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  let aborted = false
  const onAbort = (): void => {
    aborted = true
    child.kill('SIGKILL')
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => child.kill('SIGKILL'), REQUEST_TIMEOUT_MS)
  const stdout = readline.createInterface({ input: child.stdout })

  try {
    await new Promise<void>((resolve, reject) => {
      stdout.on('line', (line) => {
        if (!line.trim()) return
        try {
          const parsed = JSON.parse(line) as {
            meta?: { pages?: unknown; title?: unknown; author?: unknown }
            page?: unknown
            text?: unknown
          }
          if (parsed.meta) {
            pageCount = typeof parsed.meta.pages === 'number' ? parsed.meta.pages : 0
            title = typeof parsed.meta.title === 'string' ? parsed.meta.title : ''
            author = typeof parsed.meta.author === 'string' ? parsed.meta.author : ''
            if (pageCount > MAX_OCR_PAGES) {
              reject(new Error(`扫描版 PDF 有 ${pageCount} 页，超过 ${MAX_OCR_PAGES} 页上限，请先拆分后再导入。`))
            }
            return
          }
          if (typeof parsed.page !== 'number' || typeof parsed.text !== 'string') return
          pages.push({ page: parsed.page, text: parsed.text })
          onProgress?.({ current: pages.length, total: pageCount, page: parsed.page })
        } catch {
          // 忽略 Swift 的调试输出，只解析逐页 JSON。
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (aborted) reject(new Error('OCR 已取消'))
        else if (code === 0) resolve()
        else reject(new Error(`OCR 进程退出（${code}）：${stderr.trim().slice(0, 200) || '未知错误'}`))
      })
    })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    stdout.close()
  }

  if (pages.length === 0) throw new Error('没有从扫描版 PDF 中识别出页面。')
  pages.sort((a, b) => a.page - b.page)
  const usable = pages.filter((page) => !isOcrNoisePage(page.text))
  if (usable.length === 0) throw new Error('扫描版 PDF 没有识别出可阅读的正文，请换一份清晰度更高的文件。')
  const sourceText = usable.map((page) => `[第 ${page.page} 页]\n${page.text}`).join('\n\n').trim()
  const chapters: NewChapter[] = []
  // 按连续页码分段，避免广告/版权页被剔除后把不相邻的正文拼成一章。
  const runs: Array<Array<{ page: number; text: string }>> = []
  for (const page of usable) {
    const run = runs[runs.length - 1]
    if (run && page.page === run[run.length - 1]!.page + 1) run.push(page)
    else runs.push([page])
  }
  for (const run of runs) {
    for (let start = 0; start < run.length; start += PAGES_PER_CHAPTER) {
      const chunk = run.slice(start, start + PAGES_PER_CHAPTER)
      const title = chunk.length === 1 ? `第 ${chunk[0]!.page} 页` : `第 ${chunk[0]!.page}–${chunk[chunk.length - 1]!.page} 页`
      const text = chunk.map((page) => `[第 ${page.page} 页]\n${page.text}`).join('\n\n').trim()
      if (text.replace(/\s/g, '').length < MIN_CHAPTER_CHARS) continue
      chapters.push({ title, text, html: null })
    }
  }
  if (chapters.length === 0) throw new Error('扫描版 PDF 没有识别出可阅读的正文，请换一份清晰度更高的文件。')
  return {
    title: title.trim() || path.basename(sourcePath, path.extname(sourcePath)),
    author,
    chapters,
    sourceText,
  }
}
