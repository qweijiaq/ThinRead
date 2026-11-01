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
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).includes('/api/v3/list/')) {
      return new Response(JSON.stringify({ errors: 'Not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ count: 0, nextPageCursor: null, results: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  try {
    assert.deepEqual(await fetchReadwiseEntries('token-123'), [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('maps Reader v3 highlight documents back to their parent book', async () => {
  const originalFetch = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = (async (url: string | URL | Request) => {
    urls.push(String(url))
    if (String(url).includes('/api/v3/list/')) {
      return new Response(
        JSON.stringify({
          count: 3,
          nextPageCursor: null,
          results: [
            { id: 'p1', title: '专注的练习', author: '测试作者', category: 'epub' },
            {
              id: 'h1',
              parent_id: 'p1',
              category: 'highlight',
              title: '专注不是意志力，而是环境设计。',
              notes: '先改环境。',
              tags: [{ name: '专注' }],
            },
            { id: 'h2', parent_id: 'p1', category: 'highlight', title: '缩短发现分心的时间。', tags: ['习惯'] },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ count: 0, nextPageCursor: null, results: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  try {
    const entries = await fetchReadwiseEntries('token-123')
    assert.ok(urls.some((url) => url.includes('/api/v3/list/')))
    assert.equal(entries.length, 2)
    assert.equal(entries[0]!.title, '专注的练习')
    assert.equal(entries[0]!.author, '测试作者')
    assert.equal(entries[0]!.text, '专注不是意志力，而是环境设计。')
    assert.equal(entries[0]!.note, '先改环境。')
    assert.deepEqual(entries[0]!.tags, ['专注'])
    assert.deepEqual(entries[1]!.tags, ['习惯'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('reads Reader highlights when the v2 export returns 404', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).includes('/api/v3/list/')) {
      return new Response(
        JSON.stringify({
          nextPageCursor: null,
          results: [
            { id: 'p1', title: '置身事内', author: '兰小欢', category: 'epub' },
            { id: 'h1', parent_id: 'p1', category: 'highlight', title: '地方政府掌握大量资源。' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ errors: 'Not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  try {
    const entries = await fetchReadwiseEntries('reader-token')
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.title, '置身事内')
    assert.equal(entries[0]!.author, '兰小欢')
    assert.equal(entries[0]!.text, '地方政府掌握大量资源。')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('merges v2 and Reader highlights without duplicates', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).includes('/api/v3/list/')) {
      return new Response(
        JSON.stringify({
          nextPageCursor: null,
          results: [
            { id: 'p1', title: '原则', author: '瑞·达利欧', category: 'epub' },
            { id: 'h1', parent_id: 'p1', category: 'highlight', title: '共同划线' },
            { id: 'h2', parent_id: 'p1', category: 'highlight', title: 'Reader 独有划线' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(
      JSON.stringify({
        nextPageCursor: null,
        results: [
          {
            title: '原则',
            author: '瑞·达利欧',
            highlights: [{ text: '共同划线', location: 12 }],
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
  try {
    const entries = await fetchReadwiseEntries('token-123')
    assert.deepEqual(
      entries.map((entry) => entry.text),
      ['共同划线', 'Reader 独有划线'],
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('reports a friendly error when both Readwise sources fail', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ detail: 'Invalid token' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
  try {
    await assert.rejects(
      () => fetchReadwiseEntries('secret-token'),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /Readwise 同步失败/)
        assert.match(error.message, /Reader/)
        assert.doesNotMatch(error.message, /secret-token/)
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('requires a token before calling Readwise', async () => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = (async () => {
    called = true
    throw new Error('unexpected fetch')
  }) as typeof fetch
  try {
    await assert.rejects(() => fetchReadwiseEntries('   '), /Token/)
    assert.equal(called, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
