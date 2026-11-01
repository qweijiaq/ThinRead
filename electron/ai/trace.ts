import fs from 'node:fs'
import path from 'node:path'

import { generateText } from 'ai'

let traceDir: string | null = null

export interface AiTraceEntry {
  step: string
  scope?: string
  model?: string
  promptVersion?: string
  durationMs: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  ok: boolean
  error?: string
}

/** 由主进程在确定用户数据目录后初始化；未初始化时（例如单元测试）不写文件。 */
export function initAiTrace(dataDir: string): void {
  traceDir = path.join(dataDir, 'ai-traces')
}

function traceFile(): string {
  const now = new Date()
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return path.join(traceDir!, `${date}.jsonl`)
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
        model: entry.model,
        promptVersion: entry.promptVersion,
        durationMs: entry.durationMs,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        totalTokens: entry.totalTokens,
        ok: entry.ok,
        ...(entry.error ? { error: entry.error.slice(0, 300) } : {}),
      })}\n`,
      'utf8',
    )
  } catch {
    // trace 只是诊断信息，写入失败不能影响阅读或生成。
  }
}

/** 包一层异步 AI 调用，记录顶层耗时和失败原因。 */
export async function traceAsync<T>(
  meta: Omit<AiTraceEntry, 'durationMs' | 'ok' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'error'>,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  try {
    const result = await run()
    traceAiStep({ ...meta, durationMs: Date.now() - startedAt, ok: true })
    return result
  } catch (error) {
    traceAiStep({
      ...meta,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

type GenerateTextOptions = Parameters<typeof generateText>[0]
type GenerateTextResult = Awaited<ReturnType<typeof generateText>>

/** 包一层 generateText，记录每一步的耗时、token 和失败原因。 */
export async function tracedGenerateText(
  meta: Omit<AiTraceEntry, 'durationMs' | 'ok' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'error'>,
  options: GenerateTextOptions,
): Promise<GenerateTextResult> {
  const startedAt = Date.now()
  try {
    const result = await generateText(options)
    const usage = result.usage
    traceAiStep({
      ...meta,
      durationMs: Date.now() - startedAt,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
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
  }
}
