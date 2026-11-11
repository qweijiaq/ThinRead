export interface AiLimiter {
  acquire(): Promise<() => void>
  active(): number
}

/**
 * 所有非流式模型请求共用一个并发上限。
 * 读薄、排版、成稿、工作台可能同时跑；各自并发叠加会让服务商限流或超时。
 */
export function createLimiter(limit: number): AiLimiter {
  const max = Math.max(1, Math.floor(limit))
  let activeCount = 0
  const waiters: Array<() => void> = []

  function makeRelease(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      activeCount = Math.max(0, activeCount - 1)
      const next = waiters.shift()
      if (next) next()
    }
  }

  return {
    active: () => activeCount,
    acquire() {
      if (activeCount < max) {
        activeCount += 1
        return Promise.resolve(makeRelease())
      }
      return new Promise<() => void>((resolve) => {
        waiters.push(() => {
          activeCount += 1
          resolve(makeRelease())
        })
      })
    },
  }
}

const configured = Number(process.env.THINREAD_AI_CONCURRENCY)
export const aiLimiter = createLimiter(Number.isFinite(configured) && configured > 0 ? configured : 6)
