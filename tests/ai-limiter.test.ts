import assert from 'node:assert/strict'
import test from 'node:test'

import { createLimiter } from '../electron/ai/limiter.js'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('limiter never runs more than the configured number of tasks', async () => {
  const limiter = createLimiter(2)
  let active = 0
  let maxActive = 0
  const finished: number[] = []

  await Promise.all(
    Array.from({ length: 7 }, (_, index) =>
      (async () => {
        const release = await limiter.acquire()
        active += 1
        maxActive = Math.max(maxActive, active)
        await delay(5)
        active -= 1
        finished.push(index)
        release()
      })(),
    ),
  )

  assert.ok(maxActive <= 2, `max concurrency was ${maxActive}`)
  assert.equal(finished.length, 7)
  assert.equal(limiter.active(), 0)
})

test('release is idempotent and wakes the next waiter', async () => {
  const limiter = createLimiter(1)
  const release = await limiter.acquire()
  let nextStarted = false
  const next = limiter.acquire().then((releaseNext) => {
    nextStarted = true
    releaseNext()
  })
  assert.equal(nextStarted, false)
  release()
  release()
  await next
  assert.equal(nextStarted, true)
  assert.equal(limiter.active(), 0)
})
