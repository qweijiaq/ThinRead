import { useEffect, useMemo, useState, type JSX } from 'react'

import type { BookSummary, ChapterMeta, ReadingPlanRecord } from '../../shared/types.js'
import { t, getLocale, useLocale } from '../lib/i18n.js'
import { getDailyGoal } from '../lib/preferences.js'
import {
  buildReadingPlan,
  readingPlanDateKey,
  readingPlanDoneDays,
  readingPlanMinutes,
} from '../lib/reading-plan.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import { Checkbox } from './Checkbox.js'
import { confirmDialog } from './ConfirmDialog.js'
import { Select } from './Select.js'

interface ReadingPlanDialogProps {
  book: BookSummary
  onOpenChapter(chapterId: string): void
  onClose(): void
}

const MINUTE_OPTIONS = [15, 20, 30, 45, 60, 90]

function formatChars(value: number): string {
  if (getLocale() === 'en') {
    return value >= 10000 ? `${(value / 1000).toFixed(1)}k chars` : `${value.toLocaleString()} chars`
  }
  if (value >= 10000) {
    const wan = value / 10000
    return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1)} 万字`
  }
  return `${value.toLocaleString()} 字`
}

function planDayLabel(index: number, date: string): string {
  const day = getLocale() === 'en' ? `Day ${index + 1}` : `第 ${index + 1} 天`
  return date === readingPlanDateKey() ? `${day} · ${t('今天')}` : `${day} · ${date.slice(5).replace('-', '/')}`
}

function planDayMeta(count: number, chars: number): string {
  const minutes = readingPlanMinutes(chars)
  if (getLocale() === 'en') return `${count} ${count === 1 ? 'chapter' : 'chapters'} · ${minutes} min`
  return `${count} ${t('节')} · ${t('约')} ${minutes} ${t('分钟')}`
}

function planSummary(chars: number, days: number, doneDays: number): string {
  if (getLocale() === 'en') {
    return `${formatChars(chars)} · about ${days} ${days === 1 ? 'day' : 'days'} · ${doneDays} done`
  }
  return `${t('共')} ${formatChars(chars)} · ${t('约')} ${days} ${t('天')} · ${t('已完成')} ${doneDays} ${t('天')}`
}

function planInput(plan: ReadingPlanRecord): ReadingPlanRecord {
  return {
    bookId: plan.bookId,
    startDate: plan.startDate,
    dailyMinutes: plan.dailyMinutes,
    days: plan.days,
    done: plan.done,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  }
}

export function ReadingPlanDialog({ book, onOpenChapter, onClose }: ReadingPlanDialogProps): JSX.Element {
  useLocale()
  const [chapters, setChapters] = useState<ChapterMeta[] | null>(null)
  const [plan, setPlan] = useState<ReadingPlanRecord | null>(null)
  const [dailyMinutes, setDailyMinutes] = useState(30)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose, 'button')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const [opened, saved] = await Promise.all([
          window.api.openBook(book.id),
          window.api.getReadingPlan(book.id),
        ])
        if (cancelled) return
        setChapters(opened.chapters)
        const minutes = saved?.dailyMinutes ?? (getDailyGoal() || 30)
        setDailyMinutes(minutes)
        if (saved) {
          setPlan(saved)
          return
        }
        const days = buildReadingPlan(opened.chapters, readingPlanDateKey(), minutes)
        const draft: ReadingPlanRecord = {
          bookId: book.id,
          startDate: readingPlanDateKey(),
          dailyMinutes: minutes,
          days,
          done: [],
          createdAt: '',
          updatedAt: '',
        }
        setPlan(draft)
        if (days.length > 0) {
          const stored = await window.api.saveReadingPlan(planInput(draft))
          if (!cancelled) setPlan(stored)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [book.id])

  const chapterMap = useMemo(() => new Map((chapters ?? []).map((chapter) => [chapter.id, chapter])), [chapters])
  const done = useMemo(() => new Set(plan?.done ?? []), [plan?.done])
  const totalChapters = chapters?.filter((chapter) => !chapter.hidden && chapter.chars > 0).length ?? 0
  const totalChars = plan?.days.reduce((sum, day) => sum + day.chars, 0) ?? 0
  const totalMinutes = readingPlanMinutes(totalChars)
  const doneChapters = done.size
  const doneDays = plan ? readingPlanDoneDays(plan.days, plan.done) : 0
  const progress = totalChapters > 0 ? Math.min(100, Math.round((doneChapters / totalChapters) * 100)) : 0
  const minuteOptions = [...new Set([...MINUTE_OPTIONS, dailyMinutes])]
    .sort((a, b) => a - b)
    .map((minutes) => ({ value: String(minutes), label: `${minutes} ${t('分钟')}` }))

  async function persist(next: ReadingPlanRecord): Promise<boolean> {
    setSaving(true)
    setError(null)
    try {
      const stored = await window.api.saveReadingPlan(planInput(next))
      setPlan(stored)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  function changeMinutes(value: string): void {
    const minutes = Number(value)
    if (!chapters || !plan || !Number.isFinite(minutes) || minutes <= 0 || minutes === dailyMinutes) return
    setDailyMinutes(minutes)
    const days = buildReadingPlan(chapters, readingPlanDateKey(), minutes)
    if (days.length === 0) return
    const kept = new Set(days.flatMap((day) => day.chapterIds))
    void persist({
      ...plan,
      startDate: readingPlanDateKey(),
      dailyMinutes: minutes,
      days,
      done: plan.done.filter((id) => kept.has(id)),
    })
  }

  function toggleChapter(chapterId: string): void {
    if (!plan) return
    const nextDone = done.has(chapterId)
      ? plan.done.filter((id) => id !== chapterId)
      : [...plan.done, chapterId]
    const next = { ...plan, done: nextDone }
    const previous = plan
    setPlan(next)
    void persist(next).then((ok) => {
      if (!ok) setPlan(previous)
    })
  }

  async function clearPlan(): Promise<void> {
    const confirmed = await confirmDialog({
      title: t('清除阅读计划'),
      message: `${t('清除')}《${book.title}》${t('的阅读计划？已读标记也会一起清除。')}`,
      confirmLabel: t('清除'),
      danger: true,
    })
    if (!confirmed) return
    try {
      await window.api.deleteReadingPlan(book.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal reading-plan-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('阅读计划')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{t('阅读计划')}</h2>
            <p className="muted">{book.title}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        {loading ? (
          <p className="muted">{t('正在生成计划…')}</p>
        ) : error ? (
          <div className="inline-error" role="alert">{error}</div>
        ) : !plan || plan.days.length === 0 ? (
          <p className="content-empty">{t('这本书还没有可排入计划的章节。')}</p>
        ) : (
          <>
            <div className="reading-plan-summary">
              <div className="stats-cards">
                <div className="stats-card">
                  <span>{t('计划天数')}</span>
                  <strong>{plan.days.length}</strong>
                </div>
                <div className="stats-card">
                  <span>{t('总章节')}</span>
                  <strong>{totalChapters}</strong>
                </div>
                <div className="stats-card">
                  <span>{t('已完成')}</span>
                  <strong>{doneChapters}</strong>
                </div>
                <div className="stats-card">
                  <span>{t('预计用时')}</span>
                  <strong>{totalMinutes} {t('分钟')}</strong>
                </div>
              </div>
              <div className="reading-plan-controls">
                <label>
                  <span>{t('每天阅读')}</span>
                  <Select
                    value={String(dailyMinutes)}
                    onChange={changeMinutes}
                    ariaLabel={t('每天阅读分钟')}
                    options={minuteOptions}
                  />
                </label>
                <span className="muted">{planSummary(totalChars, plan.days.length, doneDays)}</span>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-label={`${book.title} ${t('的阅读计划进度')}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div className="reading-plan-days">
              {plan.days.map((day, index) => {
                const dayDone = day.chapterIds.length > 0 && day.chapterIds.every((id) => done.has(id))
                return (
                  <section key={`${day.date}-${index}`} className={`reading-plan-day${dayDone ? ' is-done' : ''}`}>
                    <div className="reading-plan-day-head">
                      <strong>{planDayLabel(index, day.date)}</strong>
                      <span>{planDayMeta(day.chapterIds.length, day.chars)}</span>
                    </div>
                    <ul>
                      {day.chapterIds.map((chapterId) => {
                        const chapter = chapterMap.get(chapterId)
                        if (!chapter) return null
                        return (
                          <li key={chapterId} className={done.has(chapterId) ? 'is-done' : ''}>
                            <Checkbox
                              checked={done.has(chapterId)}
                              onChange={() => toggleChapter(chapterId)}
                              ariaLabel={`${chapter.title} ${t('已读')}`}
                            />
                            <button type="button" className="text-button" onClick={() => onOpenChapter(chapterId)}>
                              {chapter.title}
                            </button>
                            <span className="muted">{formatChars(chapter.chars)}</span>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
            </div>
          </>
        )}

        <div className="modal-footer">
          <span className="modal-meta">{saving ? t('保存中…') : t('勾选章节即可记录进度')}</span>
          <div className="modal-footer-actions">
            <button type="button" className="text-button danger" onClick={() => void clearPlan()} disabled={!plan || saving}>
              {t('清除计划')}
            </button>
            <button type="button" className="ghost-button" onClick={onClose}>
              {t('关闭')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
