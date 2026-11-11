import fs from 'node:fs'
import path from 'node:path'

import { generateObject, generateText } from 'ai'

import { getAiBudget, getAiPricing } from '../settings.js'
import { aiLimiter } from './limiter.js'
import { readAiUsage } from './usage.js'

let traceDir: string | null = null

/** 即使调用方忘了传 timeoutMs，也不允许模型请求无限挂住。 */
const DEFAULT_HARD_TIMEOUT_MS = 10 * 60 * 1000

/** 预算超限是用户可理解的业务错误，不应该被下面的兜底 catch 吞掉。 */
export class AiBudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiBudgetExceededError'
  }
}

let budgetCache: { at: number; limit: number; spent: number } | null = null

function currentMonthCost(dataDir: string): number {
  const summary = readAiUsage(dataDir, 31, getAiPricing())
  const now = new Date()
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return summary.days
    .filter((day) => day.date.startsWith(prefix))
    .reduce((total, day) => total + day.cost, 0)
}

/**
 * 月度预算护栏。按设置里的模型价格估算，到上限后拒绝新的模型调用；
 * 已经生成的内容和本地功能不受影响。价格没填时费用估算为 0，护栏不会误伤。
 */
function assertBudget(): void {
  if (!traceDir) return
  let budget: { monthlyCny: number; enabled: boolean }
  try {
    budget = getAiBudget()
  } catch {
    // 设置尚未初始化（测试或首次启动）时不做限制。
    return
  }
  if (!budget.enabled || budget.monthlyCny <= 0) return

  const now = Date.now()
  if (!budgetCache || now - budgetCache.at > 10_000 || budgetCache.limit !== budget.monthlyCny) {
    budgetCache = { at: now, limit: budget.monthlyCny, spent: currentMonthCost(path.dirname(traceDir)) }
  }
  if (budgetCache.spent >= budgetCache.limit) {
    throw new AiBudgetExceededError(
      `本月 AI 预算已用完（已用 ¥${budgetCache.spent.toFixed(2)} / 上限 ¥${budgetCache.limit.toFixed(2)}）。` +
        '可以在设置里调高上限，或等下个月再继续。',
    )
  }
}


export interface AiTraceEntry {
  step: string
  scope?: string
  provider?: string
  model?: string
  promptVersion?: string
  durationMs: number
  /** 单次调用的硬超时；即使服务商不响应 abort，也会在到点时结束等待。 */
  timeoutMs?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  /** 供应商报告的缓存命中/写入 token；没有时省略。 */
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /**
   * 汇总行：它只是把子步骤已经记录过的 token 再汇总一次，
   * 用量统计会跳过，避免读薄等任务被重复计数。
   */
  aggregate?: boolean
  /** 本地内容缓存命中：没有调用模型，但要记录省下的 token。 */
  cached?: boolean
  cachedTokens?: number
  ok: boolean
  error?: string
}

type TraceMeta = Omit<
  AiTraceEntry,
  'durationMs' | 'ok' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'error'
>

/** 给模型请求加一道硬超时；不依赖 provider 是否正确响应 AbortSignal。 */
async function withHardTimeout<T>(
  run: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return run
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.()
      reject(new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([run, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 由主进程在确定用户数据目录后初始化；未初始化时（例如单元测试）不写文件。 */
export function initAiTrace(dataDir: string): void {
  traceDir = path.join(dataDir, 'ai-traces')
  pruneOldTraces(traceDir)
}

/** 只保留一年内的 trace；统计页最多看 365 天，更早的文件没有再占空间。 */
function pruneOldTraces(dir: string): void {
  try {
    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000
    for (const name of fs.readdirSync(dir)) {
      const match = /^(\d{4})(\d{2})(\d{2})\.jsonl$/.exec(name)
      if (!match) continue
      const time = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`).getTime()
      if (Number.isFinite(time) && time < cutoff) fs.unlinkSync(path.join(dir, name))
    }
  } catch {
    // trace 目录不存在或不可读时忽略。
  }
}

function traceFile(): string {
  const now = new Date()
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return path.join(traceDir!, `${date}.jsonl`)
}

function usageFields(usage: {
  inputTokens?: number | undefined
  outputTokens?: number | undefined
  totalTokens?: number | undefined
  inputTokenDetails?: { cacheReadTokens?: number | undefined; cacheWriteTokens?: number | undefined }
} | null | undefined): Pick<AiTraceEntry, 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cacheReadTokens' | 'cacheWriteTokens'> {
  if (!usage) return {}
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
  }
}

/** 只记录步骤、模型、耗时、token 和错误，不记录 prompt 或正文，避免把阅读内容重复落盘。 */
export function traceAiStep(entry: AiTraceEntry): void {
  if (!traceDir) return
  try {
    fs.mkdirSync(traceDir, { recursive: true })
    fs.appendFileSync(
      traceFile(),
      `${JSON.stringify({
        at: new Date().toISOString(),
        step: entry.step,
        scope: entry.scope,
        provider: entry.provider,
        model: entry.model,
        promptVersion: entry.promptVersion,
        durationMs: entry.durationMs,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        totalTokens: entry.totalTokens,
        cacheReadTokens: entry.cacheReadTokens,
        cacheWriteTokens: entry.cacheWriteTokens,
        ...(entry.aggregate ? { aggregate: true } : {}),
        ...(entry.cached ? { cached: true } : {}),
        ...(entry.cachedTokens ? { cachedTokens: entry.cachedTokens } : {}),
        ok: entry.ok,
        ...(entry.error ? { error: entry.error.slice(0, 300) } : {}),
      })}\n`,
      'utf8',
    )
  } catch {
    // trace 只是诊断信息，写入失败不能影响阅读或生成。
  }
}

/**
 * 包一层异步任务，记录顶层耗时和失败原因。
 * 默认标记为 aggregate：子模型调用会各自记录 token，汇总行只用于定位失败。
 */
export async function traceAsync<T>(meta: TraceMeta, run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now()
  try {
    const result = await run()
    traceAiStep({ ...meta, aggregate: meta.aggregate ?? true, durationMs: Date.now() - startedAt, ok: true })
    return result
  } catch (error) {
    traceAiStep({
      ...meta,
      aggregate: meta.aggregate ?? true,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

type GenerateTextOptions = Parameters<typeof generateText>[0]
type GenerateTextResult = Awaited<ReturnType<typeof generateText>>
type GenerateObjectOptions = Parameters<typeof generateObject>[0]
type GenerateObjectResult = Awaited<ReturnType<typeof generateObject>>

/** 包一层 generateText，记录每一步的耗时、token 和失败原因。 */
export async function tracedGenerateText(meta: TraceMeta, options: GenerateTextOptions): Promise<GenerateTextResult> {
  const release = await aiLimiter.acquire()
  const startedAt = Date.now()
  const timeoutMs = Number(meta.timeoutMs) || DEFAULT_HARD_TIMEOUT_MS
  let controller: AbortController | null = null
  let onParentAbort: (() => void) | null = null
  let requestOptions = options
  if (timeoutMs > 0) {
    controller = new AbortController()
    const parent = options.abortSignal
    if (parent) {
      if (parent.aborted) controller.abort(parent.reason)
      else {
        onParentAbort = () => controller?.abort(parent.reason)
        parent.addEventListener('abort', onParentAbort, { once: true })
      }
    }
    requestOptions = { ...options, abortSignal: controller.signal }
  }
  try {
    if (options.abortSignal?.aborted) throw new Error('请求已取消')
    assertBudget()
    const request = generateText(requestOptions)
    const result = await withHardTimeout(request, timeoutMs, () => controller?.abort())
    traceAiStep({
      ...meta,
      ...usageFields(result.usage),
      durationMs: Date.now() - startedAt,
      ok: true,
    })
    return result
  } catch (error) {
    traceAiStep({
      ...meta,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    if (onParentAbort && options.abortSignal) {
      options.abortSignal.removeEventListener('abort', onParentAbort)
    }
    release()
  }
}

/** 包一层 generateObject，记录结构化输出的 token 和失败原因。 */
export async function tracedGenerateObject(
  meta: TraceMeta,
  options: GenerateObjectOptions,
): Promise<GenerateObjectResult> {
  const release = await aiLimiter.acquire()
  const startedAt = Date.now()
  try {
    if (options.abortSignal?.aborted) throw new Error('请求已取消')
    assertBudget()
    const result = await generateObject(options)
    traceAiStep({
      ...meta,
      ...usageFields(result.usage),
      durationMs: Date.now() - startedAt,
      ok: true,
    })
    return result
  } catch (error) {
    traceAiStep({
      ...meta,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    release()
  }
}

/** 流式调用结束后补一条 trace；供 streamText 的 onFinish/手动收尾使用。 */
export function traceStreamUsage(
  meta: TraceMeta,
  startedAt: number,
  usage:
    | {
        inputTokens?: number | undefined
        outputTokens?: number | undefined
        totalTokens?: number | undefined
        inputTokenDetails?: { cacheReadTokens?: number | undefined; cacheWriteTokens?: number | undefined }
      }
    | null
    | undefined,
  error?: unknown,
): void {
  traceAiStep({
    ...meta,
    ...usageFields(usage),
    durationMs: Date.now() - startedAt,
    ok: !error,
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
  })
}
