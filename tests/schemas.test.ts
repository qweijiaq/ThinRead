import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  closeDatabase,
  getChapters,
  initDatabase,
  insertBook,
  listNotes,
  replaceAiNotes,
} from '../electron/db.js'
import {
  feynmanArtifactSchema,
  formatArtifactSchema,
  generatedNoteListSchema,
  labQuizSchema,
  noteSchema,
  notesArtifactSchema,
  relationGraphSchema,
} from '../shared/schemas.js'
import type { GeneratedNote, RelationGraph } from '../shared/types.js'

const validNote: GeneratedNote = {
  kind: 'point',
  title: '一张卡片',
  content: '这是卡片正文。',
  quote: null,
  quoteVerified: false,
  tags: ['阅读'],
}

test('accepts a valid generated note and rejects invalid kinds', () => {
  assert.equal(generatedNoteListSchema.safeParse([validNote]).success, true)
  assert.equal(
    generatedNoteListSchema.safeParse([{ ...validNote, kind: 'unknown' }]).success,
    false,
  )
  assert.equal(generatedNoteListSchema.safeParse([{ ...validNote, content: '  ' }]).success, false)
})

test('validates full notes and rejects corrupt enum values', () => {
  const note = {
    ...validNote,
    id: 'n1',
    bookId: 'b1',
    chapterId: null,
    author: 'ai' as const,
    edited: false,
    section: null,
    importance: 3,
    role: null,
    divergences: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  assert.equal(noteSchema.safeParse(note).success, true)
  assert.equal(noteSchema.safeParse({ ...note, author: 'system' }).success, false)
  assert.equal(noteSchema.safeParse({ ...note, importance: 9 }).success, false)
})

test('validates relation graphs and quiz payloads', () => {
  const graph: RelationGraph = {
    title: '测试关系图',
    genre: '小说',
    summary: '',
    plot: '',
    nodes: [
      {
        id: 'p1',
        label: '人物',
        kind: 'person',
        role: 'protagonist',
        importance: 3,
        identity: '',
        rank: '',
        affiliation: '',
        aliases: [],
        realWorld: false,
        encyclopedia: '',
        description: '',
      },
    ],
    edges: [],
  }
  assert.equal(relationGraphSchema.safeParse(graph).success, true)
  assert.equal(
    relationGraphSchema.safeParse({ ...graph, nodes: [{ ...graph.nodes[0], kind: 'creature' }] }).success,
    false,
  )
  assert.equal(
    labQuizSchema.safeParse({
      questions: [{ question: '问题？', kind: '主旨', answer: '答案。', source: '原文' }],
    }).success,
    true,
  )
  assert.equal(labQuizSchema.safeParse({ questions: [] }).success, false)
})

test('validates format, notes and feynman artifact payloads', () => {
  assert.equal(
    formatArtifactSchema.safeParse({
      html: '<p>排版后的正文</p>',
      removed: [{ reason: '广告', text: '购买链接', verified: true }],
      style: {
        fontFamily: 'serif',
        fontSize: 17,
        lineHeight: 1.98,
        paragraphSpacing: 1.15,
        indent: false,
        theme: 'folio',
      },
    }).success,
    true,
  )
  assert.equal(formatArtifactSchema.safeParse({ html: ' ', removed: [] }).success, false)

  const note = {
    ...validNote,
    id: 'n1',
    bookId: 'b1',
    chapterId: null,
    author: 'ai' as const,
    edited: false,
    section: null,
    importance: 3,
    role: null,
    divergences: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  assert.equal(notesArtifactSchema.safeParse({ notes: [note], report: null }).success, true)
  assert.equal(notesArtifactSchema.safeParse({ notes: [] }).success, false)

  assert.equal(
    feynmanArtifactSchema.safeParse({
      explanation: '我的解释足够长。',
      result: { feedback: '讲得不错。', covered: ['观点'], missing: [], misconceptions: [] },
    }).success,
    true,
  )
  assert.equal(
    feynmanArtifactSchema.safeParse({
      explanation: '我的解释足够长。',
      result: { feedback: '', covered: '不是数组', missing: [], misconceptions: [] },
    }).success,
    false,
  )
})

test('invalid AI notes are rejected before replacing existing notes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-schema-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '校验测试', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '这是一段足够长的正文，用来验证笔记写入边界。', html: null }],
    )
    const chapter = getChapters(book.id)[0]!
    replaceAiNotes(chapter.id, [validNote])
    assert.equal(listNotes(book.id, chapter.id).length, 1)

    const invalid = { ...validNote, kind: 'not-a-kind' } as unknown as GeneratedNote
    assert.throws(() => replaceAiNotes(chapter.id, [invalid]), /笔记格式异常/)
    const notes = listNotes(book.id, chapter.id)
    assert.equal(notes.length, 1)
    assert.equal(notes[0]!.content, validNote.content)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
