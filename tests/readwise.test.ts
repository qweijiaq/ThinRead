import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchReadwiseEntries } from '../electron/readwise.js'

test('maps Readwise export books and highlights', async () => {
  const originalFetch = globalThis.fetch
  let authorization = ''
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    authorization = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '')
    return new Response(
      JSON.stringify({
        results: [
          {
            title: '专注的练习',
            author: '测试作者',
            highlights: [
              { text: '专注不是意志力，而是环境设计。', note: '先改环境。', tags: [{ name: '专注' }], location: 12 },
              { text: '缩短发现分心的时间。', tags: ['习惯'], location: 18 },
            ],
          },
        ],
        nextPageCursor: null,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
  try {
    const entries = await fetchReadwiseEntries('token-123')
    assert.equal(authorization, 'Token token-123')
    assert.equal(entries.length, 2)
    assert.equal(entries[0]!.title, '专注的练习')
    assert.equal(entries[0]!.author, '测试作者')
    assert.deepEqual(entries[0]!.tags, ['专注'])
    assert.equal(entries[1]!.tags[0], '习惯')
    assert.equal(entries[1]!.location, '18')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('returns an empty list when the account has no Readwise highlights', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    if (calls === 1) {
      return new Response(JSON.stringify({ count: 0, nextPageCursor: null, results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ errors: 'Not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  try {
    assert.deepEqual(await fetchReadwiseEntries('token-123'), [])
  } finally {
    globalThis.fetch = originalFetch
  }
})
