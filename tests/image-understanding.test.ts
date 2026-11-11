import assert from 'node:assert/strict'
import test from 'node:test'

import { insertImageUnderstanding } from '../electron/image-understanding.js'

test('inserts image understanding after its figure and marks the image', () => {
  const src = 'data:image/png;base64,AAAA'
  const html = `<figure><img src="${src}" alt="Figure 1.1"><figcaption>Figure 1.1</figcaption></figure>`
  const result = insertImageUnderstanding(html, src, '图中展示了一个由输入到输出的流程。')
  assert.equal(result.understood, 1)
  assert.match(result.html, /class="image-understanding"/)
  assert.match(result.html, /data-image-understood="1"/)
  assert.match(result.html, /图中展示了一个由输入到输出的流程/)
  assert.ok(result.html.indexOf('image-understanding') > result.html.indexOf('</figure>'))
})

test('does not duplicate an existing image understanding', () => {
  const src = 'data:image/png;base64,AAAA'
  const html = `<p><img src="${src}" data-image-understood="1"></p>`
  const result = insertImageUnderstanding(html, src, '重复说明')
  assert.equal(result.understood, 0)
  assert.equal(result.skipped, 1)
  assert.doesNotMatch(result.html, /重复说明/)
})
