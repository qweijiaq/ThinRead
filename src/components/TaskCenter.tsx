import { useState, type JSX } from 'react'

export interface BackgroundTask {
  id: string
  kind: 'notes' | 'format'
  title: string
  detail: string
  done: number
  total: number
  status: 'running' | 'done' | 'error' | 'cancelled'
}

interface TaskCenterProps {
  tasks: BackgroundTask[]
  onCancel(task: BackgroundTask): void
  onDismiss(id: string): void
}

const STATUS_LABEL: Record<BackgroundTask['status'], string> = {
  running: '进行中',
  done: '已完成',
  error: '有失败',
  cancelled: '已取消',
}

export function TaskCenter({ tasks, onCancel, onDismiss }: TaskCenterProps): JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (tasks.length === 0) return null
  const running = tasks.filter((task) => task.status === 'running').length
  const finished = tasks.filter((task) => task.status !== 'running').length

  return (
    <div className={`task-center${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="task-center-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className={`task-dot${running > 0 ? ' is-running' : ''}`} />
        任务
        {running > 0 ? ` · ${running} 进行中` : finished > 0 ? ` · ${finished} 已完成` : ''}
      </button>
      {open ? (
        <div className="task-center-panel">
          <div className="task-center-head">
            <strong>后台任务</strong>
            {finished > 0 ? (
              <button
                type="button"
                className="text-button muted"
                onClick={() => tasks.filter((task) => task.status !== 'running').forEach((task) => onDismiss(task.id))}
              >
                清除已完成
              </button>
            ) : null}
          </div>
          {tasks.map((task) => {
            const percent = task.total > 0 ? Math.round((task.done / task.total) * 100) : 0
            return (
              <div key={task.id} className={`task-row status-${task.status}`}>
                <div className="task-row-head">
                  <span>{task.title}</span>
                  <em>{STATUS_LABEL[task.status]}</em>
                </div>
                {task.detail ? <p>{task.detail}</p> : null}
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
                      取消
                    </button>
                  ) : (
                    <button type="button" className="text-button muted" onClick={() => onDismiss(task.id)}>
                      移除
                    </button>
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
