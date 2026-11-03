import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { initLogger, logDir, logError, logInfo, logWarn, readRecentLogs } from '../electron/logger.js'

function readEntries(): Array<Record<string, unknown>> {
  return readRecentLogs()
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

test('writes structured log lines to the data directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-log-'))
  try {
    initLogger(dir)
    assert.equal(logDir(), path.join(dir, 'logs'))
    logInfo('test', 'hello', { books: 3 })
    logWarn('test', 'careful')
    logError('test', new Error('boom'))

    const entries = readEntries()
    assert.ok(entries.some((entry) => entry.scope === 'test' && entry.message === 'hello' && entry.books === 3))
    assert.ok(entries.some((entry) => entry.level === 'warn' && entry.message === 'careful'))
    const errorEntry = entries.find((entry) => entry.level === 'error' && entry.message === 'boom')
    assert.ok(errorEntry)
    assert.equal(errorEntry?.name, 'Error')
    assert.match(String(errorEntry?.stack), /boom/)
    // 每条都是合法 JSON，诊断包可以直接读取。
    assert.ok(fs.readdirSync(path.join(dir, 'logs')).some((name) => /^app-\d{8}\.log$/.test(name)))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('truncates oversized messages instead of writing megabytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-log-long-'))
  try {
    initLogger(dir)
    logInfo('test', 'x'.repeat(5000))
    const entry = readEntries().find((item) => item.scope === 'test')
    assert.ok(entry)
    assert.ok(String(entry?.message).length <= 2010)
    assert.match(String(entry?.message), /已截断/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('logging never throws', () => {
  // 日志是诊断信息，写入失败也不能把主流程带崩。
  assert.doesNotThrow(() => {
    logInfo('test', 'still fine')
    logWarn('test', 'still fine')
    logError('test', new Error('still fine'))
  })
})
