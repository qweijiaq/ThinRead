import assert from 'node:assert/strict'
import test from 'node:test'

import { backoffDelay, isRetryableError, retryWithBackoff } from '../electron/ai/retry.js'

test('treats rate limits and 5xx as retryable', () => {
  assert.equal(isRetryableError({ status: 429 }), true)
  assert.equal(isRetryableError({ status: 503 }), true)
  assert.equal(isRetryableError(new Error('fetch failed')), true)
  assert.equal(isRetryableError(new Error('请求超时（60 秒）')), true)
})

test('does not retry auth or validation errors', () => {
  assert.equal(isRetryableError({ status: 401 }), false)
  assert.equal(isRetryableError({ status: 400 }), false)
  assert.equal(isRetryableError(new Error('invalid api key')), false)
})

test('backoff grows and stays within the cap', () => {
  const first = backoffDelay(0)
  const later = backoffDelay(5)
  assert.ok(first >= 480 && first <= 1280)
  assert.ok(later <= 15_000)
  assert.ok(later > first)
})

test('retries only retryable failures and stops on success', async () => {
  let calls = 0
  const result = await retryWithBackoff(
    async () => {
      calls += 1
      if (calls < 2) throw Object.assign(new Error('rate limit'), { status: 429 })
      return 'ok'
    },
    { attempts: 3, baseMs: 1, capMs: 2 },
  )
  assert.equal(result, 'ok')
  assert.equal(calls, 2)
})

test('does not retry a non-retryable failure', async () => {
  let calls = 0
  await assert.rejects(
    retryWithBackoff(
      async () => {
        calls += 1
        throw Object.assign(new Error('unauthorized'), { status: 401 })
      },
      { attempts: 3, baseMs: 1 },
    ),
  )
  assert.equal(calls, 1)
})
