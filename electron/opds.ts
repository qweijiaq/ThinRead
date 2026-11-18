import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import * as cheerio from 'cheerio'

import type { BookSummary, OpdsAuth, OpdsEntry, OpdsPage } from '../shared/types.js'
import { importBookFile } from './import.js'

const MAX_ENTRIES = 100
const MAX_BYTES = 250 * 1024 * 1024

function assertHttp(url: string): URL {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只支持 http / https 的 OPDS 地址。')
  }
  return parsed
}

function formatOf(type: string, href: string): 'EPUB' | 'PDF' | '其他' {
  const value = `${type} ${href}`.toLowerCase()
  if (value.includes('epub')) return 'EPUB'
  if (value.includes('pdf')) return 'PDF'
  return '其他'
}

function authHeader(auth?: OpdsAuth): Record<string, string> {
  if (!auth?.username && !auth?.password) return {}
  return { Authorization: `Basic ${Buffer.from(`${auth.username ?? ''}:${auth.password ?? ''}`).toString('base64')}` }
}

/** 读取一个 OPDS 1.x / Atom 目录，返回当前页条目和下一页链接。 */
export async function listOpds(url: string, auth?: OpdsAuth): Promise<OpdsPage> {
  const base = assertHttp(url)
  const response = await fetch(base, {
    headers: { Accept: 'application/atom+xml, application/xml, text/xml', ...authHeader(auth) },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`读取 OPDS 失败：HTTP ${response.status}`)
  const xml = await response.text()
  const $ = cheerio.load(xml, { xmlMode: true })
  const entries: OpdsEntry[] = []
  $('entry').each((_, element) => {
    if (entries.length >= MAX_ENTRIES) return
    const entry = $(element)
    const title = entry.find('title').first().text().trim()
    const author = entry.find('author > name').first().text().trim()
    const links = entry.find('link').toArray()
    const link =
      links.find((item) => /acquisition|open-access/.test($(item).attr('rel') ?? '')) ??
      links.find((item) => /epub|pdf/i.test($(item).attr('type') ?? '')) ??
      links.find((item) => /\.(epub|pdf)(\?|$)/i.test($(item).attr('href') ?? ''))
    const href = link ? $(link).attr('href') : ''
    if (!title || !href) return
    const target = new URL(href, base).toString()
    const type = link ? $(link).attr('type') ?? '' : ''
    const format = formatOf(type, href)
    if (format === '其他') return
    entries.push({ title, author, format, url: target })
  })
  const nextHref = $('link[rel="next"]').first().attr('href')
  return {
    entries,
    next: nextHref ? new URL(nextHref, base).toString() : null,
  }
}

/** 下载 OPDS 条目并交给现有导入流程。 */
export async function importOpdsBook(entry: OpdsEntry, dataDir: string, auth?: OpdsAuth): Promise<BookSummary> {
  const url = assertHttp(entry.url)
  const response = await fetch(url, { headers: authHeader(auth), signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > MAX_BYTES) throw new Error('这个文件超过 250MB，暂不导入。')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_BYTES) throw new Error('这个文件超过 250MB，暂不导入。')
  const type = response.headers.get('content-type') ?? ''
  const extension = /pdf/i.test(type) || /\.pdf(\?|$)/i.test(url.pathname) ? '.pdf' : '.epub'
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thinread-opds-'))
  const file = path.join(dir, `opds-${Date.now()}${extension}`)
  try {
    await fs.writeFile(file, buffer)
    return await importBookFile(file, dataDir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
