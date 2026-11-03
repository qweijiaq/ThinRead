import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * AI 录制/回放：在网络层拦截 fetch，把请求体哈希成文件名存下响应。
 * 用来在没有 API Key、没有网络的 CI 里回放真实模型的输出。
 *
 * 录制文件包含完整提示词（也就是书的内容），默认不写进仓库；
 * 由 THINREAD_AI_RECORD_DIR / THINREAD_AI_REPLAY_DIR 显式指定目录。
 */

interface RecordedResponse {
  url: string
  status: number
  headers: Array<[string, string]>
  body: string
}

let originalFetch: typeof globalThis.fetch | null = null

function requestKey(url: string, method: string, body: string): string {
  return crypto.createHash('sha256').update(`${method}\n${url}\n${body}`).digest('hex')
}

function readBody(init: Parameters<typeof fetch>[1], input: Parameters<typeof fetch>[0]): string {
  if (typeof init?.body === 'string') return init.body
  if (init?.body == null && typeof input === 'object' && 'text' in input) {
    // Request 对象的 body 已被 SDK 消费过，无法同步读取；调用方通常传字符串 body。
    return ''
  }
  return ''
}

export function installFetchReplay(options: { recordDir?: string; replayDir?: string }): void {
  if (!originalFetch) originalFetch = globalThis.fetch
  const base = originalFetch
  const replayDir = options.replayDir ? path.resolve(options.replayDir) : null
  const recordDir = options.recordDir ? path.resolve(options.recordDir) : null

  const patched = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
    const body = readBody(init, input)
    const key = requestKey(url, method, body)

    if (replayDir) {
      const file = path.join(replayDir, `${key}.json`)
      if (!fs.existsSync(file)) {
        throw new Error(`没有找到 AI 回放记录：${key}（${method} ${url}）`)
      }
      const recorded = JSON.parse(fs.readFileSync(file, 'utf8')) as RecordedResponse
      return new Response(recorded.body, {
        status: recorded.status,
        headers: recorded.headers,
      })
    }

    const response = await base(input, init)
    if (recordDir) {
      try {
        const text = await response.clone().text()
        fs.mkdirSync(recordDir, { recursive: true })
        const recorded: RecordedResponse = {
          url,
          status: response.status,
          headers: [...response.headers.entries()],
          body: text,
        }
        fs.writeFileSync(path.join(recordDir, `${key}.json`), JSON.stringify(recorded), 'utf8')
      } catch {
        // 录制失败不能影响真实请求。
      }
    }
    return response
  }

  globalThis.fetch = patched as typeof globalThis.fetch
}

/** 仅测试用：恢复原始 fetch。 */
export function uninstallFetchReplay(): void {
  if (originalFetch) globalThis.fetch = originalFetch
  originalFetch = null
}
