import fs from 'node:fs'
import path from 'node:path'

import type { AiUsageSummary } from '../../shared/types.js'

interface TraceLine {
  at?: string
  step?: string
  model?: string
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  ok?: boolean
}

function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function traceDateKey(name: string): string | null {
  const match = name.match(/^(\d{4})(\d{2})(\d{2})\.jsonl$/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

/**
 * 读取 ai-traces/*.jsonl 做本地用量汇总。只统计步骤、模型、token 和失败次数，
 * 不读取 prompt 或正文；文件不存在时返回空汇总。
 */
export function readAiUsage(dataDir: string, days = 30): AiUsageSummary {
  const span = Math.min(Math.max(Math.floor(Number(days) || 30), 1), 365)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - span + 1)
  const startKey = dateKey(start)
  const daysMap = new Map<string, { calls: number; failed: number; tokens: number }>()
  const models = new Map<string, { calls: number; tokens: number }>()
  const steps = new Map<string, { calls: number; tokens: number }>()
  let totalCalls = 0
  let totalFailed = 0
  let totalTokens = 0

  const dir = path.join(dataDir, 'ai-traces')
  let names: string[] = []
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl'))
  } catch {
    names = []
  }

  for (const name of names) {
    const fileDay = traceDateKey(name)
    if (fileDay && fileDay < startKey) continue
    let text = ''
    try {
      text = fs.readFileSync(path.join(dir, name), 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let entry: TraceLine
      try {
        entry = JSON.parse(line) as TraceLine
      } catch {
        continue
      }
      const day = (entry.at ? dateKey(new Date(entry.at)) : fileDay) ?? fileDay
      if (!day || day < startKey || day > dateKey(today)) continue
      const tokens = Math.max(
        0,
        Math.floor(Number(entry.totalTokens) || (Number(entry.inputTokens) || 0) + (Number(entry.outputTokens) || 0)),
      )
      const failed = entry.ok === false ? 1 : 0
      const dayRow = daysMap.get(day) ?? { calls: 0, failed: 0, tokens: 0 }
      dayRow.calls += 1
      dayRow.failed += failed
      dayRow.tokens += tokens
      daysMap.set(day, dayRow)
      const model = entry.model?.trim() || '未知模型'
      const modelRow = models.get(model) ?? { calls: 0, tokens: 0 }
      modelRow.calls += 1
      modelRow.tokens += tokens
      models.set(model, modelRow)
      const step = entry.step?.trim() || 'unknown'
      const stepRow = steps.get(step) ?? { calls: 0, tokens: 0 }
      stepRow.calls += 1
      stepRow.tokens += tokens
      steps.set(step, stepRow)
      totalCalls += 1
      totalFailed += failed
      totalTokens += tokens
    }
  }

  const daysOut: AiUsageSummary['days'] = []
  for (let offset = 0; offset < span; offset++) {
    const date = new Date(start)
    date.setDate(start.getDate() + offset)
    const key = dateKey(date)
    const row = daysMap.get(key) ?? { calls: 0, failed: 0, tokens: 0 }
    daysOut.push({ date: key, ...row })
  }

  return {
    days: daysOut,
    models: [...models.entries()]
      .map(([model, row]) => ({ model, ...row }))
      .sort((a, b) => b.tokens - a.tokens || b.calls - a.calls)
      .slice(0, 12),
    steps: [...steps.entries()]
      .map(([step, row]) => ({ step, ...row }))
      .sort((a, b) => b.tokens - a.tokens || b.calls - a.calls)
      .slice(0, 12),
    totalCalls,
    totalFailed,
    totalTokens,
  }
}
