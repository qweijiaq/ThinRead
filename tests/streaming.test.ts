import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { labChat } from '../electron/ai/lab.js'
import { askChapter, evaluateExplanation } from '../electron/ai/tutor.js'
import type { ModelConfig } from '../electron/ai/provider.js'
import { closeDatabase, getChapters, initDatabase, insertBook } from '../electron/db.js'

const config: ModelConfig = { provider: 'demo', baseUrl: '', model: 'demo', apiKey: null }
const context = {
  bookTitle: '流式测试',
  chapterTitle: '第一章',
  chapterText: '注意力不是无限的。把手机移出视线可以减少一次选择。环境设计不能代替目标选择。',
  condensed: '注意力有限，环境设计能降低摩擦，但不能代替目标。',
  cards: [{ title: '环境设计', content: '把手机移出视线。', role: '支撑', quote: '把手机移出视线' }],
}

test('tutor demo streams the answer to the delta callback', async () => {
  const deltas: string[] = []
  const answer = await askChapter(
    { config, demo: true, context, question: '这一章说了什么？', history: [], mode: 'answer' },
    (text) => deltas.push(text),
  )
  assert.ok(answer.answer.length > 0)
  assert.ok(deltas.length > 0)
  assert.equal(deltas.at(-1), answer.answer)
})

test('feynman demo streams the feedback to the delta callback', async () => {
  const deltas: string[] = []
  const result = await evaluateExplanation(
    {
      config,
      demo: true,
      context,
      explanation: '这一章说注意力有限，所以要把手机放到别处，减少做选择的次数。',
    },
    (text) => deltas.push(text),
  )
  assert.ok(result.feedback.length > 0)
  assert.equal(deltas.at(-1), result.feedback)
})

test('lab chat demo streams the answer to the delta callback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-stream-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '对话测试', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '注意力有限，环境设计可以减少一次选择。', html: null }],
    )
    const chapterId = getChapters(book.id)[0]!.id
    const deltas: string[] = []
    const answer = await labChat(
      {
        config,
        demo: true,
        request: { tool: 'devils-advocate', chapterId, question: '请挑战这一章。' },
        history: [],
      },
      (text) => deltas.push(text),
    )
    assert.ok(answer.answer.length > 0)
    assert.equal(deltas.at(-1), answer.answer)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
