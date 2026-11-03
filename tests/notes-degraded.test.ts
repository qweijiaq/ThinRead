import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { generateChapterNotes } from '../electron/ai/notes.js'
import type { ModelConfig } from '../electron/ai/provider.js'
import {
  closeDatabase,
  getChapter,
  getChapters,
  initDatabase,
  insertBook,
  saveNoteReport,
} from '../electron/db.js'
import type { NoteReport } from '../shared/types.js'

const CHAPTER_HTML = [
  '<h2>第一节</h2><p>注意力不是无限的，每一次切换任务都会留下认知残留，所以环境设计比意志力更可靠。</p>',
  '<h2>第二节</h2><p>阅读要回到原文核对前提，证据和主张对得上，卡片才值得保存，否则只是在收集结论。</p>',
].join('')

interface MockServer {
  port: number
  close(): Promise<void>
  requests(): number
}

function chatResponse(content: string): string {
  return JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] })
}

/**
 * 第一个请求返回有效读薄稿，其余请求返回 400（不可重试，测试更快）。
 * 用来模拟“部分小节成功、后续步骤全部失败”的真实降级场景。
 */
async function startMockServer(mode: 'all-fail' | 'first-ok'): Promise<MockServer> {
  let count = 0
  const server = http.createServer((request, response) => {
    request.resume()
    count++
    if (mode === 'first-ok' && count === 1) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(chatResponse(JSON.stringify({ compressed: '注意力有限，环境设计比意志力可靠。', omitted: [] })))
      return
    }
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'mock provider failure' } }))
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    port,
    requests: () => count,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

function modelConfig(port: number): ModelConfig {
  return {
    provider: 'openai',
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: 'mock-model',
    apiKey: 'test-key',
  }
}

async function generate(port: number) {
  return generateChapterNotes(
    {
      bookTitle: '注意力',
      chapterTitle: '环境设计',
      chapterText: '注意力不是无限的。每一次切换任务都会留下认知残留。环境设计比意志力更可靠。阅读要回到原文核对前提。',
      chapterHtml: CHAPTER_HTML,
      config: modelConfig(port),
      demo: false,
    },
    () => undefined,
    new AbortController().signal,
  )
}

test('全部读薄失败时直接报错，不写出一份“看起来成功”的笔记', async () => {
  const server = await startMockServer('all-fail')
  try {
    await assert.rejects(() => generate(server.port), /读薄失败/)
    assert.ok(server.requests() >= 1)
  } finally {
    await server.close()
  }
})

test('部分步骤失败时结果标记为降级，并保留可用的部分', async () => {
  const server = await startMockServer('first-ok')
  try {
    const result = await generate(server.port)
    const stages = (result.report.degraded ?? []).map((step) => step.stage)
    assert.ok(stages.includes('condense'), `缺少 condense 降级标记：${stages.join(',')}`)
    assert.ok(stages.includes('extract-cards'), `缺少 extract-cards 降级标记：${stages.join(',')}`)
    assert.equal(result.report.degraded?.find((step) => step.stage === 'condense')?.failed, 1)
    // 卡片提炼失败时退回本地启发式卡片，但结果仍然可用。
    assert.ok(result.notes.length > 0)
  } finally {
    await server.close()
  }
})

test('降级标记会随报告一起持久化，重开章节仍能看到', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-degraded-'))
  try {
    initDatabase(dir)
    const book = insertBook(
      { title: '降级测试', author: '作者', format: 'text', filePath: path.join(dir, 'source.txt') },
      [{ title: '第一章', text: '注意力有限，环境设计比意志力更可靠。', html: null }],
    )
    const chapterId = getChapters(book.id)[0]!.id
    const report: NoteReport = {
      originalChars: 20,
      condensedChars: 10,
      ratio: 2,
      sections: 1,
      cards: 0,
      divergences: 0,
      fidelityMissing: 0,
      omitted: 0,
      durationMs: 1200,
      mode: 'standard',
      promptVersion: 'notes-v5',
      degraded: [{ stage: 'condense', failed: 1, total: 2, message: 'mock failure' }],
      model: 'mock-model',
      createdAt: new Date().toISOString(),
    }
    saveNoteReport(chapterId, report)
    const reloaded = getChapter(chapterId).noteReport
    assert.equal(reloaded?.mode, 'standard')
    assert.equal(reloaded?.degraded?.length, 1)
    assert.equal(reloaded?.degraded?.[0]?.stage, 'condense')
    assert.equal(reloaded?.degraded?.[0]?.total, 2)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
