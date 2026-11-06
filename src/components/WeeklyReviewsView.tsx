import { useEffect, useMemo, useState, type JSX } from 'react'

import type { WeeklyReviewRecord } from '../../shared/types.js'
import { t, useLocale } from '../lib/i18n.js'
import { Select } from './Select.js'
import { Markdown } from './Markdown.js'

interface WeeklyReviewsViewProps {
  onBack(): void
}

export function WeeklyReviewsView({ onBack }: WeeklyReviewsViewProps): JSX.Element {
  useLocale()
  const [items, setItems] = useState<WeeklyReviewRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [yearFilter, setYearFilter] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api
      .listWeeklyReviews()
      .then((list) => {
        if (!cancelled) setItems(list.slice(0, 200))
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const years = useMemo(
    () => [...new Set(items.map((item) => item.week.slice(0, 4) || item.updatedAt.slice(0, 4)))].sort().reverse(),
    [items],
  )
  const filtered = useMemo(
    () => items.filter((item) => !yearFilter || item.week.startsWith(yearFilter) || item.updatedAt.startsWith(yearFilter)),
    [items, yearFilter],
  )
  const heading = `${t('历次周复盘')} · ${filtered.length}`

  async function copyReview(item: WeeklyReviewRecord): Promise<void> {
    await window.api.copyText(`${item.title}\n\n${item.content}`)
    setCopiedId(item.id)
    window.setTimeout(() => setCopiedId(null), 1600)
  }

  return (
    <main className="weekly-view">
      <div className="stats-view-head">
        <button type="button" className="text-button muted" onClick={onBack}>
          ← {t('返回')}
        </button>
        <h1>{t('历次周复盘')}</h1>
        <p>{heading}</p>
      </div>

      {loading ? <p className="field-hint">{t('正在加载…')}</p> : null}
      {!loading && items.length === 0 ? (
        <p className="field-hint">{t('还没有周复盘。去统计页保存一份本周复盘吧。')}</p>
      ) : null}

      <div className="weekly-filters">
        <Select
          value={yearFilter}
          onChange={setYearFilter}
          ariaLabel={t('按年份筛选')}
          options={[{ value: '', label: t('全部年份') }, ...years.map((year) => ({ value: year, label: year }))]}
        />
      </div>

      <div className="weekly-list">
        {filtered.map((item) => {
          const expanded = expandedId === item.id
          return (
            <div key={item.id} className={`weekly-item${expanded ? ' is-open' : ''}`}>
              <button
                type="button"
                className="weekly-item-head"
                aria-expanded={expanded}
                onClick={() => setExpandedId(expanded ? null : item.id)}
              >
                <span className="weekly-item-book">{item.week}</span>
                <strong>{item.title}</strong>
                <span className="weekly-item-snippet">{item.content.replace(/[#*\n]/g, ' ').slice(0, 100)}</span>
                <span className="weekly-item-time">{item.updatedAt.slice(0, 10)}</span>
              </button>
              {expanded ? (
                <div className="weekly-item-body">
                  <div className="weekly-item-actions">
                    <button type="button" className="text-button" onClick={() => void copyReview(item)}>
                      {copiedId === item.id ? t('已复制') : t('复制全文')}
                    </button>
                  </div>
                  <Markdown text={item.content} />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </main>
  )
}
