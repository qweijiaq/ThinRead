import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  closeDatabase,
  deletePdfAnnotation,
  initDatabase,
  insertBook,
  listPdfAnnotations,
  savePdfAnnotation,
  updatePdfAnnotation,
} from '../electron/db.js'

test('saves, updates, and deletes PDF annotations per page', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-pdf-ann-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '标注测试', author: '作者', format: 'pdf', filePath: path.join(dir, 'source.pdf') },
      [{ title: '第 1 页', text: '正文', html: '<p>正文</p>' }],
    )
    const saved = savePdfAnnotation({
      bookId: book.id,
      page: 3,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.05,
      note: '这一段很重要',
    })
    assert.equal(saved.page, 3)
    assert.equal(saved.color, 'yellow')
    assert.equal(listPdfAnnotations(book.id, 3).length, 1)
    assert.equal(listPdfAnnotations(book.id, 2).length, 0)

    const updated = updatePdfAnnotation(saved.id, { note: '改过的备注', color: 'green' })
    assert.equal(updated.note, '改过的备注')
    assert.equal(updated.color, 'green')

    deletePdfAnnotation(saved.id)
    assert.equal(listPdfAnnotations(book.id, 3).length, 0)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('clamps annotation coordinates and rejects tiny regions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-pdf-ann-clamp-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '标注测试', author: '作者', format: 'pdf', filePath: path.join(dir, 'source.pdf') },
      [{ title: '第 1 页', text: '正文', html: '<p>正文</p>' }],
    )
    const saved = savePdfAnnotation({
      bookId: book.id,
      page: 1,
      x: 1.4,
      y: -0.2,
      width: 0.5,
      height: 0.5,
    })
    assert.equal(saved.x, 1)
    assert.equal(saved.y, 0)
    assert.throws(() =>
      savePdfAnnotation({ bookId: book.id, page: 1, x: 0.1, y: 0.1, width: 0.0001, height: 0.0001 }),
    )
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
