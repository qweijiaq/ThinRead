import { randomUUID } from 'node:crypto'

import type { ProviderId } from '../../shared/types.js'

/** 服务商要求客户端明确标识自己，而不是使用通用 SDK 默认 UA。 */
export const THINREAD_USER_AGENT = 'ThinRead/0.2.2 (+https://github.com/qweijiaq/ThinRead)'

/**
 * OpenCode Go 要求同一段对话使用稳定的 session ID，用于路由和 prompt 缓存。
 * 本应用的一次进程运行视为一个会话；重启后换新 ID。
 */
const OPENCODE_SESSION_ID = randomUUID()

export function clientRequestHeaders(provider: ProviderId): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': THINREAD_USER_AGENT }
  if (provider === 'opencode' || provider === 'opencode-go') {
    headers['x-opencode-session'] = OPENCODE_SESSION_ID
  }
  if (provider === 'opendesign') {
    headers['HTTP-Referer'] = 'https://open-design.ai'
    headers['X-Title'] = 'ThinRead'
  }
  return headers
}
