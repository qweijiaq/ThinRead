import * as cheerio from 'cheerio'

import type { NewChapter } from '../db.js'
import { htmlToText } from '../html.js'
import { chaptersFromHtml, splitTextIntoChapters } from './text-book.js'

const MAX_BYTES = 8 * 1024 * 1024
const TIMEOUT_MS = 25_000

function assertFetchableUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('网址格式不正确，请填写完整的 http:// 或 https:// 地址。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http:// 或 https:// 网页。')
  }
  const host = url.hostname.toLowerCase()
  const privateHost =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  if (privateHost) throw new Error('出于安全考虑，不能导入本机或局域网地址。')
  return url
}

function metaContent($: cheerio.CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    const value = $(selector).first().attr('content')?.trim()
    if (value) return value
  }
  return ''
}

/** 抓取网页正文，去掉导航、广告和脚本；保留图片链接，不下载远程资源。 */
export async function parseUrl(rawUrl: string): Promise<{ title: string; author: string; chapters: NewChapter[]; html: string }> {
  const url = assertFetchableUrl(rawUrl)
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
    },
  }).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`网页抓取失败：${detail}`)
  })
  if (!response.ok) throw new Error(`网页抓取失败：HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
    throw new Error('这个地址不是网页文本，暂不支持这种内容类型。')
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BYTES) throw new Error('网页内容超过 8MB，暂不导入。')
  const html = await response.text()
  if (html.length > MAX_BYTES) throw new Error('网页内容超过 8MB，暂不导入。')

  const $ = cheerio.load(html)
  $('script, style, noscript, svg, canvas, iframe, form, nav, header, footer, aside').remove()
  const title =
    metaContent($, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
    $('title').first().text().replace(/\s+/g, ' ').trim() ||
    $('h1').first().text().replace(/\s+/g, ' ').trim() ||
    url.hostname
  const author =
    metaContent($, [
      'meta[name="author"]',
      'meta[property="article:author"]',
      'meta[name="twitter:creator"]',
      '[rel="author"]',
    ]) || $('[rel="author"]').first().text().replace(/\s+/g, ' ').trim()
  const candidates = ['article', 'main', '[role="main"]', '.article-content', '.post-content', '.entry-content', '.markdown-body', '#content', '.content']
  let contentHtml = ''
  let bestLength = 0
  for (const selector of candidates) {
    $(selector).each((_, element) => {
      const text = $(element).text().replace(/\s+/g, ' ').trim()
      if (text.length > bestLength) {
        bestLength = text.length
        contentHtml = $(element).html() ?? ''
      }
    })
  }
  if (!contentHtml) contentHtml = $('body').html() ?? ''
  const chapters = /text\/plain/i.test(contentType)
    ? splitTextIntoChapters(htmlToText(html), title)
    : chaptersFromHtml(contentHtml, title)
  if (chapters.length === 0) throw new Error('没有从这个网页提取到可读正文。')
  return { title, author, chapters, html: contentHtml }
}
