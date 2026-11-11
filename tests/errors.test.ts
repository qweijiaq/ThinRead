import assert from 'node:assert/strict'
import test from 'node:test'

import { messageOf } from '../src/lib/errors.js'

test('turns common provider errors into actionable messages', () => {
  assert.match(messageOf(new Error('401 Unauthorized')), /API Key/)
  assert.match(messageOf(new Error('insufficient quota')), /余额|额度/)
  assert.match(messageOf(new Error('model not found')), /模型/)
  assert.match(messageOf(new Error('context length exceeded')), /上下文/)
  assert.match(messageOf(new Error('model does not support image input')), /图片/)
  assert.match(messageOf(new Error('fetch failed')), /网络/)
})
