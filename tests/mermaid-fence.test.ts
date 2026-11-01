import assert from 'node:assert/strict'
import test from 'node:test'

import { extractMermaidFences, hasMermaidFence, replaceMermaidFences } from '../src/lib/mermaid-fence.js'

const markdown = [
  '# 标题',
  '',
  '普通 `mermaid` 行内代码不算。',
  '',
  '```mermaid',
  'graph TD',
  '  A --> B',
  '```',
  '',
  '```ts',
  'const a = 1',
  '```',
  '',
  '~~~mermaid',
  'sequenceDiagram',
  '  A->>B: hi',
  '~~~',
  '',
].join('\n')

test('extracts mermaid fences only', () => {
  const fences = extractMermaidFences(markdown)
  assert.equal(fences.length, 2)
  assert.equal(fences[0]!.source, 'graph TD\n  A --> B\n')
  assert.equal(fences[1]!.source, 'sequenceDiagram\n  A->>B: hi\n')
  assert.equal(markdown.slice(fences[0]!.start, fences[0]!.end), '```mermaid\ngraph TD\n  A --> B\n```')
})

test('replaces fences in place and keeps other content', () => {
  const replaced = replaceMermaidFences(markdown, (source, index) => `[图 ${index + 1}: ${source.split('\n')[0]}]`)
  assert.match(replaced, /\[图 1: graph TD\]/)
  assert.match(replaced, /\[图 2: sequenceDiagram\]/)
  assert.match(replaced, /```ts\nconst a = 1\n```/)
  assert.doesNotMatch(replaced, /```mermaid/)
})

test('detects fences and ignores inline or other languages', () => {
  assert.equal(hasMermaidFence(markdown), true)
  assert.equal(hasMermaidFence('inline `mermaid` only'), false)
  assert.equal(hasMermaidFence('```ts\nconst x = 1\n```'), false)
})

test('handles CRLF fences', () => {
  const fences = extractMermaidFences('```mermaid\r\ngraph TD\r\n  A --> B\r\n```\r\n')
  assert.equal(fences.length, 1)
  assert.match(fences[0]!.source, /graph TD/)
})
