import assert from 'node:assert/strict'
import test from 'node:test'
import { unzipSync, strFromU8 } from 'fflate'

import { bookHtmlFilename, bookPdfFilename } from '../src/lib/blog-export.js'
import { buildPublishPackage } from '../src/lib/publish-package.js'

const COVER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII='

const base = {
  bookTitle: '测试书',
  author: '作者',
  title: '测试书：一条线索',
  markdown: '# 标题\n\n导语。\n\n## 第一节\n\n正文。\n\n## 第二节\n\n更多。',
  description: '这是一个摘要。',
  date: '2026-10-31',
  coverDataUrl: COVER,
  includeMarkdown: true,
  coverStyle: 'ink' as const,
}

test('builds a complete publish package', async () => {
  const pkg = await buildPublishPackage({ ...base, includeCover: true })
  const files = unzipSync(pkg.archive)
  const html = strFromU8(files['index.html']!)
  const metadata = JSON.parse(strFromU8(files['metadata.json']!)) as Record<string, unknown>
  assert.deepEqual(Object.keys(files).sort(), ['README.txt', 'cover.png', 'index.html', 'metadata.json', 'notes.md'])
  assert.match(html, /class="publish-cover"/)
  assert.match(html, /property="og:image"/)
  assert.match(html, /class="toc"/)
  assert.equal(metadata.coverStyle, 'ink')
  assert.equal(metadata.cover, 'cover.png')
  assert.equal([...html.matchAll(/(?:src|href)="(https?:\/\/[^\"]+)"/g)].length, 0)
})

test('omits cover and markdown when disabled', async () => {
  const pkg = await buildPublishPackage({ ...base, includeCover: false, includeMarkdown: false })
  const files = unzipSync(pkg.archive)
  assert.equal(files['cover.png'], undefined)
  assert.equal(files['notes.md'], undefined)
  assert.doesNotMatch(strFromU8(files['index.html']!), /class="publish-cover"/)
})

test('keeps mermaid blocks as code when the renderer has no DOM', async () => {
  const markdown = `${base.markdown}\n\n\`\`\`mermaid\ngraph TD\n  A --> B\n\`\`\`\n`
  const pkg = await buildPublishPackage({ ...base, includeCover: false, markdown })
  const html = strFromU8(unzipSync(pkg.archive)['index.html']!)
  assert.match(html, /class="language-mermaid"/)
  assert.doesNotMatch(html, /<svg/)
})

test('uses the same base name for HTML and PDF exports', () => {
  const title = '一本/书: 名字'
  const html = bookHtmlFilename(title)
  assert.match(html, /\.html$/)
  assert.equal(bookPdfFilename(title), html.replace(/\.html$/, '.pdf'))
})
