import type { AiJobSnapshot } from '../../shared/types.js'
import { upsertBackgroundTask } from '../db.js'

export type JobSender = { isDestroyed(): boolean; send(channel: string, payload: unknown): void }

/** 单章/整章 AI 任务快照。切章、切视图后渲染层可以重新接上进行中的任务。 */
const aiJobs = new Map<string, AiJobSnapshot>()

function pruneAiJobs(): void {
  if (aiJobs.size <= 40) return
  const finished = [...aiJobs.values()]
    .filter((job) => job.status !== 'running')
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  for (const job of finished.slice(0, aiJobs.size - 40)) aiJobs.delete(job.id)
}

function persistAiJobState(job: AiJobSnapshot): void {
  if (!job.bookId) return
  if (job.kind === 'compose') {
    upsertBackgroundTask({
      id: job.id,
      kind: 'compose',
      bookId: job.bookId,
      targets: [{ id: job.bookId, title: job.title }],
      status: job.status,
      done: job.status === 'done' ? 1 : 0,
      failures:
        job.status === 'error' && job.error
          ? [{ chapterId: '', title: job.title, message: job.error }]
          : [],
      ...(job.composeOptions ? { meta: { composeOptions: job.composeOptions } } : {}),
    })
    return
  }
  if (!job.chapterId) return
  upsertBackgroundTask({
    id: job.id,
    kind: job.kind,
    bookId: job.bookId,
    targets: [{ id: job.chapterId, title: job.title }],
    status: job.status,
    done: job.status === 'done' ? 1 : 0,
    failures:
      job.status === 'error' && job.error
        ? [{ chapterId: job.chapterId, title: job.title, message: job.error }]
        : [],
    ...(job.kind === 'format' && job.formatOptions ? { meta: { formatOptions: job.formatOptions } } : {}),
  })
}

export function publishAiJob(sender: JobSender | null, job: AiJobSnapshot): void {
  const previous = aiJobs.get(job.id)
  aiJobs.set(job.id, job)
  // 只在开始或状态变化时写库；流式进度不频繁落盘。
  if (!previous || previous.status !== job.status) persistAiJobState(job)
  pruneAiJobs()
  try {
    if (sender && !sender.isDestroyed()) sender.send('ai:job:update', job)
  } catch {
    // 窗口已关闭时只保留内存快照。
  }
}

export function patchAiJob(sender: JobSender | null, id: string, patch: Partial<AiJobSnapshot>): void {
  const current = aiJobs.get(id)
  if (!current) return
  publishAiJob(sender, { ...current, ...patch, updatedAt: new Date().toISOString() })
}

export function getAiJob(id: string): AiJobSnapshot | undefined {
  return aiJobs.get(id)
}

export function listAiJobs(): AiJobSnapshot[] {
  return [...aiJobs.values()]
}

/** 返回 false 表示任务仍在运行，不能移除。 */
export function dismissAiJob(id: string): boolean {
  const job = aiJobs.get(id)
  if (job?.status === 'running') return false
  if (job) aiJobs.delete(id)
  return true
}
