import path from 'node:path'

import * as cheerio from 'cheerio'
import { unzipSync } from 'fflate'

import type { NewChapter } from '../db.js'
import { htmlToText, sanitizeChapterHtml } from '../html.js'

export interface ParsedBook {
  title: string
  author: string
  chapters: NewChapter[]
  cover?: { data: Uint8Array; mime: string; extension: string }
}

const MAX_CHAPTERS = 600
const MAX_IMAGE_BYTES = 2 * 1024 * 1024

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'blockquote',
  'pre', 'figure', 'figcaption', 'hr', 'dl', 'dt', 'dd',
])

const CHAPTER_PATTERN =
  /^(第\s*[0-9一二三四五六七八九十百千零两]+\s*[章回卷部篇]|(chapter|part|book)\s+[0-9ivxlcdm]+|[上下中]篇|序言|序|前言|引言|后记|尾声|结语|附录|致谢)/i

const TITLE_CLASS_PATTERN = /(chapter-title|part-title|book-title|section-title|heading|subtitle)/i

const PART_PATTERN =
  /^([上下中]篇|第\s*[0-9一二三四五六七八九十百千零两]+\s*[部篇卷]|part\s+[0-9ivxlcdm]+)/i

const BACK_MATTER_PATTERN = /^(后记|尾声|结语|附录|索引|致谢|参考文献|出版说明|版权|封面|目\s*录)/i

const SECTION_PATTERN = /^(第\s*[0-9一二三四五六七八九十百千零两]+\s*节|\d+(?:\.\d+)+\s|\d+[.、]\s)/i

type DomNode = any

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

function dirnameOf(file: string): string {
  const dir = path.posix.dirname(file)
  return dir === '.' ? '' : dir
}

function resolveHref(baseFile: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0] ?? '')
  const joined = path.posix.normalize(path.posix.join(dirnameOf(baseFile), clean))
  return joined.replace(/^\.\//, '')
}

function mimeFor(file: string): string | null {
  return IMAGE_MIME[path.posix.extname(file).toLowerCase()] ?? null
}

function tagNameOf(node: DomNode): string {
  return String(node?.tagName ?? node?.name ?? '').toLowerCase()
}

function isElement(node: DomNode): boolean {
  return node?.type === 'tag'
}

function isBlock(node: DomNode): boolean {
  return isElement(node) && BLOCK_TAGS.has(tagNameOf(node))
}

function hasNonWhitespaceText(node: DomNode): boolean {
  return node?.type === 'text' && String(node.data ?? '').trim().length > 0
}

function headingText($: cheerio.CheerioAPI, node: DomNode): string {
  return $(node).text().replace(/\s+/g, ' ').trim()
}

function inlineImagesInPlace(
  $: cheerio.CheerioAPI,
  chapterPath: string,
  files: Record<string, Uint8Array>,
): void {
  $('img').each((_, element) => {
    const node = $(element)
    const src = node.attr('src')
    if (!src) {
      node.remove()
      return
    }
    if (src.startsWith('data:')) return
    if (/^[a-z]+:/i.test(src)) {
      // 远程图片加载不了，留着只会显示 alt 文本（例如“未知”），直接移除。
      node.remove()
      return
    }
    const target = resolveHref(chapterPath, src)
    const bytes = files[target]
    const mime = mimeFor(target)
    if (!bytes || !mime || bytes.length > MAX_IMAGE_BYTES) {
      node.remove()
      return
    }
    node.attr('src', `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`)
  })
}

function isLooseNode(node: DomNode): boolean {
  return hasNonWhitespaceText(node) || (isElement(node) && !isBlock(node))
}

/** 把 wrapper 里零散的文本/内联元素包成段落，保持原有顺序。 */
function rebuildChildren($: cheerio.CheerioAPI, $element: cheerio.Cheerio<DomNode>): boolean {
  const children = $element.contents().toArray()
  if (children.length === 0) return false

  const rebuilt: cheerio.Cheerio<DomNode>[] = []
  let group: DomNode[] = []
  const flush = (): void => {
    if (group.length === 0) return
    if (group.some(isLooseNode)) {
      const $paragraph = $('<p></p>')
      for (const node of group) $paragraph.append($(node))
      rebuilt.push($paragraph)
    }
    group = []
  }

  for (const child of children) {
    if (isBlock(child)) {
      flush()
      rebuilt.push($(child))
    } else {
      group.push(child)
    }
  }
  flush()

  if (rebuilt.length === 0) return false
  $element.empty()
  for (const $child of rebuilt) $element.append($child)
  return true
}

/** 展开 wrapper、纯内联 div 变成 p、短标题段落提升为 h2/h3。 */
function normalizeStructure($: cheerio.CheerioAPI, $root: cheerio.Cheerio<DomNode>): void {
  for (let pass = 0; pass < 6; pass++) {
    let changed = false
    const targets = $root.find('section, article, div').toArray()
    for (const element of targets) {
      const $element = $(element)
      if ($element.parent().length === 0) continue
      const tag = tagNameOf(element)
      const children = $element.contents().toArray()
      const hasBlockChild = children.some(isBlock)
      const hasLoose = children.some(isLooseNode)

      if (tag === 'section' || tag === 'article') {
        if (hasBlockChild && hasLoose) rebuildChildren($, $element)
        $element.replaceWith($element.contents())
        changed = true
        continue
      }

      if (hasBlockChild) {
        if (hasLoose) rebuildChildren($, $element)
        $element.replaceWith($element.contents())
        changed = true
      } else {
        const $paragraph = $('<p></p>')
        const className = $element.attr('class')
        if (className) $paragraph.attr('class', className)
        $paragraph.append($element.contents())
        $element.replaceWith($paragraph)
        changed = true
      }
    }
    if (!changed) break
  }

  const rootChildren = $root.contents().toArray()
  if (rootChildren.some(isBlock) && rootChildren.some(isLooseNode)) {
    rebuildChildren($, $root)
  } else if (rootChildren.length > 0 && !rootChildren.some(isBlock)) {
    rebuildChildren($, $root)
  }

  // 有些 EPUB 用没有语义的 <p> 表示标题：类名像标题，或者文本本身就是“第X章/上篇/第X节”。
  $root.find('p').each((_, element) => {
    const $element = $(element)
    if ($element.find('p, div, ul, ol, table, blockquote, h1, h2, h3, h4, h5, h6, pre, dl').length > 0) return
    const text = headingText($, element)
    if (!text || text.length > 80) return

    const className = ($element.attr('class') ?? '').toLowerCase()
    const classMatch = TITLE_CLASS_PATTERN.test(className)
    const chapterMatch = CHAPTER_PATTERN.test(text) && text.length <= 60 && !/[。！？；]$/.test(text)
    const sectionMatch = SECTION_PATTERN.test(text) && text.length <= 60 && !/[。！？；]$/.test(text)
    if (!classMatch && !chapterMatch && !sectionMatch) return

    const headingTag = chapterMatch ? 'h2' : sectionMatch ? 'h3' : 'h2'
    const $heading = $(`<${headingTag}></${headingTag}>`)
    $heading.append($element.contents())
    $element.replaceWith($heading)
  })
}

interface HeadingInfo {
  node: DomNode
  text: string
  level: number
}

function collectHeadings($: cheerio.CheerioAPI, $container: cheerio.Cheerio<DomNode>): HeadingInfo[] {
  const headings: HeadingInfo[] = []
  const parent = $container.get(0)

  $container.find('h1, h2, h3, h4, h5, h6').each((_, element) => {
    if (element.parent !== parent) return
    const text = headingText($, element)
    if (text) headings.push({ node: element, text, level: Number(tagNameOf(element).slice(1)) })
  })

  return headings
}

function boundaryNodes(headings: HeadingInfo[]): Set<DomNode> {
  const boundaries = new Set<DomNode>()
  for (const heading of headings) {
    if (CHAPTER_PATTERN.test(heading.text)) boundaries.add(heading.node)
  }
  return boundaries
}

/** 目录页不拆分：它整页保留，之后交给分类器标记为 nav 并自动隐藏。 */
function looksLikeTocDocument(
  $: cheerio.CheerioAPI,
  $container: cheerio.Cheerio<DomNode>,
  headings: HeadingInfo[],
): boolean {
  const firstHeading = headings[0]?.text ?? ''
  if (/^(目\s*录(页)?|contents|table of contents)/i.test(firstHeading)) return true

  const candidates = new Map<string, string>()
  $container.find('h1, h2, h3, h4, h5, h6, p, li, a').each((_, element) => {
    const text = headingText($, element)
    if (!text || text.length > 80) return
    if (!CHAPTER_PATTERN.test(text) && !SECTION_PATTERN.test(text)) return
    candidates.set(text, text)
  })
  if (candidates.size < 5) return false

  const totalText = $container.text().replace(/\s+/g, '')
  const average = [...candidates.keys()].reduce((sum, text) => sum + text.length, 0) / candidates.size
  return totalText.length / candidates.size < 70 && average < 55
}

interface Draft {
  title: string
  heading: DomNode | null
  nodes: DomNode[]
}

function buildDrafts(
  $: cheerio.CheerioAPI,
  $container: cheerio.Cheerio<DomNode>,
): Draft[] {
  const headings = collectHeadings($, $container)
  const boundaries = boundaryNodes(headings)
  const drafts: Draft[] = []
  let current: Draft = { title: '', heading: null, nodes: [] }

  for (const node of $container.contents().toArray()) {
    if (boundaries.has(node)) {
      if (current.nodes.length > 0 || current.heading) drafts.push(current)
      current = { title: headingText($, node), heading: node, nodes: [] }
    } else {
      current.nodes.push(node)
    }
  }
  if (current.nodes.length > 0 || current.heading) drafts.push(current)

  return drafts
}

function draftHtml($: cheerio.CheerioAPI, draft: Draft, headings: HeadingInfo[]): { title: string; html: string } {
  let title = draft.title
  let exclude = draft.heading

  if (!draft.heading && !title) {
    const inDraft = headings.filter((heading) => draft.nodes.includes(heading.node))
    const chosen = inDraft.find((heading) => CHAPTER_PATTERN.test(heading.text)) ?? inDraft[0] ?? null
    if (chosen) {
      title = chosen.text
      exclude = chosen.node
    }
  }

  const $wrapper = $('<div></div>')
  for (const node of draft.nodes) {
    if (node === exclude) continue
    $wrapper.append($(node).clone())
  }

  return { title: title.slice(0, 80), html: ($wrapper.html() ?? '').trim() }
}

function contentContainer(
  $: cheerio.CheerioAPI,
  $body: cheerio.Cheerio<DomNode>,
): cheerio.Cheerio<DomNode> {
  const children = $body.children().toArray()
  if (children.length === 1) {
    const only = children[0]!
    const tag = tagNameOf(only)
    if (tag === 'div' || tag === 'section' || tag === 'article') return $(only)
  }
  return $body
}

export function parseEpub(buffer: Buffer, sourceName: string): ParsedBook {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(buffer))
  } catch (error) {
    throw new Error(`无法解压 EPUB：${error instanceof Error ? error.message : String(error)}`)
  }
  if (files['META-INF/encryption.xml']) {
    throw new Error('这本 EPUB 带有 DRM 加密，无法解析。')
  }
  const containerBytes = files['META-INF/container.xml']
  if (!containerBytes) throw new Error('EPUB 缺少 META-INF/container.xml')

  const $container = cheerio.load(decode(containerBytes), { xmlMode: true })
  const opfPath = $container('rootfile').attr('full-path')
  if (!opfPath) throw new Error('EPUB 的 container.xml 没有 rootfile')
  const opfBytes = files[opfPath]
  if (!opfBytes) throw new Error(`找不到 EPUB 的 OPF 文件：${opfPath}`)

  const $opf = cheerio.load(decode(opfBytes), { xmlMode: true })
  const title =
    $opf('metadata')
      .find('*')
      .filter((_, el) => {
        const name = (el as { name?: string }).name ?? ''
        return name === 'title' || name.endsWith(':title')
      })
      .first()
      .text()
      .trim() || path.basename(sourceName, path.extname(sourceName))
  const author = $opf('metadata')
    .find('*')
    .filter((_, el) => {
      const name = (el as { name?: string }).name ?? ''
      return name === 'creator' || name.endsWith(':creator')
    })
    .first()
    .text()
    .trim()

  const manifest = new Map<string, string>()
  $opf('manifest')
    .find('item')
    .each((_, element) => {
      const item = $opf(element)
      const id = item.attr('id')
      const href = item.attr('href')
      if (id && href) manifest.set(id, resolveHref(opfPath, href))
    })

  let coverHref = ''
  const coverMetaId = $opf('meta')
    .filter((_, element) => {
      const node = $opf(element)
      return (node.attr('name') ?? '').toLowerCase() === 'cover'
    })
    .first()
    .attr('content')
  if (coverMetaId) coverHref = manifest.get(coverMetaId) ?? ''
  if (!coverHref) {
    $opf('manifest')
      .find('item')
      .each((_, element) => {
        const item = $opf(element)
        if (!coverHref && /(^|\s)cover-image(\s|$)/i.test(item.attr('properties') ?? '')) {
          const href = item.attr('href')
          if (href) coverHref = resolveHref(opfPath, href)
        }
      })
  }

  const spine: string[] = []
  $opf('spine')
    .find('itemref')
    .each((_, element) => {
      const idref = $opf(element).attr('idref')
      if (idref) spine.push(idref)
    })

  const htmlTargets = spine
    .map((idref) => manifest.get(idref))
    .filter((target): target is string => Boolean(target))
    .slice(0, MAX_CHAPTERS)

  const targets = htmlTargets.length > 0 ? htmlTargets : Object.keys(files).filter((name) => /\.x?html?$/i.test(name))

  const chapters: NewChapter[] = []
  let currentPartTitle: string | null = null
  let currentPartIndex: number | null = null
  let partCounter = 0

  for (const target of targets) {
    const bytes = files[target]
    if (!bytes) continue

    const $ = cheerio.load(decode(bytes))
    $('script, style, nav, svg').remove()
    inlineImagesInPlace($, target, files)

    const $body = $('body').length > 0 ? $('body') : $.root()
    normalizeStructure($, $body)
    const $content = contentContainer($, $body)
    const headings = collectHeadings($, $content)
    const toc = looksLikeTocDocument($, $content, headings)
    const drafts = toc
      ? [
          {
            title:
              headings.find((heading) => /^(目\s*录(页)?|contents|table of contents)/i.test(heading.text))
                ?.text ?? '目录',
            heading:
              headings.find((heading) => /^(目\s*录(页)?|contents|table of contents)/i.test(heading.text))
                ?.node ?? null,
            nodes: $content.contents().toArray(),
          },
        ]
      : buildDrafts($, $content)

    for (const draft of drafts) {
      const { title: draftTitle, html } = draftHtml($, draft, headings)
      const fallback = `第 ${chapters.length + 1} 节`
      const title = draftTitle || fallback

      if (BACK_MATTER_PATTERN.test(title)) {
        currentPartTitle = null
        currentPartIndex = null
      }
      const isPart = PART_PATTERN.test(title)
      if (isPart) {
        partCounter += 1
        currentPartTitle = title
        currentPartIndex = partCounter
      }

      if (!html) continue
      const text = htmlToText(html)
      if (text.replace(/\s/g, '').length < 30) continue
      chapters.push({
        title,
        text,
        html: sanitizeChapterHtml(html),
        partTitle: isPart ? title : currentPartTitle,
        partIndex: currentPartIndex,
        isPart,
      })
    }
  }

  if (chapters.length === 0) throw new Error('这本 EPUB 里没有解析出可读的章节。')
  let cover: ParsedBook['cover']
  if (coverHref) {
    const bytes = files[coverHref]
    const extension = path.posix.extname(coverHref).toLowerCase()
    const mime = IMAGE_MIME[extension]
    if (bytes && mime && bytes.byteLength <= 8 * 1024 * 1024) {
      cover = { data: bytes, mime, extension }
    }
  }
  return { title: title || path.basename(sourceName), author, chapters, ...(cover ? { cover } : {}) }
}
