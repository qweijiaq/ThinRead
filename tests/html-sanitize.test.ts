import assert from 'node:assert/strict'
import test from 'node:test'

import { cleanFormatHtml, sanitizeChapterHtml, stripEditorArtifacts } from '../electron/html.js'

test('collapses token-per-code pre blocks into one code element', () => {
  const html =
    '<pre><code class="language-js">const</code> <code>value</code> <code>=</code> <code>1</code></pre>'
  const normalized = sanitizeChapterHtml(html)
  assert.equal(normalized.match(/<code/g)?.length, 1)
  assert.equal(normalized.match(/const/g)?.length, 1)
  assert.match(normalized, /language-js/)
  assert.match(normalized, /const value = 1/)
})

test('keeps a normal single-code pre unchanged', () => {
  const html = '<pre><code class="language-ts">const value = 1</code></pre>'
  const normalized = sanitizeChapterHtml(html)
  assert.equal(normalized.match(/<code/g)?.length, 1)
  assert.match(normalized, /const value = 1/)
})


test('cleans decorative images, bullets and symbol-only blocks before formatting', () => {
  const large = 'data:image/png;base64,' + 'A'.repeat(3000)
  const html = [
    '<p>\u00a1</p>',
    '<p>12</p>',
    '<ul><li>\u00a1 Real point</li><li>\u25a0</li></ul>',
    '<p><img src="data:image/png;base64,AAAA" alt="tiny"></p>',
    '<table><tr><td>\u25a0 Precise matching \u25a0 Fast lookup</td></tr></table>',
    '<p><img src="' + large + '" alt="logo"></p>',
    '<figure><img src="' + large + '" alt="Figure 1.1"><figcaption>Figure 1.1 Architecture</figcaption></figure>',
    '<figure><img src="data:image/png;base64,AAAA"></figure>',
  ].join('')
  const cleaned = cleanFormatHtml(html)
  assert.doesNotMatch(cleaned, />\u00a1</)
  assert.doesNotMatch(cleaned, />12</)
  assert.match(cleaned, /Real point/)
  assert.doesNotMatch(cleaned, /\u25a0/)
  assert.match(cleaned, /Precise matching Fast lookup/)
  assert.doesNotMatch(cleaned, /alt="logo"/)
  assert.match(cleaned, /Figure 1.1 Architecture/)
  assert.equal(cleaned.match(/<figure/g)?.length, 1)
})

test('keeps inline image understanding blocks through cleanup and sanitization', () => {
  const html =
    '<figure><img src="data:image/png;base64,' +
    'A'.repeat(3000) +
    '" alt="Figure 1.1"><figcaption>Figure 1.1</figcaption></figure>' +
    '<aside class="image-understanding" data-image-understanding="abc"><div class="image-understanding-label">图片理解</div><p>图中展示了一个流程。</p></aside>'
  const cleaned = cleanFormatHtml(html)
  assert.match(cleaned, /class="image-understanding"/)
  assert.match(cleaned, /图中展示了一个流程/)
  const sanitized = sanitizeChapterHtml(cleaned)
  assert.match(sanitized, /<aside/)
  assert.match(sanitized, /image-understanding/)
  assert.match(sanitized, /图中展示了一个流程/)
})


test('strips reader-only controls before saving manually edited body', () => {
  const html =
    '<div class="code-block"><div class="code-block-head"><button>复制</button></div><pre><code>const x = 1</code></pre></div>' +
    '<span class="reader-image-wrap"><img src="data:image/png;base64,AAAA"><span class="reader-image-actions"><button>复制图片</button></span></span>' +
    '<p contenteditable="true">手动编辑</p>'
  const cleaned = stripEditorArtifacts(html)
  assert.doesNotMatch(cleaned, /<button/)
  assert.doesNotMatch(cleaned, /code-block-head/)
  assert.doesNotMatch(cleaned, /reader-image-wrap/)
  assert.match(cleaned, /<pre><code>const x = 1/)
  assert.match(cleaned, /<img/)
  assert.match(cleaned, /手动编辑/)
})
