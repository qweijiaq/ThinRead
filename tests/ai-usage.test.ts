import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { readAiUsage } from '../electron/ai/usage.js'

test('subscription providers count tokens without inventing per-token cost', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-usage-sub-'))
  try {
    const traceDir = path.join(dir, 'ai-traces')
    fs.mkdirSync(traceDir)
    const today = new Date()
    const key = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
    fs.writeFileSync(
      path.join(traceDir, `${key}.jsonl`),
      JSON.stringify({
        at: new Date().toISOString(),
        step: 'condense',
        provider: 'opencode-go',
        model: 'deepseek-v4.1-flash',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        totalTokens: 2_000_000,
        ok: true,
      }),
      'utf8',
    )
    const usage = readAiUsage(dir, 30, { 'deepseek-v4.1-flash': { inputPerMTokens: 2, outputPerMTokens: 8 } })
    assert.equal(usage.totalTokens, 2_000_000)
    assert.equal(usage.totalCost, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

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
        JSON.stringify({
          at: new Date().toISOString(),
          step: 'condense',
          model: 'model-a',
          inputTokens: 60,
          outputTokens: 40,
          totalTokens: 100,
          ok: true,
        }),
        JSON.stringify({ at: new Date().toISOString(), step: 'condense', model: 'model-a', totalTokens: 50, ok: true }),
        JSON.stringify({ at: new Date().toISOString(), step: 'lab-run', model: 'model-b', totalTokens: 25, ok: false }),
        // 汇总行不能重复计入 token。
        JSON.stringify({ at: new Date().toISOString(), step: 'chapter-notes', model: 'model-a', totalTokens: 999, aggregate: true, ok: true }),
        // 缓存命中不算调用，只记录省下的 token。
        JSON.stringify({ at: new Date().toISOString(), step: 'chapter-notes', model: 'model-a', cached: true, cachedTokens: 500, ok: true }),
        'not-json',
      ].join('\n'),
      'utf8',
    )
    const usage = readAiUsage(dir, 30, { 'model-a': { inputPerMTokens: 1, outputPerMTokens: 2 } })
    assert.equal(usage.totalCalls, 3)
    assert.equal(usage.totalFailed, 1)
    assert.equal(usage.totalTokens, 175)
    assert.equal(usage.totalInputTokens, 60)
    assert.equal(usage.totalOutputTokens, 40)
    assert.equal(usage.totalCost, (60 / 1_000_000) * 1 + (40 / 1_000_000) * 2)
    assert.equal(usage.totalCacheHits, 1)
    assert.equal(usage.totalCacheTokens, 500)
    assert.equal(usage.totalCacheSavings, (500 / 1_000_000) * 1)
    assert.equal(usage.models[0]?.model, 'model-a')
    assert.equal(usage.models[0]?.tokens, 150)
    assert.equal(usage.steps.find((item) => item.step === 'lab-run')?.calls, 1)
    assert.equal(usage.steps.find((item) => item.step === 'chapter-notes')?.calls, 0)
    assert.equal(usage.steps.find((item) => item.step === 'chapter-notes')?.cacheHits, 1)
    assert.equal(usage.days.at(-1)?.calls, 3)
    assert.equal(usage.days.at(-1)?.cacheHits, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
