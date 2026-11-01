import assert from 'node:assert/strict'
import test from 'node:test'

import { renderMermaidInHtml } from '../src/lib/mermaid-html.js'

test('leaves HTML without mermaid blocks untouched', async () => {
  const html = '<article><pre><code class="language-ts">const a = 1</code></pre></article>'
  assert.equal(await renderMermaidInHtml(html), html)
})

test('keeps the original code block when SVG rendering is unavailable', async () => {
  // Node 里没有 document，mermaid.render 会失败；导出辅助函数应当静默回退到代码块。
  const html = '<article><pre><code class="language-mermaid">graph TD\n  A --&gt; B</code></pre></article>'
  const result = await renderMermaidInHtml(html)
  assert.match(result, /class="language-mermaid"/)
  assert.match(result, /graph TD/)
  assert.doesNotMatch(result, /<svg/)
})

test('replaces mermaid code blocks with inline SVG', async () => {
  const html =
    '<article><p>前文</p><pre><code class="language-mermaid">graph TD\n  A --&gt; B</code></pre><p>后文</p></article>'
  const result = await renderMermaidInHtml(html, async (source) => {
    assert.equal(source, 'graph TD\n  A --> B')
    return '<svg viewBox="0 0 10 10"><text>A</text></svg>'
  })
  assert.match(result, /<div class="mermaid-diagram"><svg viewBox="0 0 10 10">/)
  assert.doesNotMatch(result, /language-mermaid/)
  assert.match(result, /前文/)
  assert.match(result, /后文/)
})

test('keeps the code block when the injected renderer throws', async () => {
  const html = '<article><pre><code class="language-mermaid">not a diagram</code></pre></article>'
  const result = await renderMermaidInHtml(html, async () => {
    throw new Error('parse failed')
  })
  assert.equal(result, html)
})
