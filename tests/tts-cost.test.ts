import assert from 'node:assert/strict'
import test from 'node:test'

import { estimateSpeechCost } from '../src/lib/tts-cost.js'

test('estimates speech cost from characters and price per 1K characters', () => {
  assert.equal(estimateSpeechCost(0, 1), null)
  assert.equal(estimateSpeechCost(1200, 0), null)
  assert.equal(estimateSpeechCost(1200, 1), 1.2)
  assert.equal(estimateSpeechCost(1234, 0.5), 0.617)
  assert.equal(estimateSpeechCost(-10, 1), null)
  assert.equal(estimateSpeechCost(Number.NaN, 1), null)
})
