import assert from 'node:assert/strict'
import test from 'node:test'

import { clientRequestHeaders } from '../electron/ai/client-identity.js'
import { PROVIDER_PRESETS } from '../shared/types.js'

test('OpenCode requests carry a stable session id and a real user agent', () => {
  const headers = clientRequestHeaders('opencode-go')
  assert.match(headers['User-Agent'] ?? '', /^ThinRead\//)
  assert.match(headers['x-opencode-session'] ?? '', /^[0-9a-f-]{36}$/)
  assert.equal(clientRequestHeaders('opencode-go')['x-opencode-session'], headers['x-opencode-session'])
})

test('other providers keep the user agent but no OpenCode session header', () => {
  const headers = clientRequestHeaders('deepseek')
  assert.match(headers['User-Agent'] ?? '', /^ThinRead\//)
  assert.equal(headers['x-opencode-session'], undefined)
})

test('OpenDesign preset uses the Cloud Chat Completions endpoint', () => {
  const preset = PROVIDER_PRESETS.find((item) => item.id === 'opendesign')
  assert.ok(preset, '缺少 OpenDesign provider 预设')
  assert.equal(preset.baseUrl, 'https://amr-link.open-design.ai/v1')
  const headers = clientRequestHeaders('opendesign')
  assert.equal(headers['HTTP-Referer'], 'https://open-design.ai')
  assert.match(headers['User-Agent'] ?? '', /^ThinRead\//)
})
