import fs from 'node:fs'
import path from 'node:path'

import type { LibraryFilter, LibraryNote, NotesExportResult } from '../shared/types.js'
import { getBookSummary, listLibraryNotesPage } from './db.js'

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function sanitizeFileName(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|#%{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
  return cleaned || '未命名笔记'
}

function stamp(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${date.getFullYear()}${month}${day}-${hours}${minutes}${seconds}`
}

function deepLink(note: LibraryNote): string {
  const chapter = note.chapterId ? `/chapter/${note.chapterId}` : ''
  return `thinread://book/${note.bookId}${chapter}`
}

function noteMarkdown(note: LibraryNote, author: string): string {
  const frontmatter = [
    '---',
    `title: ${yamlString(note.title)}`,
    `book: ${yamlString(note.bookTitle)}`,
    ...(author ? [`author: ${yamlString(author)}`] : []),
    ...(note.chapterTitle ? [`chapter: ${yamlString(note.chapterTitle)}`] : []),
    `kind: ${note.kind}`,
    `tags: [${note.tags.map(yamlString).join(', ')}]`,
    `quote_verified: ${note.quoteVerified}`,
    `author_type: ${note.author}`,
    `edited: ${note.edited}`,
    ...(note.importance ? [`importance: ${note.importance}`] : []),
    `created: ${note.createdAt}`,
    `updated: ${note.updatedAt}`,
    `source: ${yamlString(deepLink(note))}`,
    '---',
    '',
  ]
  const quote = note.quote
    ? `> ${note.quote.replace(/\r?\n/g, '\n> ')}\n\n`
    : ''
  const divergences =
    note.divergences.length > 0
      ? `\n\n## 延伸\n\n${note.divergences
          .map((item) => `- **${item.type}**：${item.text}`)
          .join('\n')}`
      : ''
  return `${frontmatter.join('\n')}# ${note.title}\n\n${quote}${note.content}${divergences}\n`
}

/** 把当前筛选出的笔记写成 Obsidian/Notion 可导入的 Markdown 文件夹。 */
export function exportNotesMarkdown(directory: string, filter: LibraryFilter = {}): NotesExportResult {
  const notes: LibraryNote[] = []
  let offset = 0
  while (true) {
    const page = listLibraryNotesPage({ ...filter, limit: 200, offset })
    notes.push(...page.items)
    if (page.items.length === 0 || notes.length >= page.total) break
    offset += page.items.length
  }
  if (notes.length === 0) {
    return { saved: false, path: null, count: 0 }
  }
  const root = path.join(directory, `ThinRead-notes-${stamp()}`)
  fs.mkdirSync(root, { recursive: true })
  const authors = new Map<string, string>()
  const used = new Set<string>()
  const files: Array<{ file: string; title: string }> = []

  for (const note of notes) {
    if (!authors.has(note.bookId)) {
      authors.set(note.bookId, getBookSummary(note.bookId)?.author ?? '')
    }
    const base = sanitizeFileName(
      [note.bookTitle, note.chapterTitle, note.title].filter(Boolean).join(' - '),
    )
    let file = `${base}.md`
    let key = file.toLowerCase()
    let suffix = 2
    while (used.has(key)) {
      file = `${base} (${suffix++}).md`
      key = file.toLowerCase()
    }
    used.add(key)
    fs.writeFileSync(path.join(root, file), noteMarkdown(note, authors.get(note.bookId) ?? ''), 'utf8')
    files.push({ file, title: note.title })
  }

  const index = [
    '# 页边笔记导出',
    '',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    `笔记数量：${files.length}`,
    '',
    ...files.map((item) => `- [${item.title.replace(/[[\]]/g, '\\$&')}](${encodeURIComponent(item.file)})`),
    '',
  ].join('\n')
  fs.writeFileSync(path.join(root, 'index.md'), index, 'utf8')
  return { saved: true, path: root, count: notes.length }
}
