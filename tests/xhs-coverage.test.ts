import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { auditXhsCoverage } from '../electron/ai/xhs-coverage.js'

test('audits missing knowledge points through an OpenAI-compatible endpoint', async () => {
  const server = http.createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                missing: [
                  {
                    chapterTitle: '第一章',
                    point: '环境会改变默认选择',
                    evidence: '环境本身也在替我们做决定',
                  },
                ],
              }),
            },
          },
        ],
      }),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  try {
    const result = await auditXhsCoverage({
      config: {
        provider: 'openai',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'mock-model',
        apiKey: 'test-key',
      },
      demo: false,
      bookTitle: '环境之书',
      chapters: [{ id: 'c1', title: '第一章', text: '环境本身也在替我们做决定。把手机放到另一个房间。' }],
      cards: [{ title: '意志力有限', content: '每一次抵抗都要消耗注意力。', chapterTitle: '第一章' }],
    })
    assert.equal(result.checkedChapters, 1)
    assert.equal(result.missing.length, 1)
    assert.equal(result.missing[0]?.chapterId, 'c1')
    assert.match(result.missing[0]?.point ?? '', /环境/)
  } finally {
    server.close()
  }
})
