export type RestorableTaskStatus = 'running' | 'paused' | 'done' | 'error' | 'cancelled'

/**
 * 应用启动时只恢复仍需关注的任务。
 * 完成/取消的任务在本次会话里可以保留，但重启后不应继续占着任务中心。
 */
export function shouldRestoreTask(status: RestorableTaskStatus): boolean {
  return status === 'running' || status === 'paused' || status === 'error'
}
