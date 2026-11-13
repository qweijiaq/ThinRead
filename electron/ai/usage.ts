import fs from 'node:fs'
import path from 'node:path'

import type { AiModelPrice, AiModelPricing, AiUsageRow, AiUsageSummary } from '../../shared/types.js'

interface TraceLine {
  at?: string
  step?: string
  provider?: string
  model?: string
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  aggregate?: boolean
  cached?: boolean
  cachedTokens?: number
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

function emptyRow(): AiUsageRow {
  return {
    calls: 0,
    failed: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    cacheHits: 0,
    cacheTokens: 0,
    cacheSavings: 0,
  }
}

function priceOf(pricing: AiModelPricing, model: string, provider?: string): AiModelPrice | null {
  // OpenCode Go 是订阅制，不按 token 计费；只统计 token，不估算金额。
  if (provider === 'opencode-go' || provider === 'opendesign') return null
  const direct = pricing[model]
  if (direct) return direct
  const key = Object.keys(pricing).find((item) => item.toLowerCase() === model.toLowerCase())
  return key ? pricing[key] ?? null : null
}

/** 价格按人民币 / 百万 token 填写；没有价格时返回 0，不猜测。 */
export function estimateTokenCost(inputTokens: number, outputTokens: number, price: AiModelPrice | null): number {
  if (!price) return 0
  return (inputTokens / 1_000_000) * price.inputPerMTokens + (outputTokens / 1_000_000) * price.outputPerMTokens
}

/**
 * 读取 ai-traces/*.jsonl 做本地用量汇总。只统计步骤、模型、token 和失败次数，
 * 不读取 prompt 或正文；文件不存在时返回空汇总。
 *
 * 汇总行（aggregate）不重复计入 token；缓存命中单独统计，不产生调用费用。
 */
export function readAiUsage(dataDir: string, days = 30, pricing: AiModelPricing = {}): AiUsageSummary {
  const span = Math.min(Math.max(Math.floor(Number(days) || 30), 1), 365)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - span + 1)
  const startKey = dateKey(start)
  const daysMap = new Map<string, AiUsageRow>()
  const models = new Map<string, AiUsageRow>()
  const steps = new Map<string, AiUsageRow>()
  let totalCalls = 0
  let totalFailed = 0
  let totalTokens = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCost = 0
  let totalCacheHits = 0
  let totalCacheTokens = 0
  let totalCacheSavings = 0

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
      const model = entry.model?.trim() || '未知模型'

      // 本地缓存命中：不产生调用，只记录省下的 token 和估算金额。
      if (entry.cached) {
        const cachedTokens = Math.max(0, Math.floor(Number(entry.cachedTokens) || 0))
        const price = priceOf(pricing, model, entry.provider)
        const savings = price ? (cachedTokens / 1_000_000) * price.inputPerMTokens : 0
        const dayRow = daysMap.get(day) ?? emptyRow()
        dayRow.cacheHits += 1
        dayRow.cacheTokens += cachedTokens
        dayRow.cacheSavings += savings
        daysMap.set(day, dayRow)
        const modelRow = models.get(model) ?? emptyRow()
        modelRow.cacheHits += 1
        modelRow.cacheTokens += cachedTokens
        modelRow.cacheSavings += savings
        models.set(model, modelRow)
        const step = entry.step?.trim() || 'unknown'
        const stepRow = steps.get(step) ?? emptyRow()
        stepRow.cacheHits += 1
        stepRow.cacheTokens += cachedTokens
        stepRow.cacheSavings += savings
        steps.set(step, stepRow)
        totalCacheHits += 1
        totalCacheTokens += cachedTokens
        totalCacheSavings += savings
        continue
      }

      // 汇总行只包含子步骤已经计过的 token，跳过以免双计。
      if (entry.aggregate) continue

      const inputTokens = Math.max(0, Math.floor(Number(entry.inputTokens) || 0))
      const outputTokens = Math.max(0, Math.floor(Number(entry.outputTokens) || 0))
      const tokens = Math.max(
        0,
        Math.floor(Number(entry.totalTokens) || inputTokens + outputTokens),
      )
      const price = priceOf(pricing, model, entry.provider)
      const cost = estimateTokenCost(inputTokens, outputTokens, price)
      const failed = entry.ok === false ? 1 : 0
      const dayRow = daysMap.get(day) ?? emptyRow()
      dayRow.calls += 1
      dayRow.failed += failed
      dayRow.tokens += tokens
      dayRow.inputTokens += inputTokens
      dayRow.outputTokens += outputTokens
      dayRow.cost += cost
      daysMap.set(day, dayRow)
      const modelRow = models.get(model) ?? emptyRow()
      modelRow.calls += 1
      modelRow.failed += failed
      modelRow.tokens += tokens
      modelRow.inputTokens += inputTokens
      modelRow.outputTokens += outputTokens
      modelRow.cost += cost
      models.set(model, modelRow)
      const step = entry.step?.trim() || 'unknown'
      const stepRow = steps.get(step) ?? emptyRow()
      stepRow.calls += 1
      stepRow.failed += failed
      stepRow.tokens += tokens
      stepRow.inputTokens += inputTokens
      stepRow.outputTokens += outputTokens
      stepRow.cost += cost
      steps.set(step, stepRow)
      totalCalls += 1
      totalFailed += failed
      totalTokens += tokens
      totalInputTokens += inputTokens
      totalOutputTokens += outputTokens
      totalCost += cost
    }
  }

  const daysOut: AiUsageSummary['days'] = []
  for (let offset = 0; offset < span; offset++) {
    const date = new Date(start)
    date.setDate(start.getDate() + offset)
    const key = dateKey(date)
    daysOut.push({ date: key, ...(daysMap.get(key) ?? emptyRow()) })
  }

  return {
    days: daysOut,
    models: [...models.entries()]
      .map(([model, row]) => ({ model, ...row }))
      .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens || b.calls - a.calls)
      .slice(0, 12),
    steps: [...steps.entries()]
      .map(([step, row]) => ({ step, ...row }))
      .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens || b.calls - a.calls)
      .slice(0, 12),
    totalCalls,
    totalFailed,
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    totalCost,
    totalCacheHits,
    totalCacheTokens,
    totalCacheSavings,
  }
}
