import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { auditXhsCoverage } from '../electron/ai/xhs-coverage.js'
import { installFetchReplay, uninstallFetchReplay } from '../electron/ai/replay.js'

function coverageResponse(): string {
  return JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify({
            missing: [{ chapterTitle: '第一章', point: '环境会改变默认选择', evidence: '环境本身也在替我们做决定' }],
          }),
        },
      },
    ],
  })
}

test('records real responses and replays them without the provider', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-ai-replay-'))
  const server = http.createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(coverageResponse())
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const config = {
    provider: 'openai' as const,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: 'mock-model',
    apiKey: 'test-key',
  }

  try {
    installFetchReplay({ recordDir: dir })
    const recorded = await auditXhsCoverage({
      config,
      demo: false,
      bookTitle: '环境之书',
      chapters: [{ id: 'c1', title: '第一章', text: '环境本身也在替我们做决定。' }],
      cards: [{ title: '意志力有限', content: '每一次抵抗都要消耗注意力。', chapterTitle: '第一章' }],
    })
    assert.equal(recorded.missing.length, 1)
    assert.ok(fs.readdirSync(dir).length > 0, '没有写出录制文件')

    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))

    // 服务已关闭，这次只能靠回放。
    installFetchReplay({ replayDir: dir })
    const replayed = await auditXhsCoverage({
      config,
      demo: false,
      bookTitle: '环境之书',
      chapters: [{ id: 'c1', title: '第一章', text: '环境本身也在替我们做决定。' }],
      cards: [{ title: '意志力有限', content: '每一次抵抗都要消耗注意力。', chapterTitle: '第一章' }],
    })
    assert.deepEqual(replayed, recorded)
  } finally {
    try {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    } catch {
      // 已经关闭。
    }
    uninstallFetchReplay()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('fails loudly when a replay fixture is missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-ai-replay-missing-'))
  installFetchReplay({ replayDir: dir })
  try {
    await assert.rejects(
      () =>
        auditXhsCoverage({
          config: { provider: 'openai', baseUrl: 'http://127.0.0.1:9/v1', model: 'm', apiKey: 'k' },
          demo: false,
          bookTitle: '书',
          chapters: [{ id: 'c1', title: '第一章', text: '没有录制的请求。' }],
          cards: [{ title: '卡片', content: '内容', chapterTitle: '第一章' }],
        }),
      /没有找到 AI 回放记录/,
    )
  } finally {
    uninstallFetchReplay()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
