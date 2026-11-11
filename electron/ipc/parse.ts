import type { z } from 'zod'

import { logErrorEvent } from '../logger.js'

/** 校验一组 IPC 参数；失败时写日志并抛出可读错误，不把原始 zod 错误抛给渲染层。 */
export function parseIpc<T>(channel: string, schema: z.ZodType<T>, args: unknown[]): T {
  const parsed = schema.safeParse(args)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const detail = issue ? `${issue.path.join('.') || 'args'}: ${issue.message}` : '参数无效'
  logErrorEvent('ipc:invalid-args', `${channel} ${detail}`)
  throw new Error(`参数无效：${detail}`)
}
