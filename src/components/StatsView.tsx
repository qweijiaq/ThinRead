import { useMemo, useState, type JSX } from 'react'

import type { BookSummary } from '../../shared/types.js'
import { sharePalette, type ShareTheme } from '../lib/share-card.js'
import { t, useLocale } from '../lib/i18n.js'
import {
  getReadingMonth,
  getReadingSummary,
  getReadingYear,
  nextStreakMilestone,
  readingCsv,
  STREAK_MILESTONES,
} from '../lib/reading-stats.js'

function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} ${t('分钟')}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours} ${t('小时')} ${rest} ${t('分')}` : `${hours} ${t('小时')}`
}

function drawStatsImage(
  summary: ReturnType<typeof getReadingSummary>,
  month: ReturnType<typeof getReadingMonth>,
  year: ReturnType<typeof getReadingYear>,
  previousYear: ReturnType<typeof getReadingYear>,
  titleOf: (bookId: string) => string,
  mode: 'month' | 'year' | 'compare',
): string {
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1440
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#f7f3ec'
  ctx.fillRect(0, 0, 1080, 1440)
  ctx.fillStyle = '#2a2521'
  ctx.font = '500 44px "Songti SC", "Noto Serif CJK SC", serif'
  ctx.fillText(t('阅读统计'), 80, 110)
  ctx.fillStyle = '#8a8078'
  ctx.font = '22px "Songti SC", serif'
  ctx.fillText(
    mode === 'compare' ? `${year.year} vs ${previousYear.year}` : mode === 'year' ? String(year.year) : month.label,
    80,
    150,
  )

  const cards = [
    { label: t('今日'), value: summary.todaySeconds },
    { label: t('本周'), value: summary.weekSeconds },
    { label: month.label, value: month.seconds },
    { label: t('累计'), value: summary.totalSeconds },
  ]
  cards.forEach((card, index) => {
    const x = 80 + (index % 2) * 480
    const y = 200 + Math.floor(index / 2) * 160
    ctx.fillStyle = '#fffdf8'
    ctx.strokeStyle = '#e5ddd0'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(x, y, 440, 130, 18)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#8a8078'
    ctx.font = '22px "Songti SC", serif'
    ctx.fillText(card.label, x + 28, y + 44)
    ctx.fillStyle = '#2a2521'
    ctx.font = '500 34px "Songti SC", serif'
    ctx.fillText(duration(card.value), x + 28, y + 92)
  })

  ctx.fillStyle = '#2a2521'
  ctx.font = '26px "Songti SC", serif'
  ctx.fillText(`🔥 ${t('连续阅读')} ${summary.currentStreak} ${t('天')} · ${t('最长')} ${summary.longestStreak} ${t('天')}`, 80, 570)

  const baseY = 880
  if (mode === 'compare') {
    const max = Math.max(
      1,
      ...year.months.map((item) => item.seconds),
      ...previousYear.months.map((item) => item.seconds),
    )
    const slot = 920 / 12
    year.months.forEach((item, index) => {
      const previous = previousYear.months[index]?.seconds ?? 0
      const x = 80 + index * slot
      const height = Math.max(3, (item.seconds / max) * 220)
      const previousHeight = Math.max(3, (previous / max) * 220)
      ctx.fillStyle = '#b06a3b'
      ctx.beginPath()
      ctx.roundRect(x, baseY - height, 22, height, 5)
      ctx.fill()
      ctx.fillStyle = '#cbbba5'
      ctx.beginPath()
      ctx.roundRect(x + 26, baseY - previousHeight, 22, previousHeight, 5)
      ctx.fill()
      ctx.fillStyle = '#8a8078'
      ctx.font = '15px "Songti SC", serif'
      ctx.fillText(String(index + 1), x, baseY + 26)
    })
    ctx.fillStyle = '#8a8078'
    ctx.font = '18px "Songti SC", serif'
    ctx.fillText(`${duration(year.seconds)} / ${duration(previousYear.seconds)}`, 80, baseY + 58)
  } else {
    const bars =
      mode === 'year'
        ? year.months.map((item) => ({ key: String(Number(item.month.slice(5))), seconds: item.seconds }))
        : month.days.map((day) => ({ key: String(Number(day.date.slice(8))), seconds: day.seconds }))
    const maxBar = Math.max(1, ...bars.map((bar) => bar.seconds))
    const slot = 920 / bars.length
    const barWidth = Math.min(mode === 'year' ? 44 : 26, slot - 6)
    bars.forEach((bar, index) => {
      const x = 80 + index * slot
      const height = Math.max(4, (bar.seconds / maxBar) * 220)
      ctx.fillStyle = index === bars.length - 1 ? '#b06a3b' : '#c9a58b'
      ctx.beginPath()
      ctx.roundRect(x, baseY - height, barWidth, height, 6)
      ctx.fill()
    })
    ctx.fillStyle = '#8a8078'
    ctx.font = '18px "Songti SC", serif'
    const total = mode === 'year' ? year.seconds : month.seconds
    const label = mode === 'year' ? String(year.year) : month.label
    ctx.fillText(`${label} · ${duration(total)}`, 80, baseY + 42)
    const step = mode === 'year' ? 1 : 5
    for (let index = 0; index < bars.length; index += step) {
      ctx.fillText(bars[index]!.key, 80 + index * slot, baseY + 76)
    }
  }

  ctx.fillStyle = '#2a2521'
  ctx.font = '500 28px "Songti SC", serif'
  ctx.fillText(t('按书统计'), 80, 1030)
  const maxBook = Math.max(1, ...summary.books.map((book) => book.seconds))
  summary.books.slice(0, 6).forEach((book, index) => {
    const y = 1080 + index * 52
    ctx.fillStyle = '#2a2521'
    ctx.font = '22px "Songti SC", serif'
    const title = titleOf(book.bookId)
    ctx.fillText(title.length > 18 ? `${title.slice(0, 18)}…` : title, 80, y)
    ctx.fillStyle = '#e5ddd0'
    ctx.fillRect(360, y - 16, 420, 10)
    ctx.fillStyle = '#b06a3b'
    ctx.fillRect(360, y - 16, Math.max(4, (book.seconds / maxBook) * 420), 10)
    ctx.fillStyle = '#8a8078'
    ctx.font = '20px "Songti SC", serif'
    ctx.fillText(duration(book.seconds), 820, y)
  })

  ctx.fillStyle = '#8a8078'
  ctx.font = '18px "Songti SC", serif'
  const footer = `${new Date().toLocaleDateString()} · ${t('今日阅读')} ${duration(summary.todaySeconds)}`
  ctx.fillText(footer, 80, 1400)
  return canvas.toDataURL('image/png')
}

function drawBadgeImage(summary: ReturnType<typeof getReadingSummary>, theme: ShareTheme): string {
  const canvas = document.createElement('canvas')
  canvas.width = 900
  canvas.height = 1200
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const palette = sharePalette(theme)
  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, 900, 1200)
  ctx.fillStyle = palette.sheet
  ctx.beginPath()
  ctx.roundRect(48, 48, 804, 1104, 32)
  ctx.fill()
  ctx.fillStyle = palette.ink
  ctx.font = '500 42px "Songti SC", serif'
  ctx.textAlign = 'center'
  ctx.fillText(t('阅读里程碑'), 450, 170)
  ctx.fillStyle = palette.muted
  ctx.font = '22px "Songti SC", serif'
  ctx.fillText(`${t('连续阅读')} ${summary.currentStreak} ${t('天')} · ${t('最长')} ${summary.longestStreak} ${t('天')}`, 450, 220)

  ;[7, 30, 100].forEach((value, index) => {
    const unlocked = summary.longestStreak >= value
    const y = 320 + index * 230
    ctx.beginPath()
    ctx.arc(450, y, 82, 0, Math.PI * 2)
    ctx.fillStyle = unlocked ? palette.accent : palette.line
    ctx.fill()
    ctx.fillStyle = unlocked ? palette.sheet : palette.muted
    ctx.font = '64px "Songti SC", serif'
    ctx.fillText(unlocked ? '★' : '☆', 450, y + 24)
    ctx.fillStyle = unlocked ? palette.ink : palette.muted
    ctx.font = '500 32px "Songti SC", serif'
    ctx.fillText(`${value} ${t('天')}`, 450, y + 140)
    ctx.fillStyle = palette.muted
    ctx.font = '20px "Songti SC", serif'
    ctx.fillText(unlocked ? t('已达成') : t('未解锁'), 450, y + 174)
  })

  ctx.fillStyle = palette.muted
  ctx.font = '18px "Songti SC", serif'
  ctx.fillText(`${t('页边')} · ${new Date().toLocaleDateString()}`, 450, 1120)
  return canvas.toDataURL('image/png')
}

interface StatsViewProps {
  books: BookSummary[]
  onBack(): void
  onOpenWeeklyReview?(): void
  onOpenWeeklyReviews?(): void
  onSaveWeeklyReview?(markdown: string): Promise<void>
}

export function StatsView({ books, onBack, onOpenWeeklyReview, onOpenWeeklyReviews, onSaveWeeklyReview }: StatsViewProps): JSX.Element {
  useLocale()
  const [offset, setOffset] = useState(0)
  const [yearOffset, setYearOffset] = useState(0)
  const [copied, setCopied] = useState(false)
  const [imageBusy, setImageBusy] = useState<'month' | 'year' | 'compare' | null>(null)
  const [savingReview, setSavingReview] = useState(false)
  const [badgeTheme, setBadgeTheme] = useState<ShareTheme>(() => {
    try {
      return localStorage.getItem('reading-notes-badge-theme') === 'ink' ? 'ink' : 'paper'
    } catch {
      return 'paper'
    }
  })
  const [notice, setNotice] = useState<string | null>(null)
  const summary = useMemo(() => getReadingSummary(), [])
  const month = useMemo(() => getReadingMonth(offset), [offset])
  const year = useMemo(() => getReadingYear(yearOffset), [yearOffset])
  const previousYear = useMemo(() => getReadingYear(yearOffset - 1), [yearOffset])
  const titleOf = useMemo(() => {
    const map = new Map(books.map((book) => [book.id, book.title]))
    return (bookId: string) => map.get(bookId) ?? t('已移除的书')
  }, [books])

  async function exportImage(mode: 'month' | 'year' | 'compare'): Promise<void> {
    setImageBusy(mode)
    setNotice(null)
    try {
      const dataUrl = drawStatsImage(summary, month, year, previousYear, titleOf, mode)
      if (!dataUrl) throw new Error(t('无法生成统计图片。'))
      const name =
        mode === 'compare'
          ? `reading-stats-compare-${year.year}.png`
          : mode === 'year'
            ? `reading-stats-${year.year}.png`
            : `reading-stats-${month.label}.png`
      const result = await window.api.saveImage(dataUrl, name)
      if (result.saved) setNotice(`${t('已保存到')} ${result.path}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setImageBusy(null)
    }
  }

  function weeklyMarkdown(): string {
    const activeDays = summary.days.slice(-7).filter((day) => day.seconds > 0).length
    const lines = [
      `# ${t('本周复盘')} · ${summary.days[summary.days.length - 1]?.date ?? ''}`,
      '',
      `- ${t('本周阅读')}：${duration(summary.weekSeconds)}`,
      `- ${t('读了')} ${activeDays} ${t('天')}`,
      `- ${t('连续阅读')}：${summary.currentStreak} ${t('天')}`,
    ]
    for (const book of summary.books.slice(0, 5)) {
      lines.push(`- ${titleOf(book.bookId)}：${duration(book.seconds)}`)
    }
    return lines.join('\n')
  }

  const maxDay = Math.max(1, ...month.days.map((day) => day.seconds))
  const maxBook = Math.max(1, ...summary.books.map((book) => book.seconds))
  const maxYearMonth = Math.max(1, ...year.months.map((item) => item.seconds))
  const cards = [
    { label: t('今日'), value: summary.todaySeconds },
    { label: t('本周'), value: summary.weekSeconds },
    { label: month.label, value: month.seconds },
    { label: t('累计'), value: summary.totalSeconds },
  ]

  return (
    <main className="stats-view">
      <div className="stats-view-head">
        <button type="button" className="text-button muted" onClick={onBack}>
          ← {t('返回')}
        </button>
        <div className="stats-view-title-row">
          <h1>{t('阅读统计')}</h1>
          <div className="stats-view-actions">
            <button
              type="button"
              className="text-button"
              onClick={() => {
                void window.api.copyText(readingCsv(month)).then(() => {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1600)
                })
              }}
            >
              {copied ? t('已复制') : t('复制 CSV')}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={imageBusy !== null}
              onClick={() => void exportImage('month')}
            >
              {imageBusy === 'month' ? t('正在生成图片…') : t('导出月图')}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={imageBusy !== null}
              onClick={() => void exportImage('year')}
            >
              {imageBusy === 'year' ? t('正在生成图片…') : t('导出年图')}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={imageBusy !== null}
              onClick={() => void exportImage('compare')}
            >
              {imageBusy === 'compare' ? t('正在生成图片…') : t('导出对比图')}
            </button>
          </div>
        </div>
        <p>{t('看看时间花在了哪些书和哪些日子上。')}</p>
        {summary.currentStreak > 0 ? (
          <p className="stats-streak">
            🔥 {t('连续阅读')} {summary.currentStreak} {t('天')}
            {(() => {
              const next = nextStreakMilestone(summary.currentStreak)
              return next ? ` · ${t('距离')} ${next.next} ${t('天还差')} ${next.remaining} ${t('天')}` : ''
            })()}
            {' · '}
            {t('最长')} {summary.longestStreak} {t('天')}
          </p>
        ) : null}
      </div>

      <div className="stats-grid">
        {cards.map((card) => (
          <div key={card.label} className="stats-card">
            <span>{card.label}</span>
            <strong>{duration(card.value)}</strong>
          </div>
        ))}
      </div>

      <section className="stats-section">
        <div className="stats-month-head">
          <h3>{t('里程碑')}</h3>
          {summary.longestStreak >= 7 ? (
            <div className="stats-badge-actions">
              <div className="segmented compact">
                <button
                  type="button"
                  className={badgeTheme === 'paper' ? 'active' : ''}
                  onClick={() => {
                    setBadgeTheme('paper')
                    try {
                      localStorage.setItem('reading-notes-badge-theme', 'paper')
                    } catch {
                      // 忽略。
                    }
                  }}
                >
                  {t('纸')}
                </button>
                <button
                  type="button"
                  className={badgeTheme === 'ink' ? 'active' : ''}
                  onClick={() => {
                    setBadgeTheme('ink')
                    try {
                      localStorage.setItem('reading-notes-badge-theme', 'ink')
                    } catch {
                      // 忽略。
                    }
                  }}
                >
                  {t('墨')}
                </button>
              </div>
              <button
              type="button"
              className="text-button"
              disabled={imageBusy !== null}
              onClick={() => {
                void (async () => {
                  setImageBusy('month')
                  setNotice(null)
                  try {
                    const dataUrl = drawBadgeImage(summary, badgeTheme)
                    if (!dataUrl) throw new Error(t('无法生成统计图片。'))
                    const result = await window.api.saveImage(dataUrl, 'reading-milestones.png')
                    if (result.saved) setNotice(`${t('已保存到')} ${result.path}`)
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : String(error))
                  } finally {
                    setImageBusy(null)
                  }
                })()
              }}
            >
              {t('分享徽章')}
              </button>
            </div>
          ) : null}
        </div>
        <div className="stats-badges">
          {STREAK_MILESTONES.map((value) => {
            const unlocked = summary.longestStreak >= value
            return (
              <div key={value} className={`stats-badge${unlocked ? ' is-unlocked' : ''}`}>
                <span className="stats-badge-icon">{unlocked ? '★' : '☆'}</span>
                <strong>{value} {t('天')}</strong>
                <small>{unlocked ? t('已达成') : t('未解锁')}</small>
              </div>
            )
          })}
        </div>
      </section>

      <section className="stats-section stats-weekly">
        <h3>{t('本周复盘')}</h3>
        <p>
          {t('本周阅读')} {duration(summary.weekSeconds)} · {t('读了')}{' '}
          {summary.days.slice(-7).filter((day) => day.seconds > 0).length} {t('天')}
        </p>
        <div className="stats-weekly-actions">
          {onOpenWeeklyReview ? (
            <button type="button" className="ghost-button small" onClick={onOpenWeeklyReview}>
              {t('去工作台做本周复盘')}
            </button>
          ) : null}
          {onOpenWeeklyReviews ? (
            <button type="button" className="ghost-button small" onClick={onOpenWeeklyReviews}>
              {t('查看历次周复盘')}
            </button>
          ) : null}
          {onSaveWeeklyReview ? (
            <button
              type="button"
              className="ghost-button small"
              disabled={savingReview}
              onClick={() => {
                void (async () => {
                  setSavingReview(true)
                  setNotice(null)
                  try {
                    await onSaveWeeklyReview(weeklyMarkdown())
                    setNotice(t('已存为笔记。'))
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : String(error))
                  } finally {
                    setSavingReview(false)
                  }
                })()
              }}
            >
              {savingReview ? t('保存中…') : t('存为本周复盘笔记')}
            </button>
          ) : null}
        </div>
      </section>

      <section className="stats-section">
        <div className="stats-month-head">
          <h3>{t('月度')}</h3>
          <div className="stats-month-nav">
            <button type="button" className="text-button" onClick={() => setOffset((value) => value - 1)}>
              ‹ {t('上个月')}
            </button>
            <strong>{month.label}</strong>
            <button
              type="button"
              className="text-button"
              onClick={() => setOffset((value) => Math.min(0, value + 1))}
              disabled={offset >= 0}
            >
              {t('下个月')} ›
            </button>
          </div>
        </div>
        <div className="stats-month-days">
          {month.days.map((day) => (
            <div key={day.date} className="stats-month-day" title={`${day.date} · ${duration(day.seconds)}`}>
              <div className="stats-month-track">
                <span style={{ height: `${Math.max(2, (day.seconds / maxDay) * 100)}%` }} />
              </div>
              <small>{Number(day.date.slice(8))}</small>
            </div>
          ))}
        </div>
        <p className="field-hint">{month.label} · {duration(month.seconds)}</p>
      </section>

      <section className="stats-section">
        <div className="stats-month-head">
          <h3>{t('年度')}</h3>
          <div className="stats-month-nav">
            <button type="button" className="text-button" onClick={() => setYearOffset((value) => value - 1)}>
              ‹ {t('上一年')}
            </button>
            <strong>{year.year}</strong>
            <button
              type="button"
              className="text-button"
              onClick={() => setYearOffset((value) => Math.min(0, value + 1))}
              disabled={yearOffset >= 0}
            >
              {t('下一年')} ›
            </button>
          </div>
        </div>
        <div className="stats-year-months">
          {year.months.map((item) => (
            <div key={item.month} className="stats-year-month" title={`${item.month} · ${duration(item.seconds)}`}>
              <div className="stats-month-track">
                <span style={{ height: `${Math.max(2, (item.seconds / maxYearMonth) * 100)}%` }} />
              </div>
              <small>{Number(item.month.slice(5))}</small>
            </div>
          ))}
        </div>
        <p className="field-hint">{year.year} · {duration(year.seconds)}</p>
      </section>

      <section className="stats-section">
        <h3>{t('年度对比')}</h3>
        <div className="stats-compare">
          <div className="stats-compare-item">
            <span>{year.year}</span>
            <strong>{duration(year.seconds)}</strong>
            <small>{year.activeDays} {t('天')}</small>
          </div>
          <div className="stats-compare-delta">
            {previousYear.seconds > 0
              ? `${year.seconds >= previousYear.seconds ? '+' : ''}${Math.round(((year.seconds - previousYear.seconds) / previousYear.seconds) * 100)}%`
              : t('无上年数据')}
          </div>
          <div className="stats-compare-item">
            <span>{previousYear.year}</span>
            <strong>{duration(previousYear.seconds)}</strong>
            <small>{previousYear.activeDays} {t('天')}</small>
          </div>
        </div>
        <div className="stats-compare-chart">
          {year.months.map((item, index) => {
            const previous = previousYear.months[index]?.seconds ?? 0
            const max = Math.max(
              1,
              ...year.months.map((month) => month.seconds),
              ...previousYear.months.map((month) => month.seconds),
            )
            return (
              <div key={item.month} className="stats-compare-month">
                <div className="stats-compare-bars">
                  <span className="current" style={{ height: `${Math.max(2, (item.seconds / max) * 100)}%` }} />
                  <span className="previous" style={{ height: `${Math.max(2, (previous / max) * 100)}%` }} />
                </div>
                <small>{index + 1}</small>
              </div>
            )
          })}
        </div>
        <div className="stats-compare-legend">
          <span className="current" /> {year.year}
          <span className="previous" /> {previousYear.year}
        </div>
      </section>

      <section className="stats-section">
        <h3>{t('按书统计')}</h3>
        {summary.books.length === 0 ? (
          <p className="muted">{t('还没有阅读记录。')}</p>
        ) : (
          <div className="stats-books">
            {summary.books.slice(0, 10).map((book) => (
              <div key={book.bookId} className="stats-book">
                <span className="stats-book-title">{titleOf(book.bookId)}</span>
                <div className="stats-book-track">
                  <span style={{ width: `${Math.max(2, (book.seconds / maxBook) * 100)}%` }} />
                </div>
                <span className="stats-book-time">{duration(book.seconds)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {notice ? <p className="field-hint" role="status">{notice}</p> : null}
      {summary.totalSeconds === 0 ? <p className="field-hint">{t('阅读满 15 秒后才会开始记录。')}</p> : null}
    </main>
  )
}
