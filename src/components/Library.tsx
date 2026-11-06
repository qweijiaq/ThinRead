import { useEffect, useMemo, useState, useSyncExternalStore, type JSX } from 'react'
import type { BookSummary, ReadingPlanRecord } from '../../shared/types.js'
import { bookGenreLabel } from '../lib/genres.js'
import { countUnit, getLocale, t, useLocale } from '../lib/i18n.js'
import { getDailyGoal, subscribePreferences } from '../lib/preferences.js'
import { readingPlanDateKey, readingPlanMinutes } from '../lib/reading-plan.js'
import { getReadingSummary, readingMinutes } from '../lib/reading-stats.js'
import { confirmDialog } from './ConfirmDialog.js'
import { Select } from './Select.js'

interface LibraryProps {
  books: BookSummary[]
  importing: boolean
  onOpen(bookId: string): void
  onImport(): void
  onDelete(bookId: string): void
  onRename(book: BookSummary): void
  onCompose(bookId: string): void
  onPlan(book: BookSummary): void
  onOpenPlan(bookId: string, chapterId: string): void
  planVersion: number
  onMerge(): void
  onSettings(): void
  onStats(): void
  demo: boolean
}

function formatWords(value: number): string {
  if (getLocale() === 'en') {
    return value >= 10000 ? `${(value / 1000).toFixed(1)}k chars` : `${value.toLocaleString()} chars`
  }
  if (value >= 10000) {
    const wan = value / 10000
    return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1)} 万字`
  }
  return `${value.toLocaleString()} 字`
}

type LibrarySort = 'recent' | 'title' | 'progress' | 'chars'

export function Library({ books, importing, onOpen, onImport, onDelete, onRename, onCompose, onPlan, onOpenPlan, planVersion, onMerge, onSettings, onStats, demo }: LibraryProps): JSX.Element {
  useLocale()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<LibrarySort>('recent')
  const [covers, setCovers] = useState<Record<string, string>>({})
  const reading = getReadingSummary()
  const goalMinutes = useSyncExternalStore(subscribePreferences, getDailyGoal, getDailyGoal)
  useEffect(() => {
    let cancelled = false
    const candidates = books.filter((book) => book.hasCover)
    if (candidates.length === 0) {
      setCovers({})
      return
    }
    void Promise.all(
      candidates.map(async (book) => [book.id, await window.api.getBookCover(book.id)] as const),
    ).then((entries) => {
      if (cancelled) return
      setCovers(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))))
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [books])

  const [plans, setPlans] = useState<ReadingPlanRecord[]>([])
  useEffect(() => {
    let cancelled = false
    void window.api
      .listReadingPlans()
      .then((items) => {
        if (!cancelled) setPlans(Array.isArray(items) ? items : [])
      })
      .catch(() => {
        if (!cancelled) setPlans([])
      })
    return () => {
      cancelled = true
    }
  }, [planVersion, books])

  const todayPlans = useMemo(() => {
    const today = readingPlanDateKey()
    const bookMap = new Map(books.map((book) => [book.id, book]))
    const items: Array<{
      plan: ReadingPlanRecord
      book: BookSummary
      chapterIds: string[]
      firstChapterId: string
      chars: number
      total: number
      done: number
    }> = []
    for (const plan of plans) {
      const book = bookMap.get(plan.bookId)
      if (!book) continue
      const done = new Set(plan.done)
      const total = plan.days.reduce((sum, day) => sum + day.chapterIds.length, 0)
      if (total === 0) continue
      const day =
        plan.days.find((item) => item.date === today && item.chapterIds.some((id) => !done.has(id))) ??
        plan.days.find((item) => item.chapterIds.some((id) => !done.has(id)))
      if (!day) continue
      const remaining = day.chapterIds.filter((id) => !done.has(id))
      items.push({
        plan,
        book,
        chapterIds: remaining,
        firstChapterId: remaining[0] ?? day.chapterIds[0]!,
        chars: day.chars,
        total,
        done: plan.done.length,
      })
      if (items.length >= 3) break
    }
    return items
  }, [books, plans])

  const visibleBooks = useMemo(() => {
    const term = query.trim().toLowerCase()
    const filtered = term
      ? books.filter((book) => `${book.title} ${book.author}`.toLowerCase().includes(term))
      : books
    // SQLite 返回的顺序已经按最近打开时间排序，这里只重排用户明确选择的维度。
    return [...filtered].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'zh-CN')
      if (sort === 'progress') return b.progress - a.progress || b.readChars - a.readChars
      if (sort === 'chars') return b.totalChars - a.totalChars
      return 0
    })
  }, [books, query, sort])

  if (books.length === 0) {
    return (
      <main className="welcome">
        <div className="welcome-mark">{t('页边')}</div>
        <h1>{t('把一本书读成自己的')}</h1>
        <p className="welcome-lead">
          {t(
            'AI 先替你读一遍，生成带原文引用的笔记草稿；你边读边改、补充、把想法连起来。 书和笔记都在本地。当前默认是演示模式，不需要 API Key；要使用真实模型，点下方「配置模型」。',
          )}
        </p>
        <div className="welcome-actions">
          <button type="button" className="primary-button large" onClick={onImport} disabled={importing}>
            {importing ? t('正在解析…') : t('导入一本书')}
          </button>
          <button type="button" className="ghost-button large" onClick={onSettings}>
            {demo ? t('配置真实模型') : t('模型设置')}
          </button>
        </div>
        <div className="welcome-grid">
          <div>
            <h3>{t('按章生成')}</h3>
            <p>{t('读到哪一章生成到哪一章，摘要、论点、问题都附原文，可逐条修改。')}</p>
          </div>
          <div>
            <h3>{t('边读边写')}</h3>
            <p>{t('选中正文就能记想法，笔记和原文互相跳转，阅读位置不丢。')}</p>
          </div>
          <div>
            <h3>{t('笔记互链')}</h3>
            <p>{t('用 [[笔记标题]] 互相引用，自动出现反向链接和跨章相关笔记。')}</p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="library">
      {demo ? (
        <div className="library-demo-banner">
          <span>{t('当前是演示模式，生成结果是示例内容。')}</span>
          <button type="button" className="text-button" onClick={onSettings}>
            {t('配置真实模型')}
          </button>
        </div>
      ) : null}
      <div className="library-head">
        <div>
          <h1>{t('书架')}</h1>
          <p>
            {books.length} {countUnit(books.length, t('本书'), t('本书一'))} · {formatWords(books.reduce((sum, book) => sum + book.totalChars, 0))} ·{' '}
            {books.reduce((sum, book) => sum + book.noteCount, 0)} {countUnit(books.reduce((sum, book) => sum + book.noteCount, 0), t('条笔记'), t('条笔记一'))}
            {reading.todaySeconds >= 60 || goalMinutes > 0
              ? ` · ${t('今日阅读')} ${readingMinutes(reading.todaySeconds)}${goalMinutes > 0 ? ` / ${goalMinutes}` : ''} ${t('分钟')}`
              : ''}
            {reading.weekSeconds >= 60 ? ` · ${t('本周阅读')} ${readingMinutes(reading.weekSeconds)} ${t('分钟')}` : ''}
            {reading.currentStreak >= 2 ? ` · ${t('连续阅读')} ${reading.currentStreak} ${t('天')}` : ''}
          </p>
        </div>
        <div className="library-head-actions">
          <button type="button" className="text-button muted" onClick={onStats}>
            {t('阅读统计')}
          </button>
          {books.length >= 2 ? (
            <button type="button" className="ghost-button" onClick={onMerge}>
              {t('合并书籍')}
            </button>
          ) : null}
          <button type="button" className="primary-button" onClick={onImport} disabled={importing}>
            {importing ? t('正在解析…') : t('导入新书')}
          </button>
        </div>
      </div>
      <div className="library-toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('搜索书名或作者…')}
          aria-label={t('搜索书架')}
        />
        <Select
          value={sort}
          onChange={(value) => setSort(value as LibrarySort)}
          ariaLabel={t('书架排序')}
          options={[
            { value: 'recent', label: t('最近阅读') },
            { value: 'title', label: t('书名') },
            { value: 'progress', label: t('阅读进度') },
            { value: 'chars', label: t('总字数') },
          ]}
        />
        <span>{visibleBooks.length} {t('本')}</span>
      </div>
      {todayPlans.length > 0 ? (
        <section className="library-plan" aria-label={t('今日阅读计划')}>
          <div className="library-plan-head">
            <strong>{t('今日阅读计划')}</strong>
            <span>{t('按计划继续，读一点也算进度')}</span>
          </div>
          <div className="library-plan-list">
            {todayPlans.map((item) => (
              <div key={item.plan.bookId} className="library-plan-item">
                <div>
                  <strong>{item.book.title}</strong>
                  <span>
                    {item.chapterIds.length} {t('节')} · {t('约')} {readingPlanMinutes(item.chars)} {t('分钟')} ·{' '}
                    {t('已完成')} {item.done} / {item.total}
                  </span>
                </div>
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={() => onOpenPlan(item.book.id, item.firstChapterId)}
                >
                  {t('继续')}
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <div className="book-grid">
        {visibleBooks.map((book) => (
          <article
            key={book.id}
            className="book-card"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(book.id)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpen(book.id)
              }
            }}
          >
            <div className={`book-cover-frame ${book.format}`}>
              {covers[book.id] ? (
                <img src={covers[book.id]} alt={`${book.title} ${t('封面')}`} />
              ) : (
                <div className="book-cover-placeholder">
                  <span>{book.title.slice(0, 14)}</span>
                  <em>{book.author || t('页边')}</em>
                </div>
              )}
            </div>
            <div className="book-body">
              <h3>{book.title}</h3>
              <p className="book-author">{book.author || t('未知作者')}</p>
              <div className="book-meta">
                <span>{formatWords(book.totalChars)}</span>
                <span>{book.chapterCount} {countUnit(book.chapterCount, t('节'), t('节一'))}</span>
                {book.hiddenChapterCount > 0 ? <span>{t('已隐藏')} {book.hiddenChapterCount}</span> : null}
                <span>{book.noteCount} {countUnit(book.noteCount, t('条笔记'), t('条笔记一'))}</span>
                <span>{book.format.toUpperCase()}</span>
                <span>{t(bookGenreLabel(book.genre))}</span>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-label={`${book.title} ${t('的阅读进度')}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(book.progress * 100)}
              >
                <div className="progress-fill" style={{ width: `${Math.round(book.progress * 100)}%` }} />
              </div>
              <div className="book-actions">
                <span>
                  {book.progress > 0
                    ? `${t('已读')} ${Math.round(book.progress * 100)}% · ${formatWords(book.readChars)}`
                    : t('尚未开始')}
                </span>
                <span className="book-action-buttons">
                  <button
                    type="button"
                    className="text-button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onPlan(book)
                    }}
                  >
                    {t('计划')}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onCompose(book.id)
                    }}
                  >
                    {t('成书')}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onRename(book)
                    }}
                  >
                    {t('改名')}
                  </button>
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={(event) => {
                      event.stopPropagation()
                      void confirmDialog({
                        title: t('移除书籍'),
                        message: `${t('从书架移除')}《${book.title}》${t('？笔记也会一并删除。')}`,
                        confirmLabel: t('移除'),
                        danger: true,
                      }).then((confirmed) => {
                        if (confirmed) onDelete(book.id)
                      })
                    }}
                  >
                    {t('移除')}
                  </button>
                </span>
              </div>
            </div>
          </article>
        ))}
        {visibleBooks.length === 0 ? (
          <p className="library-filter-empty">{t('没有匹配')}「{query.trim()}」{t('的书。')}</p>
        ) : null}
      </div>
    </main>
  )
}
