import { bridge } from '../lib/bridge.js'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { AiJobSnapshot, BackgroundTaskRecord, BookComposeOptions, FormatChapterOptions } from '../../shared/types.js'
import { t } from '../lib/i18n.js'
import { shouldRestoreTask } from '../lib/task-status.js'
import type { BackgroundTask, TaskFailure, TaskRetry } from '../components/TaskCenter.js'

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
    return parsed
      .filter((item): item is BackgroundTask => Boolean(item) && typeof item === 'object')
      .filter((task) => shouldRestoreTask(task.status))
      .slice(0, 6)
  } catch {
    return []
  }
}

function composeOptionsOf(record: BackgroundTaskRecord): BookComposeOptions | undefined {
  const raw = record.meta?.composeOptions
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as { length?: unknown; voice?: unknown }
  return {
    length: value.length === 'full' ? 'full' : 'tight',
    voice: value.voice === 'sharp' ? 'sharp' : value.voice === 'personal' ? 'personal' : 'calm',
  }
}

function formatOptionsOf(record: BackgroundTaskRecord): FormatChapterOptions | undefined {
  const raw = record.meta?.formatOptions
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  return { skipReferences: (raw as { skipReferences?: unknown }).skipReferences === true }
}

function taskFromRecord(record: BackgroundTaskRecord): BackgroundTask {
  const failed = record.failures
  const singleChapter =
    (record.id.startsWith('ai-notes:') ||
      record.id.startsWith('ai-format:') ||
      record.id.startsWith('ai-translate:')) &&
    record.targets.length === 1
  const chapterTarget = singleChapter ? record.targets[0] : undefined
  const retryIds =
    record.status === 'paused'
      ? record.targets.map((target) => target.id)
      : failed.map((failure) => failure.chapterId)
  const title =
    record.kind === 'compose'
      ? `${t('成稿')} · ${record.targets[0]?.title ?? ''}`
      : chapterTarget
        ? `${record.kind === 'notes' ? t('读薄') : record.kind === 'format' ? t('排版') : t('翻译')} · ${chapterTarget.title}`
        : record.kind === 'notes'
          ? t('整本生成')
          : record.kind === 'format'
            ? t('整本 AI 排版')
            : t('翻译')
  const detail =
    record.status === 'paused'
      ? record.kind === 'compose'
        ? t('应用重启，任务已暂停；继续会重新生成成稿')
        : chapterTarget
          ? t('应用重启，任务已暂停；继续会重新处理这一章')
          : t('应用重启，任务已暂停；继续会跳过已完成章节')
      : record.status === 'error'
        ? `${t('失败')} ${failed.length} ${t('节，可继续重试')}`
        : record.status === 'done'
          ? `${t('完成')} ${record.done}/${record.total} ${t('节')}`
          : `${t('已完成')} ${record.done}/${record.total} ${t('节')}`
  const retry: TaskRetry | undefined =
    record.kind === 'compose'
      ? record.status === 'paused' || record.status === 'error'
        ? {
            kind: 'compose',
            bookId: record.bookId,
            chapterIds: [],
            composeOptions: composeOptionsOf(record),
          }
        : undefined
      : retryIds.length > 0
        ? {
            kind: record.kind,
            bookId: record.bookId,
            chapterIds: retryIds,
            ...(chapterTarget ? { chapterId: chapterTarget.id } : {}),
            ...(record.kind === 'format' && chapterTarget
              ? { formatOptions: formatOptionsOf(record) }
              : {}),
          }
        : undefined
  return {
    id: record.id,
    kind: record.kind,
    title,
    detail,
    done: record.done,
    total: record.total,
    status: record.status,
    failures: failed,
    retry,
  }
}

function taskFromAiJob(job: AiJobSnapshot): BackgroundTask {
  const prefix =
    job.kind === 'notes'
      ? t('读薄')
      : job.kind === 'format'
        ? t('排版')
        : job.kind === 'translate'
          ? t('翻译')
          : t('成稿')
  const title = `${prefix} · ${job.title}`
  const failed =
    job.status === 'error' && job.error
      ? [{ chapterId: job.chapterId, title, message: job.error }]
      : undefined
  const retry: TaskRetry | undefined =
    failed && job.kind === 'compose'
      ? {
          kind: 'compose',
          bookId: job.bookId,
          chapterIds: [],
          composeOptions: job.composeOptions,
        }
      : failed
        ? {
            kind: job.kind,
            bookId: job.bookId,
            chapterIds: [job.chapterId],
            chapterId: job.chapterId,
            ...(job.kind === 'format' ? { formatOptions: job.formatOptions } : {}),
          }
        : undefined
  return {
    id: job.id,
    kind: job.kind,
    title,
    detail: job.detail,
    done: job.done,
    total: job.total,
    status: job.status,
    bookId: job.bookId,
    chapterId: job.chapterId || undefined,
    failures: failed,
    retry,
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
  /** 当前页面是否已经能看到这个任务的结果；看不到时后台完成会发一条提示。 */
  isJobVisible?(job: AiJobSnapshot): boolean
}): TaskCenterState {
  const { notify, onBooksChanged } = options
  const [tasks, setTasks] = useState<BackgroundTask[]>(loadBackgroundTasks)
  const jobStatusRef = useRef(new Map<string, AiJobSnapshot['status']>())
  const visibilityRef = useRef(options.isJobVisible)
  visibilityRef.current = options.isJobVisible

  function desktopNotify(title: string, body: string): void {
    if (typeof document !== 'undefined' && document.hasFocus()) return
    void bridge.notifyDesktop(title, body).catch(() => undefined)
  }

  const mergeDurableTasks = useCallback((records: BackgroundTaskRecord[]) => {
    setTasks((current) => {
      const next = [...current]
      for (const record of records) {
        // 已完成/已取消的历史任务不恢复到任务中心，避免每次启动都看到旧任务。
        if (!shouldRestoreTask(record.status)) continue
        const task = taskFromRecord(record)
        const index = next.findIndex((item) => item.id === task.id)
        if (index >= 0) next[index] = task
        else next.unshift(task)
      }
      return next.slice(0, 6)
    })
  }, [])

  const refreshDurableTasks = useCallback(() => {
    void bridge
      .listBackgroundTasks()
      .then(mergeDurableTasks)
      .catch(() => undefined)
  }, [mergeDurableTasks])

  const mergeAiJobs = useCallback((jobs: AiJobSnapshot[]) => {
    setTasks((current) => {
      const next = [...current]
      for (const job of jobs) {
        jobStatusRef.current.set(job.id, job.status)
        if (job.status !== 'running' && job.status !== 'error') continue
        const task = taskFromAiJob(job)
        const index = next.findIndex((item) => item.id === task.id)
        if (index >= 0) next[index] = task
        else next.unshift(task)
      }
      return next.slice(0, 6)
    })
  }, [])

  const refreshAiJobs = useCallback(() => {
    void bridge
      .listAiJobs()
      .then(mergeAiJobs)
      .catch(() => undefined)
  }, [mergeAiJobs])

  useEffect(() => {
    refreshDurableTasks()
    refreshAiJobs()
  }, [refreshDurableTasks, refreshAiJobs])

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

    const offAiJob = bridge.onAiJobUpdate((job) => {
      const previous = jobStatusRef.current.get(job.id)
      jobStatusRef.current.set(job.id, job.status)
      const task = taskFromAiJob(job)
      const hidden = !visibilityRef.current?.(job)
      if (previous === 'running' && job.status !== 'running' && hidden) {
        if (job.status === 'done') {
          notify({ kind: 'info', text: `${task.title} ${t('已完成')}。` })
          desktopNotify(task.title, t('已完成'))
        } else if (job.status === 'error') {
          notify({ kind: 'error', text: `${task.title} ${t('失败')}：${job.error ?? ''}` })
          desktopNotify(task.title, `${t('失败')}：${job.error ?? ''}`)
        }
      }
      if (job.status === 'cancelled') {
        // 只有已经在任务中心里的任务才标记为取消，避免历史取消记录不断堆积。
        patch(job.id, { status: 'cancelled', detail: job.detail })
        return
      }
      upsert(task)
    })

    const offNotesProgress = bridge.onBookGenerationProgress((event) => {
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
    const offNotesDone = bridge.onBookGenerationDone((event) => {
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
      if (!document.hasFocus()) desktopNotify(t('整本生成'), event.cancelled ? t('已取消') : event.failed.length > 0 ? t('有章节失败') : t('已完成'))
      refreshDurableTasks()
    })
    const offTranslateProgress = bridge.onBookTranslationProgress((event) => {
      upsert({
        id: `translate:${event.bookId}`,
        kind: 'translate',
        title: t('整本翻译'),
        detail: event.message
          ? `${event.title} · ${event.message}`
          : event.title
            ? `${t('正在翻译')} ${event.title}`
            : t('正在准备'),
        done: event.done,
        total: event.total,
        status: 'running',
      })
    })
    const offTranslateDone = bridge.onBookTranslationDone((event) => {
      patch(`translate:${event.bookId}`, {
        status: event.cancelled ? 'cancelled' : event.failed.length > 0 || event.error ? 'error' : 'done',
        done: event.translated + event.skipped + event.failed.length,
        detail: event.cancelled
          ? t('已取消')
          : event.error
            ? event.error
            : `${t('完成')} ${event.translated} ${t('节')}${event.skipped > 0 ? ` · ${t('跳过')} ${event.skipped} ${t('节')}` : ''}${event.failed.length > 0 ? ` · ${failureSummary(event.failed)}` : ''}`,
        failures: event.failed,
        retry:
          event.failed.length > 0
            ? { kind: 'translate', bookId: event.bookId, chapterIds: event.failed.map((failure) => failure.chapterId) }
            : undefined,
      })
      if (!document.hasFocus()) desktopNotify(t('整本翻译'), event.cancelled ? t('已取消') : event.error ? t('失败') : t('已完成'))
      refreshDurableTasks()
    })
    const offFormatProgress = bridge.onBookFormatProgress((event) => {
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
    const offFormatDone = bridge.onBookFormatDone((event) => {
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
      if (!document.hasFocus()) desktopNotify(t('整本 AI 排版'), event.cancelled ? t('已取消') : event.failed.length > 0 ? t('有章节失败') : t('已完成'))
      refreshDurableTasks()
    })
    const offOcrProgress = bridge.onOcrProgress((event) => {
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
    const offOcrDone = bridge.onOcrDone((event) => {
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
    const offOcrError = bridge.onOcrError((event) => {
      patch('ocr', { status: event.cancelled ? 'cancelled' : 'error', detail: event.message })
      notify({ kind: event.cancelled ? 'info' : 'error', text: event.message })
    })
    return () => {
      offAiJob()
      offNotesProgress()
      offNotesDone()
      offTranslateProgress()
      offTranslateDone()
      offFormatProgress()
      offFormatDone()
      offOcrProgress()
      offOcrDone()
      offOcrError()
    }
  }, [refreshDurableTasks, notify, onBooksChanged])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(TASKS_KEY, JSON.stringify(tasks.slice(0, 6)))
      } catch {
        // 本地任务历史只是辅助信息，存储失败不影响当前任务。
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [tasks])

  return { tasks, setTasks, refreshDurableTasks }
}
