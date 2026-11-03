import { useState, type JSX } from 'react'

import { t, useLocale } from '../lib/i18n.js'

export interface TaskFailure {
  chapterId: string
  title: string
  message: string
}

export interface TaskRetry {
  kind: 'notes' | 'format'
  bookId: string
  chapterIds: string[]
}

export interface BackgroundTask {
  id: string
  kind: 'notes' | 'format' | 'import'
  title: string
  detail: string
  done: number
  total: number
  status: 'running' | 'paused' | 'done' | 'error' | 'cancelled'
  failures?: TaskFailure[]
  retry?: TaskRetry
}

interface TaskCenterProps {
  tasks: BackgroundTask[]
  onCancel(task: BackgroundTask): void
  onRetry(task: BackgroundTask): void
  onDismiss(id: string): void
}

const STATUS_LABEL: Record<BackgroundTask['status'], string> = {
  running: '进行中',
  paused: '已暂停',
  done: '已完成',
  error: '有失败',
  cancelled: '已取消',
}

export function TaskCenter({ tasks, onCancel, onRetry, onDismiss }: TaskCenterProps): JSX.Element | null {
  useLocale()
  const [open, setOpen] = useState(false)
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
                      {task.kind === 'import' ? t('取消') : t('暂停')}
                    </button>
                  ) : (
                    <span className="task-row-buttons">
                      {task.retry && task.retry.chapterIds.length > 0 && (task.status === 'error' || task.status === 'paused') ? (
                        <button type="button" className="text-button" onClick={() => onRetry(task)}>
                          {task.status === 'paused' ? t('继续') : t('重试失败章节')}
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
