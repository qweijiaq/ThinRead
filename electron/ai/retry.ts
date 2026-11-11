/**
 * 模型请求的重试判定与退避。
 *
 * 之前的重试是固定间隔，遇到 429 / 5xx 时容易和别的任务一起撞在同一个时间点。
 * 这里统一成带抖动的指数退避，并且只对「可能恢复」的错误重试：
 * 认证失败、参数错误重试多少次都没用，只会放大账单。
 */

export function isRetryableError(error: unknown): boolean {
  const record = error as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown } | null
  const status = Number(record?.status ?? record?.statusCode)
  if (Number.isFinite(status) && status > 0) {
    if (status === 408 || status === 409 || status === 425 || status === 429) return true
    if (status >= 500 && status <= 599) return true
    if (status >= 400 && status < 500) return false
  }

  const message = error instanceof Error ? error.message : String(error ?? '')
  const code = typeof record?.code === 'string' ? record.code : ''
  const haystack = `${message} ${code}`

  if (/rate.?limit|too many requests|overloaded|server error|service unavailable|bad gateway|gateway timeout/i.test(haystack)) {
    return true
  }
  if (/ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|socket hang up|fetch failed|network error/i.test(haystack)) {
    return true
  }
  if (/超时|timed?\s*out|timeout/i.test(haystack)) return true
  return false
}

/** 指数退避 + 抖动；上限 15 秒，避免长任务在深夜排长队。 */
export function backoffDelay(attempt: number, baseMs = 800, capMs = 15_000): number {
  const safeAttempt = Math.max(0, Math.floor(Number(attempt) || 0))
  const exponential = Math.min(capMs, baseMs * 2 ** safeAttempt)
  return Math.min(capMs, Math.round(exponential * (0.6 + Math.random() * 0.8)))
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(ms))))
}

export interface RetryOptions {
  attempts?: number
  baseMs?: number
  capMs?: number
  signal?: AbortSignal
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void
}

/** 只对可恢复错误重试；取消信号优先于重试。 */
export async function retryWithBackoff<T>(run: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 3))
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) throw new Error('请求已取消')
    try {
      return await run()
    } catch (error) {
      lastError = error
      if (attempt >= attempts - 1 || !isRetryableError(error)) throw error
      const delay = backoffDelay(attempt, options.baseMs, options.capMs)
      options.onRetry?.(attempt + 1, error, delay)
      await sleep(delay)
    }
  }
  throw lastError
}
