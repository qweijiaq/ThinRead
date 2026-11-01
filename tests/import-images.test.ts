import assert from 'node:assert/strict'
import test from 'node:test'

import { inlineRemoteImages } from '../electron/parsers/url.js'
import { chaptersFromHtml } from '../electron/parsers/text-book.js'

test('keeps html images when splitting an imported article into chapters', () => {
  const chapters = chaptersFromHtml(
    '<h2>第一章</h2><p>这是第一章的正文，足够长，可以被识别成一个可阅读的章节。</p><img src="/images/one.png" alt="插图">' +
      '<h2>第二章</h2><p>这是第二章的正文，也足够长，不会被合并到上一章里。</p>',
    '测试文章',
  )
  assert.equal(chapters.length, 2)
  assert.equal(chapters[0]!.title, '第一章')
  assert.match(chapters[0]!.html ?? '', /<img[^>]+src="\/images\/one\.png"/)
  assert.equal(chapters[1]!.title, '第二章')
})

test('inlines remote article images as data urls and drops oversized ones', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).endsWith('/ok.png')) {
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '4' },
      })
    }
    return new Response(new Uint8Array(1024), {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': String(4 * 1024 * 1024) },
    })
  }) as typeof fetch
  try {
    const html = await inlineRemoteImages(
      '<p>正文</p><img src="/ok.png" alt="ok"><img src="/huge.png" alt="huge">',
      'https://example.com/article',
    )
    assert.match(html, /data:image\/png;base64,/i)
    assert.equal((html.match(/<img/g) ?? []).length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
