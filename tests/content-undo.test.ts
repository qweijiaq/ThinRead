import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  applyContent,
  closeDatabase,
  getChapters,
  initDatabase,
  insertBook,
  listNotes,
  replaceAiNotes,
  saveLabArtifact,
  undoContentApply,
} from '../electron/db.js'

test('undoes a notes snapshot apply', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-undo-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '撤销测试', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '第一章正文。', html: null }],
    )
    const chapter = getChapters(book.id)[0]!
    replaceAiNotes(chapter.id, [
      {
        kind: 'point',
        title: '原卡片',
        content: '原来的内容。',
        quote: '第一章正文。',
        quoteVerified: true,
        tags: [],
      },
    ])
    const original = listNotes(book.id, chapter.id)[0]!
    const artifact = saveLabArtifact({
      tool: 'chapter-notes',
      scope: `chapter:${chapter.id}`,
      title: '替换后的笔记',
      content: JSON.stringify({
        notes: [{ ...original, content: '替换后的内容。' }],
        report: null,
      }),
      kind: 'notes',
      bookId: book.id,
      chapterId: chapter.id,
    })

    const applied = applyContent(artifact.id, 'source')
    assert.ok(applied.undoToken)
    assert.equal(listNotes(book.id, chapter.id)[0]?.content, '替换后的内容。')

    const undone = undoContentApply(applied.undoToken!)
    assert.equal(undone.appliedTo, 'chapter')
    assert.equal(listNotes(book.id, chapter.id)[0]?.content, '原来的内容。')
    assert.throws(() => undoContentApply(applied.undoToken!), /无法撤销/)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
