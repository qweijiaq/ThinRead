import type { RendererErrorReport } from '../../shared/types.js'

/**
 * 把渲染层的崩溃和未捕获异常送到主进程日志。
 * 只写本地文件，不联网；上报本身失败时静默，避免在错误处理里再次抛错。
 */
export function reportRendererError(
  scope: string,
  error: unknown,
  extra?: { componentStack?: string | null },
): void {
  const message = error instanceof Error ? error.message : String(error)
  const report: RendererErrorReport = {
    scope,
    message: message.slice(0, 2000),
    stack: error instanceof Error ? (error.stack ?? null) : null,
    componentStack: extra?.componentStack ?? null,
    url: typeof window === 'undefined' ? null : window.location.href,
  }
  try {
    const api = window.api as
      | { logRendererError?: (value: RendererErrorReport) => Promise<void> }
      | undefined
    void api?.logRendererError?.(report)
  } catch {
    // 忽略：不能在错误上报里再制造一个错误。
  }
}
