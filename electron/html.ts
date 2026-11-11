import * as cheerio from 'cheerio'
import sanitizeHtml from 'sanitize-html'

const ALLOWED_TAGS = [
  'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li',
  'em', 'strong', 'i', 'b', 'u', 's', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'figure', 'figcaption', 'img', 'aside', 'sup', 'sub', 'code', 'pre', 'dl', 'dt', 'dd',
]

export function sanitizeChapterHtml(html: string): string {
  return normalizePreCode(sanitizeHtml(convertAlignAttributes(html), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      img: ['src', 'alt', 'title', 'data-img-id', 'data-image-understood'],
      aside: ['data-image-understanding', 'data-code-understanding'],
      pre: ['data-code-understood'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      ol: ['start', 'type'],
      li: ['value'],
    },
    allowedClasses: {
      '*': [
        'center',
        'right',
        'text-center',
        'text-right',
        'caption',
        'image-caption',
        'image-understanding',
        'image-understanding-label',
        'code-understanding',
        'code-understanding-label',
        /^language-/,
        /^lang-/,
      ],
    },
    allowedSchemes: ['data', 'http', 'https', 'mailto'],
    transformTags: {
      a: (_tagName, attribs) => ({ tagName: 'span', attribs: { class: 'epub-inline-link', title: attribs.href ?? '' } }),
    },
  }))
}

/**
 * 有些 EPUB 会把代码的每个 token 包成独立的 <code>。渲染层会再包代码块，
 * 如果只替换第一个 code，整段代码会被插进入一遍，造成重复。
 * 导入和 AI 排版时先把这种 pre 压成一个 code，保留文本和语言 class。
 */
function normalizePreCode(html: string): string {
  const $ = cheerio.load(`<div id="__normalize_root">${html}</div>`)
  const root = $('#__normalize_root')
  root.find('pre').each((_, element) => {
    const pre = $(element)
    const codes = pre.find('code')
    if (codes.length === 0) return
    const mixed = codes.length > 1 || pre.contents().length > 1
    if (!mixed) return
    const languageClasses = [
      ...new Set(
        codes
          .toArray()
          .flatMap((code) => ($(code).attr('class') ?? '').split(/\s+/))
          .filter((name) => name.startsWith('language-') || name.startsWith('lang-')),
      ),
    ]
    const code = $('<code></code>').text(pre.text())
    if (languageClasses.length > 0) code.attr('class', languageClasses.join(' '))
    pre.empty().append(code)
  })
  return root.html() ?? html
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

const FORMAT_DECORATIVE_IMAGE =
  /logo|icon|二维码|qr\s*code|装饰|divider|spacer|bullet|tracking|pixel|watermark|水印|占位/i

const FORMAT_SYMBOL_PREFIX = /^[¡•■□◆◇●○▪▫·\-–—]+\s*/

const FORMAT_INLINE_BULLET = /(^|[\n\r\t ])[¡•■□◆◇●○▪▫][ \t]+/g

function stripFormatBullets(value: string): string {
  return value.replace(FORMAT_INLINE_BULLET, '$1').replace(/[ \t]{2,}/g, ' ')
}

function imageBytes(src: string): number {
  if (!src.startsWith('data:')) return Number.POSITIVE_INFINITY
  const comma = src.indexOf(',')
  if (comma < 0) return 0
  return Math.floor(((src.length - comma - 1) * 3) / 4)
}

function isFormatNoiseText(value: string): boolean {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return true
  if (/^\d{1,4}$/.test(text)) return true
  if (/^[ivxlcdm]{1,5}$/i.test(text)) return true
  if (/^[\p{P}\p{S}\s]+$/u.test(text) && text.length <= 20) return true
  return false
}

/**
 * 清理 PDF/EPUB 导入后常见的排版噪声：装饰图、小图标、项目符号、页码和空容器。
 * 在送给 AI 排版前和 AI 返回后都跑一遍，避免模型漏删。
 */
export function cleanFormatHtml(html: string): string {
  const $ = cheerio.load(`<div id="__format_clean_root">${html}</div>`)
  const root = $('#__format_clean_root')

  root.find('img').each((_, element) => {
    const node = $(element)
    const src = (node.attr('src') ?? '').trim()
    const alt = `${node.attr('alt') ?? ''} ${node.attr('title') ?? ''}`
    const width = Number(node.attr('width') ?? 0)
    const height = Number(node.attr('height') ?? 0)
    if (!src) {
      node.remove()
      return
    }
    if (FORMAT_DECORATIVE_IMAGE.test(alt)) {
      node.remove()
      return
    }
    if (imageBytes(src) < 1200 || (width > 0 && width < 80) || (height > 0 && height < 80)) {
      node.remove()
    }
  })

  root.find('p, li, td, th, figcaption, blockquote, h1, h2, h3, h4, h5, h6').each((_, element) => {
    const node = $(element)
    node.contents().each((__, child) => {
      if (child.type !== 'text') return
      const original = $(child).text()
      const cleaned = stripFormatBullets(original)
      if (cleaned !== original) $(child).replaceWith(cleaned)
    })
  })

  root.find('li').each((_, element) => {
    const node = $(element)
    const text = node.text().replace(/\s+/g, ' ').trim()
    const cleaned = text.replace(FORMAT_SYMBOL_PREFIX, '').trim()
    if (cleaned !== text) node.text(cleaned)
  })

  root.find('p, div, li, figcaption, h1, h2, h3, h4, h5, h6').each((_, element) => {
    const node = $(element)
    if (node.children().length > 0) return
    const text = node.text().replace(/\s+/g, ' ').trim()
    if (isFormatNoiseText(text)) node.remove()
  })

  root.find('ul, ol').each((_, element) => {
    const node = $(element)
    if (node.children('li').length === 0) node.remove()
  })
  root.find('figure').each((_, element) => {
    const node = $(element)
    const hasImage = node.find('img').length > 0
    const caption = node.find('figcaption').text().trim()
    if (!hasImage && caption.length < 2) node.remove()
  })

  return root.html() ?? html
}


/** 去掉阅读器在 DOM 上临时加的按钮和代码高亮包装，保存用户编辑后的正文。 */
export function stripEditorArtifacts(html: string): string {
  const $ = cheerio.load(`<div id="__editor_root">${html}</div>`)
  const root = $('#__editor_root')
  root.find('.reader-image-actions, .code-block-head, .code-block-actions, button').remove()
  root.find('.reader-image-wrap').each((_, element) => {
    const node = $(element)
    const img = node.find('img').first()
    if (img.length > 0) node.replaceWith(img)
    else node.remove()
  })
  root.find('.code-block').each((_, element) => {
    const node = $(element)
    const pre = node.find('pre').first()
    if (pre.length > 0) node.replaceWith(pre)
    else node.remove()
  })
  root.find('[contenteditable], [spellcheck]').each((_, element) => {
    const node = $(element)
    node.removeAttr('contenteditable')
    node.removeAttr('spellcheck')
  })
  return root.html() ?? html
}
