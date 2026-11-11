import assert from 'node:assert/strict'
import test from 'node:test'

import { nonThinkingProviderOptions } from '../electron/ai/provider.js'

const base = { baseUrl: 'https://example.com/v1', model: 'deepseek-v4.1-flash', apiKey: 'test' }

test('disables DeepSeek thinking for structured reading tasks', () => {
  for (const provider of ['deepseek', 'opencode', 'opencode-go'] as const) {
    const options = nonThinkingProviderOptions({ ...base, provider })
    const key = provider === 'opencode-go' ? 'opencodeGo' : provider
    assert.deepEqual(options, { [key]: { thinking: { type: 'disabled' } } })
  }
})

test('leaves other models and providers alone', () => {
  assert.equal(nonThinkingProviderOptions({ ...base, provider: 'openai', model: 'deepseek-v4.1-flash' }), undefined)
  assert.equal(nonThinkingProviderOptions({ ...base, provider: 'opencode-go', model: 'gpt-6-luna' }), undefined)
})
