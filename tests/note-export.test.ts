import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  closeDatabase,
  createNote,
  getChapters,
  initDatabase,
  insertBook,
  replaceAiNotes,
} from '../electron/db.js'
import { exportNotesMarkdown } from '../electron/note-export.js'

test('exports the current note scope to Markdown files with frontmatter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-export-'))
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-export-out-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '导出测试', author: '作者名', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '第一章正文。', html: null }],
    )
    const chapter = getChapters(book.id)[0]!
    replaceAiNotes(chapter.id, [
      {
        kind: 'point',
        title: '同一个标题',
        content: '第一条知识点的内容。',
        quote: '第一章正文。',
        quoteVerified: true,
        tags: ['专注', '环境'],
      },
    ])
    createNote({
      bookId: book.id,
      chapterId: chapter.id,
      kind: 'thought',
      title: '同一个标题',
      content: '我自己的想法。',
      tags: ['想法'],
    })

    const result = exportNotesMarkdown(output, { bookId: book.id })
    assert.equal(result.saved, true)
    assert.equal(result.count, 2)
    assert.ok(result.path)
    const root = result.path!
    const files = fs.readdirSync(root).filter((name) => name.endsWith('.md'))
    assert.equal(files.length, 3) // 2 条笔记 + index.md
    const noteFiles = files.filter((name) => name !== 'index.md')
    assert.equal(new Set(noteFiles).size, 2)

    const markdown = noteFiles.map((name) => fs.readFileSync(path.join(root, name), 'utf8')).join('\n')
    assert.match(markdown, /^---\n/m)
    assert.match(markdown, /book: "导出测试"/)
    assert.match(markdown, /author: "作者名"/)
    assert.match(markdown, /tags: \["专注", "环境"\]/)
    assert.match(markdown, /quote_verified: true/)
    assert.match(markdown, /source: "thinread:\/\/book\//)
    assert.match(markdown, /> 第一章正文。/)

    const index = fs.readFileSync(path.join(root, 'index.md'), 'utf8')
    assert.match(index, /页边笔记导出/)
    assert.match(index, /笔记数量：2/)

    const empty = exportNotesMarkdown(output, { bookId: 'missing-book' })
    assert.equal(empty.saved, false)
    assert.equal(empty.count, 0)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(output, { recursive: true, force: true })
  }
})
