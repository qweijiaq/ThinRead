import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { closeDatabase, getChapters, initDatabase, insertBook, listBooks, listNotes } from '../electron/db.js'
import { importHighlightsFile } from '../electron/import.js'

const CSV = `Highlight,Book Title,Book Author,Note,Tags,Location
"专注不是意志力，而是环境设计。","专注的练习","测试作者","","专注",12
"缩短发现分心的时间。","专注的练习","测试作者","","专注",18
`

test('merges highlights into a matching existing book', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-merge-'))
  try {
    initDatabase(dir)
    const existing = insertBook(
      { title: '专注的练习', author: '测试作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '原有正文。', html: null }],
    )
    const csvPath = path.join(dir, 'readwise.csv')
    fs.writeFileSync(csvPath, CSV)
    const result = await importHighlightsFile(csvPath, dir, { mergeExisting: true })
    assert.equal(result.books.length, 1)
    assert.equal(result.books[0]!.id, existing.id)
    assert.equal(result.highlights, 2)
    assert.equal(listBooks().length, 1)
    assert.equal(getChapters(existing.id).length, 2)
    assert.equal(listNotes(existing.id).length, 2)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
