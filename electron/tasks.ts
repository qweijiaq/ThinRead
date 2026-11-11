import type { BackgroundTaskRecord, BackgroundTaskTarget } from '../shared/types.js'
import { getDatabase } from './database.js'

interface DurableTaskRow {
  id: string
  kind: string
  book_id: string
  payload: string
  status: string
  done: number
  total: number
  failures: string
  created_at: string
  updated_at: string
}

function mapDurableTask(row: DurableTaskRow): BackgroundTaskRecord {
  let targets: BackgroundTaskTarget[] = []
  let failures: BackgroundTaskRecord['failures'] = []
  let meta: Record<string, unknown> | undefined
  try {
    const payload = JSON.parse(row.payload) as { targets?: BackgroundTaskTarget[]; meta?: unknown }
    if (Array.isArray(payload.targets)) targets = payload.targets.filter((item) => item && typeof item.id === 'string')
    if (payload.meta && typeof payload.meta === 'object' && !Array.isArray(payload.meta)) {
      meta = payload.meta as Record<string, unknown>
    }
  } catch {
    // 旧任务数据损坏时仍然允许清理。
  }
  try {
    const parsed = JSON.parse(row.failures) as BackgroundTaskRecord['failures']
    if (Array.isArray(parsed)) failures = parsed
  } catch {
    // 忽略损坏的失败记录。
  }
  return {
    id: row.id,
    kind:
      row.kind === 'format'
        ? 'format'
        : row.kind === 'compose'
          ? 'compose'
          : row.kind === 'translate'
            ? 'translate'
            : 'notes',
    bookId: row.book_id,
    targets,
    status:
      row.status === 'running' ||
      row.status === 'paused' ||
      row.status === 'done' ||
      row.status === 'error' ||
      row.status === 'cancelled'
        ? row.status
        : 'paused',
    done: Number(row.done) || 0,
    total: Number(row.total) || targets.length,
    failures,
    ...(meta ? { meta } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function upsertBackgroundTask(input: {
  id: string
  kind: 'notes' | 'format' | 'compose' | 'translate'
  bookId: string
  targets: BackgroundTaskTarget[]
  status: BackgroundTaskRecord['status']
  done?: number
  failures?: BackgroundTaskRecord['failures']
  meta?: Record<string, unknown>
}): void {
  const now = new Date().toISOString()
  getDatabase()
    .prepare(
      `INSERT INTO background_tasks
       (id, kind, book_id, payload, status, done, total, failures, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         book_id = excluded.book_id,
         payload = excluded.payload,
         status = excluded.status,
         done = excluded.done,
         total = excluded.total,
         failures = excluded.failures,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.id,
      input.kind,
      input.bookId,
      JSON.stringify({ targets: input.targets, ...(input.meta ? { meta: input.meta } : {}) }),
      input.status,
      input.done ?? 0,
      input.targets.length,
      JSON.stringify(input.failures ?? []),
      now,
      now,
    )
}

export function updateBackgroundTask(
  id: string,
  patch: { status?: BackgroundTaskRecord['status']; done?: number; failures?: BackgroundTaskRecord['failures'] },
): void {
  const row = getDatabase().prepare('SELECT * FROM background_tasks WHERE id = ?').get(id) as
    | DurableTaskRow
    | undefined
  if (!row) return
  let failures = patch.failures
  if (!failures) {
    try {
      const parsed = JSON.parse(row.failures || '[]') as BackgroundTaskRecord['failures']
      failures = Array.isArray(parsed) ? parsed : []
    } catch {
      failures = []
    }
  }
  getDatabase()
    .prepare('UPDATE background_tasks SET status = ?, done = ?, failures = ?, updated_at = ? WHERE id = ?')
    .run(
      patch.status ?? row.status,
      patch.done ?? row.done,
      JSON.stringify(failures),
      new Date().toISOString(),
      id,
    )
}

export function listBackgroundTasks(): BackgroundTaskRecord[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM background_tasks ORDER BY updated_at DESC LIMIT 20')
    .all() as unknown as DurableTaskRow[]
  return rows.map(mapDurableTask)
}

/** 进程异常退出后，上次仍在 running 的任务改为 paused，等待用户继续。 */
export function markInterruptedBackgroundTasksPaused(): void {
  getDatabase().prepare("UPDATE background_tasks SET status = 'paused' WHERE status = 'running'").run()
}

export function pruneBackgroundTasks(days = 7): void {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  getDatabase()
    .prepare("DELETE FROM background_tasks WHERE status IN ('done', 'error', 'cancelled') AND updated_at < ?")
    .run(cutoff)
}

export function deleteBackgroundTask(id: string): void {
  getDatabase().prepare('DELETE FROM background_tasks WHERE id = ?').run(id)
}
