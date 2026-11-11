import type { CitationMeta, CitationStyle } from '../../shared/types.js'

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function trimTrailingDot(value: string): string {
  return value.replace(/[.。]+$/, '')
}

function bibtexEscape(value: string): string {
  return value.replace(/[{}]/g, (char) => `\\${char}`)
}

function citationKey(meta: CitationMeta): string {
  const author = clean(meta.author)
    .split(/[\s,，、]+/)
    .find(Boolean)
    ?.replace(/[^\p{L}\p{N}]/gu, '')
  const title = clean(meta.title)
    .split(/\s+/)
    .find(Boolean)
    ?.replace(/[^\p{L}\p{N}]/gu, '')
  return `${author || 'thinread'}${clean(meta.year) || 'nd'}${title || 'book'}`.slice(0, 64)
}

export function formatCitation(style: CitationStyle, meta: CitationMeta): string {
  const title = trimTrailingDot(clean(meta.title)) || '未命名'
  const author = trimTrailingDot(clean(meta.author)) || '佚名'
  const year = clean(meta.year) || 'n.d.'
  const publisher = trimTrailingDot(clean(meta.publisher))
  const url = clean(meta.url)
  const doi = clean(meta.doi)

  if (style === 'bibtex') {
    const fields: Array<[string, string]> = [
      ['author', author],
      ['title', title],
      ['year', clean(meta.year)],
      ['publisher', publisher],
      ['url', url],
      ['doi', doi],
    ]
    const body = fields
      .filter(([, value]) => value)
      .map(([key, value]) => `  ${key} = {${bibtexEscape(value)}}`)
      .join(',\n')
    return `@book{${citationKey(meta)},\n${body}\n}\n`
  }

  if (style === 'ris') {
    const lines = [
      'TY  - BOOK',
      `AU  - ${author}`,
      `TI  - ${title}`,
      `PY  - ${clean(meta.year)}`,
      `PB  - ${publisher}`,
      `UR  - ${url}`,
      `DO  - ${doi}`,
      'ER  - ',
    ]
    return `${lines.filter((line) => !/^(PY|PB|UR|DO)  - $/.test(line)).join('\n')}\n`
  }

  const parts = [`${author}.`, `(${year}).`, `${title}.`]
  if (publisher) parts.push(`${publisher}.`)
  if (url) parts.push(url)
  if (doi) parts.push(`https://doi.org/${doi}`)
  return `${parts.join(' ')}\n`
}

export function citationExtension(style: CitationStyle): 'bib' | 'ris' | 'txt' {
  return style === 'bibtex' ? 'bib' : style === 'ris' ? 'ris' : 'txt'
}

export function citationFilename(style: CitationStyle, meta: CitationMeta): string {
  const base = clean(meta.title)
    .replace(/[\\/:*?"<>|#%{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${base || 'citation'}.${citationExtension(style)}`
}
