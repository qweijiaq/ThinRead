import { useEffect, useMemo, useState, type JSX } from 'react'

import type { BookSummary, Note } from '../../shared/types.js'
import { t, useLocale } from '../lib/i18n.js'
import { Select } from './Select.js'
import { Markdown } from './Markdown.js'

interface WeeklyReviewItem {
  note: Note
  bookTitle: string
}

interface WeeklyReviewsViewProps {
  books: BookSummary[]
  onBack(): void
}

function isWeeklyReview(title: string): boolean {
  return /每周复盘|Weekly review/i.test(title)
}

export function WeeklyReviewsView({ books, onBack }: WeeklyReviewsViewProps): JSX.Element {
  useLocale()
  const [items, setItems] = useState<WeeklyReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [bookFilter, setBookFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    void Promise.all(
      books.map(async (book) => {
        const notes = await window.api.listNotes(book.id)
        return notes.filter((note) => isWeeklyReview(note.title)).map((note) => ({ note, bookTitle: book.title }))
      }),
    )
      .then((groups) => {
        if (cancelled) return
        setItems(
          groups
            .flat()
            .sort((a, b) => b.note.updatedAt.localeCompare(a.note.updatedAt))
            .slice(0, 120),
        )
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
  }, [books])

  const years = useMemo(
    () => [...new Set(items.map((item) => item.note.updatedAt.slice(0, 4)))].sort().reverse(),
    [items],
  )
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (!bookFilter || item.bookTitle === bookFilter) && (!yearFilter || item.note.updatedAt.startsWith(yearFilter)),
      ),
    [bookFilter, items, yearFilter],
  )
  const heading = `${t('历次周复盘')} · ${filtered.length}`
  const bookOptions = [...new Set(items.map((item) => item.bookTitle))]

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
          value={bookFilter}
          onChange={setBookFilter}
          ariaLabel={t('按书筛选')}
          options={[{ value: '', label: t('全部书') }, ...bookOptions.map((title) => ({ value: title, label: title }))]}
        />
        <Select
          value={yearFilter}
          onChange={setYearFilter}
          ariaLabel={t('按年份筛选')}
          options={[{ value: '', label: t('全部年份') }, ...years.map((year) => ({ value: year, label: year }))]}
        />
      </div>

      <div className="weekly-list">
        {filtered.map((item) => {
          const expanded = expandedId === item.note.id
          return (
            <div key={item.note.id} className={`weekly-item${expanded ? ' is-open' : ''}`}>
              <button
                type="button"
                className="weekly-item-head"
                aria-expanded={expanded}
                onClick={() => setExpandedId(expanded ? null : item.note.id)}
              >
                <span className="weekly-item-book">{item.bookTitle}</span>
                <strong>{item.note.title}</strong>
                <span className="weekly-item-snippet">{item.note.content.replace(/[#*\n]/g, ' ').slice(0, 100)}</span>
                <span className="weekly-item-time">{item.note.updatedAt.slice(0, 10)}</span>
              </button>
              {expanded ? (
                <div className="weekly-item-body">
                  <Markdown text={item.note.content} />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </main>
  )
}
