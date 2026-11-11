import assert from 'node:assert/strict'
import test from 'node:test'

import { insertCodeUnderstanding, replaceCodeBlock } from '../electron/ai/code-assist.js'

test('inserts code explanation after the matching code block', () => {
  const code = 'def add(a, b):\n    return a + b'
  const html = `<pre><code>${code.replace('\n', '\n')}</code></pre>`
  const result = insertCodeUnderstanding(html, code, '这段代码定义了一个加法函数。')
  assert.equal(result.understood, 1)
  assert.match(result.html ?? '', /class="code-understanding"/)
  assert.match(result.html ?? '', /data-code-understood="1"/)
  assert.ok((result.html ?? '').indexOf('code-understanding') > (result.html ?? '').indexOf('</pre>'))
})

test('skips a code block that was already explained', () => {
  const code = 'const value = 1'
  const html = `<pre data-code-understood="1"><code>${code}</code></pre>`
  const result = insertCodeUnderstanding(html, code, '重复说明')
  assert.equal(result.understood, 0)
  assert.equal(result.skipped, 1)
  assert.doesNotMatch(result.html ?? '', /重复说明/)
})


test('replaces code and removes stale explanation when fixed', () => {
  const code = 'const x = 1'
  const html =
    '<pre data-code-understood="1"><code>' +
    code +
    '</code></pre><aside class="code-understanding"><p>旧说明</p></aside>'
  const result = replaceCodeBlock(html, code, 'const x = 2')
  assert.equal(result.changed, true)
  assert.match(result.html ?? '', /const x = 2/)
  assert.doesNotMatch(result.html ?? '', /data-code-understood/)
  assert.doesNotMatch(result.html ?? '', /旧说明/)
})
