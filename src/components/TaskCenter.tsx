import { bridge } from '../lib/bridge.js'
import { useEffect, useState, type JSX } from 'react'

import type { AiUsageSummary, BookComposeOptions, FormatChapterOptions } from '../../shared/types.js'
import { t, useLocale } from '../lib/i18n.js'

export interface TaskFailure {
  chapterId: string
  title: string
  message: string
}

export interface TaskRetry {
  kind: 'notes' | 'format' | 'compose' | 'translate'
  bookId: string
  chapterIds: string[]
  /** 单章任务重试时使用；整本任务为空。 */
  chapterId?: string
  /** 成稿任务继续时使用。 */
  composeOptions?: BookComposeOptions
  /** 单章排版继续时使用。 */
  formatOptions?: FormatChapterOptions
}

export interface BackgroundTask {
  id: string
  kind: 'notes' | 'format' | 'compose' | 'translate' | 'import'
  title: string
  detail: string
  done: number
  total: number
  status: 'running' | 'paused' | 'done' | 'error' | 'cancelled'
  bookId?: string
  chapterId?: string
  failures?: TaskFailure[]
  retry?: TaskRetry
}

interface TaskCenterProps {
  tasks: BackgroundTask[]
  onCancel(task: BackgroundTask): void
  onRetry(task: BackgroundTask): void
  onDismiss(id: string): void
  onOpenStats?(): void
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function formatCost(value: number): string {
  return `¥${value.toFixed(2)}`
}

const STATUS_LABEL: Record<BackgroundTask['status'], string> = {
  running: t('进行中'),
  paused: t('已暂停'),
  done: t('已完成'),
  error: t('有失败'),
  cancelled: t('已取消'),
}

export function TaskCenter({ tasks, onCancel, onRetry, onDismiss, onOpenStats }: TaskCenterProps): JSX.Element | null {
  useLocale()
  const [open, setOpen] = useState(false)
  const [usage, setUsage] = useState<AiUsageSummary | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void bridge
      .getAiUsage(1)
      .then((next) => {
        if (!cancelled) setUsage(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open])

  if (tasks.length === 0) return null
  const running = tasks.filter((task) => task.status === 'running').length
  const finished = tasks.filter(
    (task) => task.status === 'done' || task.status === 'error' || task.status === 'cancelled',
  ).length

  return (
    <div className={`task-center${open ? ' is-open' : ''}`} aria-live="polite">
      <button
        type="button"
        className="task-center-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className={`task-dot${running > 0 ? ' is-running' : ''}`} />
        {t('任务')}
        {running > 0 ? ` · ${running} ${t('进行中')}` : finished > 0 ? ` · ${finished} ${t('已结束')}` : ''}
      </button>
      {open ? (
        <div className="task-center-panel">
          <div className="task-center-head">
            <strong>{t('后台任务')}</strong>
            {finished > 0 ? (
              <button
                type="button"
                className="text-button muted"
                onClick={() => tasks.filter((task) => task.status !== 'running' && task.status !== 'paused').forEach((task) => onDismiss(task.id))}
              >
                {t('清除已结束')}
              </button>
            ) : null}
          </div>
          {usage ? (
            <div className="task-usage">
              <div>
                <span>{t('今日 AI 用量')}</span>
                <strong>
                  {formatTokens(usage.totalTokens)} tokens · {formatCost(usage.totalCost)}
                </strong>
              </div>
              {onOpenStats ? (
                <button type="button" className="text-button" onClick={onOpenStats}>
                  {t('查看统计')}
                </button>
              ) : null}
            </div>
          ) : null}
          {tasks.map((task) => {
            const percent = task.total > 0 ? Math.round((task.done / task.total) * 100) : 0
            return (
              <div key={task.id} className={`task-row status-${task.status}`}>
                <div className="task-row-head">
                  <span>{task.title}</span>
                  <em>{t(STATUS_LABEL[task.status])}</em>
                </div>
                {task.detail ? <p>{task.detail}</p> : null}
                {task.failures && task.failures.length > 0 ? (
                  <ul className="task-failures">
                    {task.failures.map((failure) => (
                      <li key={failure.chapterId}>
                        <strong>{failure.title}</strong>
                        <span>{failure.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {task.status === 'running' && task.total > 0 ? (
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${Math.max(4, percent)}%` }} />
                  </div>
                ) : null}
                <div className="task-row-actions">
                  {task.total > 0 ? (
                    <span>
                      {task.done}/{task.total}
                    </span>
                  ) : <span />}
                  {task.status === 'running' ? (
                    <button type="button" className="text-button muted" onClick={() => onCancel(task)}>
                      {task.kind === 'import' || task.kind === 'compose' || task.chapterId ? t('取消') : t('暂停')}
                    </button>
                  ) : (
                    <span className="task-row-buttons">
                      {task.retry &&
                      (task.retry.kind === 'compose' || task.retry.chapterIds.length > 0) &&
                      (task.status === 'error' || task.status === 'paused') ? (
                        <button type="button" className="text-button" onClick={() => onRetry(task)}>
                          {task.status === 'paused'
                            ? t('继续')
                            : task.retry.kind === 'compose'
                              ? t('重新成稿')
                              : t('重试失败章节')}
                        </button>
                      ) : null}
                      <button type="button" className="text-button muted" onClick={() => onDismiss(task.id)}>
                        {t('移除')}
                      </button>
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
