import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { readAiUsage } from '../electron/ai/usage.js'

test('aggregates local AI usage by day, model and step', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-usage-'))
  try {
    const traceDir = path.join(dir, 'ai-traces')
    fs.mkdirSync(traceDir)
    const today = new Date()
    const key = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
    fs.writeFileSync(
      path.join(traceDir, `${key}.jsonl`),
      [
        JSON.stringify({ at: new Date().toISOString(), step: 'chapter-notes', model: 'model-a', totalTokens: 100, ok: true }),
        JSON.stringify({ at: new Date().toISOString(), step: 'chapter-notes', model: 'model-a', totalTokens: 50, ok: true }),
        JSON.stringify({ at: new Date().toISOString(), step: 'lab-run', model: 'model-b', totalTokens: 25, ok: false }),
        'not-json',
      ].join('\n'),
      'utf8',
    )
    const usage = readAiUsage(dir, 30)
    assert.equal(usage.totalCalls, 3)
    assert.equal(usage.totalFailed, 1)
    assert.equal(usage.totalTokens, 175)
    assert.equal(usage.models[0]?.model, 'model-a')
    assert.equal(usage.models[0]?.tokens, 150)
    assert.equal(usage.steps.find((item) => item.step === 'lab-run')?.calls, 1)
    assert.equal(usage.days.at(-1)?.calls, 3)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
