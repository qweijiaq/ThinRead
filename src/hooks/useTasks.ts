import { useCallback, useEffect, useState } from 'react'

import type { BackgroundTaskRecord } from '../../shared/types.js'
import { t } from '../lib/i18n.js'
import type { BackgroundTask, TaskFailure } from '../components/TaskCenter.js'

import type { ToastState } from './useToast.js'

const TASKS_KEY = 'reading-notes-background-tasks'

function failureSummary(failures: TaskFailure[]): string {
  const titles = failures.slice(0, 3).map((failure) => `「${failure.title}」`)
  return `${t('失败')} ${failures.length} ${t('节：')}${titles.join('、')}${failures.length > titles.length ? ` ${t('等')}` : ''}`
}

function loadBackgroundTasks(): BackgroundTask[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TASKS_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is BackgroundTask => Boolean(item) && typeof item === 'object').slice(0, 6)
  } catch {
    return []
  }
}

function taskFromRecord(record: BackgroundTaskRecord): BackgroundTask {
  const failed = record.failures
  const retryIds =
    record.status === 'paused'
      ? record.targets.map((target) => target.id)
      : failed.map((failure) => failure.chapterId)
  const detail =
    record.status === 'paused'
      ? t('应用重启，任务已暂停；继续会跳过已完成章节')
      : record.status === 'error'
        ? `${t('失败')} ${failed.length} ${t('节，可继续重试')}`
        : record.status === 'done'
          ? `${t('完成')} ${record.done}/${record.total} ${t('节')}`
          : `${t('已完成')} ${record.done}/${record.total} ${t('节')}`
  return {
    id: record.id,
    kind: record.kind,
    title: record.kind === 'notes' ? t('整本生成') : t('整本 AI 排版'),
    detail,
    done: record.done,
    total: record.total,
    status: record.status,
    failures: failed,
    retry: retryIds.length > 0 ? { kind: record.kind, bookId: record.bookId, chapterIds: retryIds } : undefined,
  }
}

export interface TaskCenterState {
  tasks: BackgroundTask[]
  setTasks: React.Dispatch<React.SetStateAction<BackgroundTask[]>>
  refreshDurableTasks(): void
}

/**
 * 右下角任务中心：整本生成、整本排版、OCR 的进度、失败和重试信息，
 * 以及从主进程持久化任务表恢复上次未完成的任务。
 */
export function useTasks(options: {
  notify(toast: ToastState): void
  onBooksChanged(): void
}): TaskCenterState {
  const { notify, onBooksChanged } = options
  const [tasks, setTasks] = useState<BackgroundTask[]>(loadBackgroundTasks)

  const mergeDurableTasks = useCallback((records: BackgroundTaskRecord[]) => {
    setTasks((current) => {
      const next = [...current]
      for (const record of records) {
        const task = taskFromRecord(record)
        const index = next.findIndex((item) => item.id === task.id)
        if (index >= 0) next[index] = task
        else next.unshift(task)
      }
      return next.slice(0, 6)
    })
  }, [])

  const refreshDurableTasks = useCallback(() => {
    void window.api
      .listBackgroundTasks()
      .then(mergeDurableTasks)
      .catch(() => undefined)
  }, [mergeDurableTasks])

  useEffect(() => {
    refreshDurableTasks()
  }, [refreshDurableTasks])

  useEffect(() => {
    function upsert(task: BackgroundTask): void {
      setTasks((current) => {
        const exists = current.some((item) => item.id === task.id)
        return exists ? current.map((item) => (item.id === task.id ? task : item)) : [task, ...current].slice(0, 6)
      })
    }
    function patch(id: string, update: Partial<BackgroundTask>): void {
      setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...update } : task)))
    }

    const offNotesProgress = window.api.onBookGenerationProgress((event) => {
      upsert({
        id: `notes:${event.bookId}`,
        kind: 'notes',
        title: t('整本生成'),
        detail: event.title ? `${event.title}${event.message ? ` · ${event.message}` : ''}` : t('正在准备'),
        done: event.done,
        total: event.total,
        status: 'running',
      })
    })
    const offNotesDone = window.api.onBookGenerationDone((event) => {
      patch(`notes:${event.bookId}`, {
        status: event.cancelled ? 'cancelled' : event.failed.length > 0 ? 'error' : 'done',
        done: event.generated + event.skipped + event.failed.length,
        detail: event.cancelled
          ? t('已取消')
          : `${t('新生成')} ${event.generated} ${t('节')}${event.skipped > 0 ? ` · ${t('跳过')} ${event.skipped} ${t('节')}` : ''}${event.failed.length > 0 ? ` · ${failureSummary(event.failed)}` : ''}`,
        failures: event.failed,
        retry:
          event.failed.length > 0
            ? { kind: 'notes', bookId: event.bookId, chapterIds: event.failed.map((failure) => failure.chapterId) }
            : undefined,
      })
      refreshDurableTasks()
    })
    const offFormatProgress = window.api.onBookFormatProgress((event) => {
      upsert({
        id: `format:${event.bookId}`,
        kind: 'format',
        title: t('整本 AI 排版'),
        detail: event.title ? `${event.title}${event.message ? ` · ${event.message}` : ''}` : t('正在准备'),
        done: event.done,
        total: event.total,
        status: 'running',
      })
    })
    const offFormatDone = window.api.onBookFormatDone((event) => {
      patch(`format:${event.bookId}`, {
        status: event.cancelled ? 'cancelled' : event.failed.length > 0 ? 'error' : 'done',
        done: event.formatted + event.skipped + event.failed.length,
        detail: event.cancelled
          ? t('已取消')
          : `${t('完成')} ${event.formatted} ${t('节')}${event.skipped > 0 ? ` · ${t('跳过')} ${event.skipped} ${t('节')}` : ''}${event.failed.length > 0 ? ` · ${failureSummary(event.failed)}` : ''}`,
        failures: event.failed,
        retry:
          event.failed.length > 0
            ? { kind: 'format', bookId: event.bookId, chapterIds: event.failed.map((failure) => failure.chapterId) }
            : undefined,
      })
      refreshDurableTasks()
    })
    const offOcrProgress = window.api.onOcrProgress((event) => {
      upsert({
        id: 'ocr',
        kind: 'import',
        title: t('扫描版 PDF OCR'),
        detail: `${t('正在识别第')} ${event.page} ${t('页')}`,
        done: event.current,
        total: event.total,
        status: 'running',
      })
    })
    const offOcrDone = window.api.onOcrDone((event) => {
      setTasks((current) =>
        current.map((task) =>
          task.id === 'ocr'
            ? {
                ...task,
                status: 'done',
                done: task.total,
                detail: `${t('已导入')}《${event.book.title}》 · ${Math.round(event.durationMs / 1000)}s`,
              }
            : task,
        ),
      )
      notify({ kind: 'info', text: `${t('OCR 导入完成')}：《${event.book.title}》，${t('共')} ${event.book.chapterCount} ${t('节')}.` })
      onBooksChanged()
    })
    const offOcrError = window.api.onOcrError((event) => {
      patch('ocr', { status: event.cancelled ? 'cancelled' : 'error', detail: event.message })
      notify({ kind: event.cancelled ? 'info' : 'error', text: event.message })
    })
    return () => {
      offNotesProgress()
      offNotesDone()
      offFormatProgress()
      offFormatDone()
      offOcrProgress()
      offOcrDone()
      offOcrError()
    }
  }, [refreshDurableTasks, notify, onBooksChanged])

  useEffect(() => {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks.slice(0, 6)))
    } catch {
      // 本地任务历史只是辅助信息，存储失败不影响当前任务。
    }
  }, [tasks])

  return { tasks, setTasks, refreshDurableTasks }
}
