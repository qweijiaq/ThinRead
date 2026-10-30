import * as cheerio from 'cheerio'
import { unzipSync } from 'fflate'

import type { NewChapter } from '../db.js'
import { chaptersFromHtml, splitTextIntoChapters } from './text-book.js'

export interface ParsedDocument {
  title: string
  author: string
  chapters: NewChapter[]
}

function decodeXml(value: string): string {
  const $ = cheerio.load(`<root>${value}</root>`, { xmlMode: true })
  return $('root').text()
}

function coreField(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<(?:dc:)?${tag}[^>]*>([\\s\\S]*?)</(?:dc:)?${tag}>`, 'i'))
  return match ? decodeXml(match[1]!.trim()) : ''
}

function isHeadingStyle(style: string): boolean {
  return /heading|title|标题|题目/i.test(style)
}

/** 从 DOCX 的 WordprocessingML 中抽取段落；标题样式转成 Markdown 标题。 */
export function parseDocx(buffer: Buffer, sourceName: string): ParsedDocument {
  const files = unzipSync(new Uint8Array(buffer))
  const documentXml = files['word/document.xml']
  if (!documentXml) throw new Error('DOCX 文件缺少正文，可能已损坏。')
  const xml = new TextDecoder('utf-8').decode(documentXml)
  const core = files['docProps/core.xml']
    ? new TextDecoder('utf-8').decode(files['docProps/core.xml'])
    : ''

  const blocks: string[] = []
  for (const raw of xml.split(/<\/w:p>/)) {
    const style = raw.match(/<w:pStyle[^>]*w:val="([^"]+)"/)?.[1] ?? ''
    const text = [...raw.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((match) => decodeXml(match[1] ?? ''))
      .join('')
      .replace(/ /g, ' ')
      .trim()
    if (!text) continue
    blocks.push(isHeadingStyle(style) ? `## ${text}` : text)
  }

  const body = blocks.join('\n\n').trim()
  if (!body) throw new Error('没有从 DOCX 中读出正文。')
  const fallback = sourceName.replace(/\.docx$/i, '')
  const title = coreField(core, 'title') || fallback
  const author = coreField(core, 'creator')
  return { title, author, chapters: splitTextIntoChapters(body, title) }
}

export function parseHtmlDocument(html: string, sourceName: string): ParsedDocument {
  const $ = cheerio.load(html)
  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').first().text().replace(/\s+/g, ' ').trim() ||
    $('h1').first().text().replace(/\s+/g, ' ').trim() ||
    sourceName.replace(/\.html?$/i, '')
  const author =
    $('meta[name="author"]').attr('content')?.trim() ||
    $('[rel="author"]').first().text().replace(/\s+/g, ' ').trim()
  const chapters = chaptersFromHtml($('body').html() ?? html, title)
  if (chapters.length === 0) throw new Error('没有从 HTML 中读出正文。')
  return { title, author, chapters }
}

export function parseMarkdownDocument(text: string, sourceName: string): ParsedDocument {
  const clean = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '')
  if (clean.trim().length < 20) throw new Error('文件正文太短，无法导入。')
  const firstHeading = clean.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const title = firstHeading || sourceName.replace(/\.(?:md|markdown|txt)$/i, '')
  const author = clean.match(/^(?:作者|Author)[:：]\s*(.+)$/im)?.[1]?.trim() ?? ''
  const chapters = splitTextIntoChapters(clean, title)
  if (chapters.length === 0) throw new Error('没有从文件中读出可阅读的章节。')
  return { title, author, chapters }
}
