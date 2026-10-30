export interface HighlightEntry {
  title: string
  author: string
  text: string
  note: string
  tags: string[]
  location: string
  url: string
}

export interface HighlightGroup {
  title: string
  author: string
  entries: HighlightEntry[]
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''))
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  row.push(field.replace(/\r$/, ''))
  if (row.some((cell) => cell.trim())) rows.push(row)
  return rows
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/^﻿/, '').replace(/\s+/g, ' ')
}

function valueAt(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? '').trim() : ''
}

function splitTags(value: string): string[] {
  return [...new Set(value.split(/[,;，；]/).map((tag) => tag.trim()).filter(Boolean))]
}

function parseReadwiseCsv(text: string): HighlightEntry[] {
  const rows = parseCsv(text)
  if (rows.length < 2) return []
  const headers = rows[0]!.map(normalizeHeader)
  const indexOf = (...names: string[]): number => headers.findIndex((header) => names.includes(header))
  const titleIndex = indexOf('title', 'book title', 'book', '书名', '标题')
  const authorIndex = indexOf('author', 'book author', '作者')
  const highlightIndex = indexOf('highlight', 'text', 'content', 'highlighted text', '划线', '内容')
  const noteIndex = indexOf('note', 'notes', '备注', '笔记')
  const tagsIndex = indexOf('tags', 'tag', '标签')
  const locationIndex = indexOf('location', 'page', '位置', '页码')
  const urlIndex = indexOf('url', 'source', '链接')
  if (highlightIndex < 0 || titleIndex < 0) return []
  const entries: HighlightEntry[] = []
  for (const row of rows.slice(1)) {
    const title = valueAt(row, titleIndex)
    const highlight = valueAt(row, highlightIndex)
    if (!title || !highlight) continue
    entries.push({
      title,
      author: valueAt(row, authorIndex),
      text: highlight,
      note: valueAt(row, noteIndex),
      tags: splitTags(valueAt(row, tagsIndex)),
      location: valueAt(row, locationIndex),
      url: valueAt(row, urlIndex),
    })
  }
  return entries
}

function parseKindle(text: string, fallbackTitle: string): HighlightEntry[] {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const blocks = normalized.split(/\n={5,}\n/).map((block) => block.trim()).filter(Boolean)
  const entries: HighlightEntry[] = []
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim())
    if (lines.length < 2) continue
    const titleLine = lines[0] ?? ''
    const meta = lines.find((line) => /highlight|note|bookmark|划线|标注|笔记|书签/i.test(line)) ?? ''
    const titleMatch = titleLine.match(/^(.*?)\s*\((.*?)\)\s*$/)
    const title = (titleMatch?.[1] ?? titleLine).trim() || fallbackTitle
    const author = titleMatch?.[2]?.trim() ?? ''
    const location = meta.match(/(?:位置|location|page|第)\s*#?\s*([0-9]+(?:[-–][0-9]+)?)/i)?.[1] ?? ''
    const bodyStart = Math.max(
      lines.indexOf(meta) + 1,
      lines.findIndex((line) => line === '') + 1,
      1,
    )
    const body = lines.slice(bodyStart).join('\n').trim()
    if (!body) continue
    const isNote = /note|笔记/i.test(meta) && !/highlight|划线/i.test(meta)
    entries.push({
      title,
      author,
      text: isNote ? '' : body,
      note: isNote ? body : '',
      tags: [],
      location,
      url: '',
    })
  }
  return entries
}

/** 自动识别 Readwise CSV 和 Kindle My Clippings.txt。 */
export function parseHighlightsFile(text: string, filename: string): HighlightEntry[] {
  const clean = text.replace(/^﻿/, '')
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? ''
  const isCsv = /\.csv$/i.test(filename) || (firstLine.includes(',') && /highlight|title|author|book/i.test(firstLine))
  const parsed = isCsv
    ? parseReadwiseCsv(clean)
    : parseKindle(clean, filename.replace(/\.(?:txt|csv)$/i, ''))
  const seen = new Set<string>()
  return parsed.filter((entry) => {
    const key = `${entry.title}\u0000${entry.author}\u0000${entry.text || entry.note}\u0000${entry.location}`
    if (seen.has(key)) return false
    seen.add(key)
    return Boolean(entry.text || entry.note)
  })
}

export function groupHighlights(entries: HighlightEntry[]): HighlightGroup[] {
  const groups = new Map<string, HighlightGroup>()
  for (const entry of entries) {
    const key = `${entry.title}\u0000${entry.author}`
    const group = groups.get(key) ?? { title: entry.title, author: entry.author, entries: [] }
    group.entries.push(entry)
    groups.set(key, group)
  }
  return [...groups.values()]
}
