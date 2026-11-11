import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { createCanvas } from '@napi-rs/canvas'

import { generateChapterNotes } from '../electron/ai/notes.js'

function imageDataUrl(): string {
  const canvas = createCanvas(240, 160)
  const context = canvas.getContext('2d')
  context.fillStyle = '#2f4f9e'
  context.fillRect(0, 0, 240, 160)
  context.fillStyle = '#ffffff'
  context.font = '24px sans-serif'
  context.fillText('figure', 24, 84)
  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`
}

function chatResponse(content: string): string {
  return JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] })
}

test('sends chapter images as vision input for read-thin and cards', async () => {
  const requests: string[] = []
  let count = 0
  const server = http.createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      requests.push(body)
      count++
      const content =
        count === 1
          ? JSON.stringify({
              compressed: '注意力有限，环境设计比意志力更可靠。图表说明了这一对比。',
              omitted: [],
            })
          : JSON.stringify({
              cards: [
                {
                  point: '环境设计比意志力更可靠',
                  role: '支撑核心结论',
                  evidence: '注意力有限，环境设计比意志力更可靠。',
                  section: '第一节',
                  concepts: ['环境设计'],
                  importance: 5,
                },
                {
                  point: '图表展示了注意力与环境的对比',
                  role: '提供视觉证据',
                  evidence: '图1 对比',
                  section: '第一节',
                  concepts: ['图表'],
                  importance: 4,
                },
              ],
            })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(chatResponse(content))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  try {
    const result = await generateChapterNotes(
      {
        bookTitle: '视觉测试',
        chapterTitle: '注意力与环境',
        chapterText: '注意力有限，环境设计比意志力更可靠。',
        chapterHtml: [
          '<h2>第一节</h2><p>注意力有限，环境设计比意志力更可靠。</p>',
          `<figure><img src="${imageDataUrl()}" alt="注意力对比图"><figcaption>图1 对比</figcaption></figure>`,
        ].join(''),
        config: {
          provider: 'openai',
          baseUrl: `http://127.0.0.1:${port}/v1`,
          model: 'gpt-4o',
          apiKey: 'test-key',
        },
        demo: false,
        mode: 'fast',
        visionMode: 'always',
      },
      () => undefined,
      new AbortController().signal,
    )

    assert.ok(requests.length >= 2)
    const withImage = requests.filter((body) => /data:image\/jpeg;base64/.test(body))
    assert.ok(withImage.length >= 2, `图片没有进入读薄和卡片请求：${requests.length} 次请求`)
    assert.ok(requests.some((body) => body.includes('图1 对比')))
    assert.equal(result.report.visionUsed, true)
    assert.ok((result.report.images ?? 0) >= 1)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})
