export interface CitationInput {
  title: string
  author: string
  date: string
}

function yearOf(date: string): string {
  const match = date.match(/\d{4}/)
  return match?.[0] ?? String(new Date().getFullYear())
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function apaCitation(input: CitationInput): string {
  const author = clean(input.author) || '佚名'
  return `${author}. (${yearOf(input.date)}). ${clean(input.title)}.`
}

export function bibtexCitation(input: CitationInput): string {
  const slug =
    clean(input.title)
      .toLowerCase()
      .replace(/[^a-z0-9一-鿿]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'thinread-note'
  const author = clean(input.author).replace(/[{}]/g, '')
  const title = clean(input.title).replace(/[{}]/g, '')
  return [
    `@book{${slug},`,
    `  title = {${title}},`,
    ...(author ? [`  author = {${author}},`] : []),
    `  year = {${yearOf(input.date)}},`,
    '  note = {Reading notes generated with ThinRead}',
    '}',
    '',
  ].join('\n')
}

export function risCitation(input: CitationInput): string {
  const author = clean(input.author)
  const lines = ['TY  - BOOK', `TI  - ${clean(input.title)}`]
  if (author) lines.push(`AU  - ${author}`)
  lines.push(`PY  - ${yearOf(input.date)}`, 'ER  - ', '')
  return lines.join('\n')
}
