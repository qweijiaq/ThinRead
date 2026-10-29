import * as cheerio from 'cheerio'
import sanitizeHtml from 'sanitize-html'

const ALLOWED_TAGS = [
  'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li',
  'em', 'strong', 'i', 'b', 'u', 's', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'figure', 'figcaption', 'img', 'sup', 'sub', 'code', 'pre', 'dl', 'dt', 'dd',
]

export function sanitizeChapterHtml(html: string): string {
  return sanitizeHtml(convertAlignAttributes(html), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      img: ['src', 'alt', 'title', 'data-img-id'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      ol: ['start', 'type'],
      li: ['value'],
    },
    allowedClasses: {
      '*': ['center', 'right', 'text-center', 'text-right', 'caption', 'image-caption'],
    },
    allowedSchemes: ['data', 'http', 'https', 'mailto'],
    transformTags: {
      a: (_tagName, attribs) => ({ tagName: 'span', attribs: { class: 'epub-inline-link', title: attribs.href ?? '' } }),
    },
  })
}

/** 模型和旧 EPUB 常用 style/align 表示居中；清洗前转成语义 class，避免样式被丢掉。 */
function convertAlignAttributes(html: string): string {
  const $ = cheerio.load(html)
  $('[style], [align]').each((_, element) => {
    const node = $(element)
    const style = (node.attr('style') ?? '').toLowerCase()
    const alignAttr = (node.attr('align') ?? '').toLowerCase()
    const align =
      /text-align\s*:\s*(center|right)/.exec(style)?.[1] ??
      (alignAttr === 'center' || alignAttr === 'right' ? alignAttr : null)
    if (!align) return
    const classes = new Set((node.attr('class') ?? '').split(/\s+/).filter(Boolean))
    classes.add(align)
    node.attr('class', [...classes].join(' '))
  })
  return $('body').html() ?? $.html()
}

export function htmlToText(html: string): string {
  const $ = cheerio.load(html)
  $('script, style, nav, svg').remove()
  $('br').replaceWith('\n')
  $('p, div, section, article, h1, h2, h3, h4, h5, h6, li, blockquote, tr, figcaption, dt, dd, pre').each((_, element) => {
    $(element).append('\n')
  })
  return $('body')
    .text()
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[“”"'‘’「」『』（）()【】\[\]…—–\-·、，,。.；;：:！!？?《》<>]/g, '')
}

/** 把内联的 data URL 图片换成短占位，避免把几 MB 图片发给模型。 */
export function extractDataImages(html: string): { html: string; images: Map<string, string> } {
  const $ = cheerio.load(html)
  const images = new Map<string, string>()
  let index = 0
  $('img').each((_, element) => {
    const node = $(element)
    const src = node.attr('src') ?? ''
    if (!src.startsWith('data:')) {
      node.remove()
      return
    }
    const id = String(index++)
    images.set(id, src)
    node.attr('data-img-id', id)
    node.removeAttr('src')
  })
  return { html: $('body').html() ?? $.html(), images }
}

/** 还原图片；模型新插入的图片没有 id，直接移除，避免加载外部资源。 */
export function restoreDataImages(html: string, images: Map<string, string>): string {
  const $ = cheerio.load(html)
  $('img').each((_, element) => {
    const node = $(element)
    const id = node.attr('data-img-id')
    if (id === undefined) {
      node.remove()
      return
    }
    const src = images.get(id)
    if (src) node.attr('src', src)
    else node.remove()
    node.removeAttr('data-img-id')
  })
  return $('body').html() ?? $.html()
}
