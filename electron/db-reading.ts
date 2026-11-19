import crypto from 'node:crypto'

import type {
  OcrJob,
  ReaderMark,
  ReaderMarkStyle,
  ReadingPlanDay,
  ReadingPlanInput,
  ReadingPlanRecord,
  ReadingPositionRecord,
  WeeklyReviewRecord,
} from '../shared/types.js'
import { getDatabase } from './database.js'

const database = getDatabase

function mapOcrJob(row: {
  id: string
  file_name: string
  file_path: string
  start_page: number
  end_page: number
  status: string
  current: number
  total: number
  created_at: string
  updated_at: string
}): OcrJob {
  const status =
    row.status === 'done' || row.status === 'error' || row.status === 'cancelled' || row.status === 'interrupted'
      ? row.status
      : 'running'
  return {
    id: row.id,
    fileName: row.file_name,
    filePath: row.file_path,
    startPage: row.start_page,
    endPage: row.end_page,
    status,
    current: row.current,
    total: row.total,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createOcrJob(input: {
  fileName: string
  filePath: string
  startPage: number
  endPage: number
}): OcrJob {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  database()
    .prepare(
      'INSERT INTO ocr_jobs (id, file_name, file_path, start_page, end_page, status, current, total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)',
    )
    .run(id, input.fileName, input.filePath, input.startPage, input.endPage, 'running', now, now)
  const job = getOcrJob(id)
  if (!job) throw new Error('OCR 任务创建失败。')
  return job
}

export function updateOcrJob(
  id: string,
  patch: { status?: OcrJob['status']; current?: number; total?: number },
): void {
  const current = getOcrJob(id)
  if (!current) return
  database()
    .prepare('UPDATE ocr_jobs SET status = ?, current = ?, total = ?, updated_at = ? WHERE id = ?')
    .run(
      patch.status ?? current.status,
      patch.current ?? current.current,
      patch.total ?? current.total,
      new Date().toISOString(),
      id,
    )
}

export function getOcrJob(id: string): OcrJob | null {
  const row = database().prepare('SELECT * FROM ocr_jobs WHERE id = ?').get(id) as
    | Parameters<typeof mapOcrJob>[0]
    | undefined
  return row ? mapOcrJob(row) : null
}

export function listOcrJobs(limit = 20): OcrJob[] {
  const rows = database()
    .prepare('SELECT * FROM ocr_jobs ORDER BY updated_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 50)) as unknown as Array<Parameters<typeof mapOcrJob>[0]>
  return rows.map(mapOcrJob)
}

export function markRunningOcrJobsInterrupted(): void {
  database().prepare("UPDATE ocr_jobs SET status = 'interrupted', updated_at = ? WHERE status = 'running'").run(new Date().toISOString())
}

export function listChapterMarks(chapterId: string): ReaderMark[] {
  const rows = database()
    .prepare('SELECT * FROM reader_marks WHERE chapter_id = ? ORDER BY created_at, rowid')
    .all(chapterId) as unknown as Array<{
    id: string
    book_id: string
    chapter_id: string
    quote: string
    style: ReaderMarkStyle
    created_at: string
  }>
  return rows.map((row) => ({
    id: row.id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    quote: row.quote,
    style: row.style,
    createdAt: row.created_at,
  }))
}

export function createChapterMark(input: { chapterId: string; quote: string; style: ReaderMarkStyle }): ReaderMark {
  const quote = input.quote.replace(/\s+/g, ' ').trim()
  if (!quote) throw new Error('没有选中文字。')
  if (quote.length > 4000) throw new Error('选中的文字太长。')
  const style: ReaderMarkStyle =
    input.style === 'underline' || input.style === 'strikethrough' ? input.style : 'highlight'
  const chapter = database().prepare('SELECT book_id FROM chapters WHERE id = ?').get(input.chapterId) as
    | { book_id: string }
    | undefined
  if (!chapter) throw new Error('找不到这一章。')
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  database()
    .prepare('INSERT INTO reader_marks (id, book_id, chapter_id, quote, style, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, chapter.book_id, input.chapterId, quote, style, now)
  return { id, bookId: chapter.book_id, chapterId: input.chapterId, quote, style, createdAt: now }
}

export function deleteChapterMark(id: string): void {
  database().prepare('DELETE FROM reader_marks WHERE id = ?').run(id)
}



export interface BookmarkRecord {
  id: string
  bookId: string
  chapterId: string
  chapterTitle: string
  scrollRatio: number
  scrollTop: number
  page: number | null
  label: string
  quote: string | null
  createdAt: string
}

export function getReadingPosition(chapterId: string): ReadingPositionRecord | null {
  const row = database()
    .prepare('SELECT * FROM reading_positions WHERE chapter_id = ?')
    .get(chapterId) as
    | {
        chapter_id: string
        book_id: string
        scroll_ratio: number
        scroll_top: number
        page: number | null
        updated_at: string
      }
    | undefined
  if (!row) return null
  return {
    chapterId: row.chapter_id,
    bookId: row.book_id,
    scrollRatio: Number(row.scroll_ratio) || 0,
    scrollTop: Number(row.scroll_top) || 0,
    page: row.page == null ? null : Number(row.page),
    updatedAt: row.updated_at,
  }
}

export function saveReadingPosition(input: {
  bookId: string
  chapterId: string
  scrollRatio: number
  scrollTop: number
  page?: number | null
}): void {
  const now = new Date().toISOString()
  database()
    .prepare(
      `INSERT INTO reading_positions (chapter_id, book_id, scroll_ratio, scroll_top, page, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(chapter_id) DO UPDATE SET
         book_id = excluded.book_id,
         scroll_ratio = excluded.scroll_ratio,
         scroll_top = excluded.scroll_top,
         page = excluded.page,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.chapterId,
      input.bookId,
      Math.min(1, Math.max(0, Number(input.scrollRatio) || 0)),
      Math.max(0, Number(input.scrollTop) || 0),
      input.page == null ? null : Math.max(1, Math.round(input.page)),
      now,
    )
}

/** PDF 原版查看只更新页码，保留章节滚动位置。 */
export function saveReadingPage(chapterId: string, bookId: string, page: number): void {
  const now = new Date().toISOString()
  database()
    .prepare(
      `INSERT INTO reading_positions (chapter_id, book_id, scroll_ratio, scroll_top, page, updated_at)
       VALUES (?, ?, 0, 0, ?, ?)
       ON CONFLICT(chapter_id) DO UPDATE SET
         page = excluded.page,
         updated_at = excluded.updated_at`,
    )
    .run(chapterId, bookId, Math.max(1, Math.round(page)), now)
}

export interface ReadingStatsRecord {
  total: number
  days: Record<string, number>
  books: Record<string, number>
}

const READING_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAY_SECONDS = 86_400 * 2
const MAX_TOTAL_SECONDS = 1_000_000_000_000

function normalizeReadingMap(value: unknown, keyPattern?: RegExp): Record<string, number> {
  const result: Record<string, number> = {}
  if (!value || typeof value !== 'object') return result
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (keyPattern && !keyPattern.test(key)) continue
    const seconds = Math.floor(Number(raw))
    if (!Number.isFinite(seconds) || seconds <= 0) continue
    result[key] = Math.min(MAX_DAY_SECONDS, seconds)
  }
  return result
}

/** 阅读统计持久化到数据库，随备份一起迁移；渲染层仍保留一份 localStorage 缓存。 */
export function getReadingStatsRecord(): ReadingStatsRecord {
  const dayRows = database().prepare('SELECT day, seconds FROM reading_stats_days').all() as unknown as Array<{
    day: string
    seconds: number
  }>
  const bookRows = database().prepare('SELECT book_id, seconds FROM reading_stats_books').all() as unknown as Array<{
    book_id: string
    seconds: number
  }>
  const totalRow = database().prepare("SELECT value FROM reading_stats_meta WHERE key = 'total'").get() as
    | { value: string }
    | undefined
  const days: Record<string, number> = {}
  for (const row of dayRows) {
    const seconds = Math.floor(Number(row.seconds))
    if (READING_DAY_PATTERN.test(row.day) && seconds > 0) days[row.day] = seconds
  }
  const books: Record<string, number> = {}
  for (const row of bookRows) {
    const seconds = Math.floor(Number(row.seconds))
    if (row.book_id && seconds > 0) books[row.book_id] = seconds
  }
  const summed = Object.values(days).reduce((sum, value) => sum + value, 0)
  const storedTotal = totalRow ? Math.floor(Number(totalRow.value)) : 0
  return {
    total: Math.min(MAX_TOTAL_SECONDS, Math.max(Number.isFinite(storedTotal) ? storedTotal : 0, summed)),
    days,
    books,
  }
}

/** 合并一份阅读统计快照。按天取较大值，避免启动同步或恢复备份时重复累加。 */
export function mergeReadingStatsRecord(raw: unknown): ReadingStatsRecord {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const days = normalizeReadingMap(input.days, READING_DAY_PATTERN)
  const books = normalizeReadingMap(input.books)
  const inputTotal = Math.min(MAX_TOTAL_SECONDS, Math.max(0, Math.floor(Number(input.total) || 0)))
  const total = Math.max(inputTotal, Object.values(days).reduce((sum, value) => sum + value, 0))
  const conn = database()
  conn.exec('BEGIN IMMEDIATE')
  try {
    const upsertDay = conn.prepare(
      `INSERT INTO reading_stats_days (day, seconds) VALUES (?, ?)
       ON CONFLICT(day) DO UPDATE SET seconds = MAX(reading_stats_days.seconds, excluded.seconds)`,
    )
    for (const [day, seconds] of Object.entries(days)) upsertDay.run(day, seconds)
    const upsertBook = conn.prepare(
      `INSERT INTO reading_stats_books (book_id, seconds) VALUES (?, ?)
       ON CONFLICT(book_id) DO UPDATE SET seconds = MAX(reading_stats_books.seconds, excluded.seconds)`,
    )
    for (const [bookId, seconds] of Object.entries(books)) upsertBook.run(bookId, seconds)
    conn
      .prepare(
        `INSERT INTO reading_stats_meta (key, value) VALUES ('total', ?)
         ON CONFLICT(key) DO UPDATE SET value = CAST(MAX(CAST(reading_stats_meta.value AS INTEGER), CAST(excluded.value AS INTEGER)) AS TEXT)`,
      )
      .run(String(total))
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
  return getReadingStatsRecord()
}

/** 阅读器每 15 秒写入一次；日期由渲染层按本地时区传入。 */
export function recordReadingStats(day: string, seconds: number, bookId?: string | null): void {
  if (!READING_DAY_PATTERN.test(day)) return
  const value = Math.floor(Number(seconds))
  if (!Number.isFinite(value) || value <= 0) return
  const current = getReadingStatsRecord()
  const nextTotal = Math.min(MAX_TOTAL_SECONDS, current.total + Math.min(MAX_DAY_SECONDS, value))
  const conn = database()
  conn.exec('BEGIN IMMEDIATE')
  try {
    conn
      .prepare(
        `INSERT INTO reading_stats_days (day, seconds) VALUES (?, ?)
         ON CONFLICT(day) DO UPDATE SET seconds = MIN(?, reading_stats_days.seconds + excluded.seconds)`,
      )
      .run(day, Math.min(MAX_DAY_SECONDS, value), MAX_DAY_SECONDS)
    if (bookId) {
      conn
        .prepare(
          `INSERT INTO reading_stats_books (book_id, seconds) VALUES (?, ?)
           ON CONFLICT(book_id) DO UPDATE SET seconds = reading_stats_books.seconds + excluded.seconds`,
        )
        .run(bookId, value)
    }
    conn
      .prepare(
        `INSERT INTO reading_stats_meta (key, value) VALUES ('total', ?)
         ON CONFLICT(key) DO UPDATE SET value = CAST(? AS TEXT)`,
      )
      .run(String(nextTotal), String(nextTotal))
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
}

function isoWeekKey(date: Date): string {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((target.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7)
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function migrateWeeklyReviewNotes(): void {
  try {
    // 旧笔记迁移只需要跑一次；否则每次启动都要全表 LIKE 扫一遍 notes。
    const done = database().prepare("SELECT value FROM meta WHERE key = 'weekly_review_migrated'").get()
    if (done) return
    const rows = database()
      .prepare(
        "SELECT title, content, updated_at FROM notes WHERE title LIKE '%每周复盘%' OR title LIKE '%Weekly review%'",
      )
      .all() as unknown as Array<{ title: string; content: string; updated_at: string }>
    const insert = database().prepare(
      `INSERT OR IGNORE INTO weekly_reviews (id, week, title, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    for (const row of rows) {
      const date = new Date(row.updated_at)
      const week = isoWeekKey(Number.isNaN(date.getTime()) ? new Date() : date)
      insert.run(crypto.randomUUID(), week, row.title, row.content, row.updated_at, row.updated_at)
    }
    database()
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('weekly_review_migrated', ?)")
      .run(new Date().toISOString())
  } catch {
    // 旧笔记迁移失败不影响启动；下次启动会再试。
  }
}

export function saveWeeklyReview(input: { week: string; title: string; content: string }): WeeklyReviewRecord {
  const week = input.week.trim()
  if (!/^\d{4}-W\d{2}$/.test(week)) throw new Error('周复盘周次无效。')
  if (!input.content.trim()) throw new Error('周复盘内容为空。')
  const now = new Date().toISOString()
  const conn = database()
  conn
    .prepare(
      `INSERT INTO weekly_reviews (id, week, title, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(week) DO UPDATE SET
         title = excluded.title,
         content = excluded.content,
         updated_at = excluded.updated_at`,
    )
    .run(crypto.randomUUID(), week, input.title.trim() || `每周复盘 · ${week}`, input.content, now, now)
  const row = conn.prepare('SELECT * FROM weekly_reviews WHERE week = ?').get(week) as unknown as {
    id: string
    week: string
    title: string
    content: string
    created_at: string
    updated_at: string
  }
  return {
    id: row.id,
    week: row.week,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listWeeklyReviews(limit = 200): WeeklyReviewRecord[] {
  const rows = database()
    .prepare('SELECT * FROM weekly_reviews ORDER BY updated_at DESC, created_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 500)) as unknown as Array<{
    id: string
    week: string
    title: string
    content: string
    created_at: string
    updated_at: string
  }>
  return rows.map((row) => ({
    id: row.id,
    week: row.week,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

function readingPlanDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

type ReadingPlanRow = { book_id: string; plan: string; created_at: string; updated_at: string }

function mapReadingPlanRow(row: ReadingPlanRow): ReadingPlanRecord | null {
  try {
    const parsed = JSON.parse(row.plan) as {
      startDate?: unknown
      dailyMinutes?: unknown
      days?: unknown
      done?: unknown
    }
    const days = Array.isArray(parsed.days)
      ? (parsed.days as Array<{ date?: unknown; chapterIds?: unknown; chars?: unknown }>)
          .map((day) => ({
            date: typeof day.date === 'string' ? day.date : '',
            chapterIds: Array.isArray(day.chapterIds)
              ? day.chapterIds.filter((id): id is string => typeof id === 'string')
              : [],
            chars: Math.max(0, Math.floor(Number(day.chars) || 0)),
          }))
          .filter((day) => day.chapterIds.length > 0)
      : []
    if (days.length === 0) return null
    return {
      bookId: row.book_id,
      startDate: typeof parsed.startDate === 'string' ? parsed.startDate : readingPlanDateKey(new Date()),
      dailyMinutes: Math.min(1440, Math.max(1, Math.floor(Number(parsed.dailyMinutes) || 30))),
      days,
      done: Array.isArray(parsed.done) ? parsed.done.filter((id): id is string => typeof id === 'string') : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

/** 阅读计划只保存“哪天读哪些章、哪些章已读”，章节顺序和字数在生成时已经确定。 */
export function getReadingPlan(bookId: string): ReadingPlanRecord | null {
  if (!bookId) return null
  const row = database()
    .prepare('SELECT book_id, plan, created_at, updated_at FROM reading_plans WHERE book_id = ?')
    .get(bookId) as ReadingPlanRow | undefined
  return row ? mapReadingPlanRow(row) : null
}

export function listReadingPlans(): ReadingPlanRecord[] {
  const rows = database()
    .prepare('SELECT book_id, plan, created_at, updated_at FROM reading_plans ORDER BY updated_at DESC')
    .all() as unknown as ReadingPlanRow[]
  return rows.map(mapReadingPlanRow).filter((plan): plan is ReadingPlanRecord => plan !== null)
}

export function saveReadingPlan(input: ReadingPlanInput): ReadingPlanRecord {
  if (!input || typeof input !== 'object') throw new Error('阅读计划参数无效。')
  const book = database().prepare('SELECT 1 AS ok FROM books WHERE id = ?').get(input.bookId)
  if (!book) throw new Error('找不到这本书。')
  const known = new Set(
    (database().prepare('SELECT id FROM chapters WHERE book_id = ?').all(input.bookId) as unknown as Array<{
      id: string
    }>).map((chapter) => chapter.id),
  )
  const seen = new Set<string>()
  const days: ReadingPlanDay[] = []
  for (const day of input.days ?? []) {
    const chapterIds = (day.chapterIds ?? []).filter((id) => known.has(id) && !seen.has(id))
    for (const id of chapterIds) seen.add(id)
    if (chapterIds.length === 0) continue
    days.push({
      date: /^\d{4}-\d{2}-\d{2}$/.test(day.date) ? day.date : readingPlanDateKey(new Date()),
      chapterIds,
      chars: Math.max(0, Math.floor(Number(day.chars) || 0)),
    })
  }
  if (days.length === 0) throw new Error('阅读计划里还没有章节。')
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(input.startDate)
    ? input.startDate
    : readingPlanDateKey(new Date())
  const dailyMinutes = Math.min(1440, Math.max(1, Math.floor(Number(input.dailyMinutes) || 30)))
  const done = [...new Set((input.done ?? []).filter((id) => known.has(id)))]
  const now = new Date().toISOString()
  const conn = database()
  const existing = conn.prepare('SELECT created_at FROM reading_plans WHERE book_id = ?').get(input.bookId) as
    | { created_at: string }
    | undefined
  conn
    .prepare(
      `INSERT INTO reading_plans (book_id, plan, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(book_id) DO UPDATE SET plan = excluded.plan, updated_at = excluded.updated_at`,
    )
    .run(
      input.bookId,
      JSON.stringify({ startDate, dailyMinutes, days, done }),
      existing?.created_at ?? now,
      now,
    )
  const saved = getReadingPlan(input.bookId)
  if (!saved) throw new Error('阅读计划保存失败。')
  return saved
}

export function deleteReadingPlan(bookId: string): void {
  if (!bookId) return
  database().prepare('DELETE FROM reading_plans WHERE book_id = ?').run(bookId)
}

export function listBookmarks(bookId: string): BookmarkRecord[] {
  const rows = database()
    .prepare(
      `SELECT b.id, b.book_id, b.chapter_id, c.title AS chapter_title, b.scroll_ratio,
              b.scroll_top, b.page, b.label, b.quote, b.created_at
       FROM bookmarks b
       JOIN chapters c ON c.id = b.chapter_id
       WHERE b.book_id = ?
       ORDER BY b.created_at DESC`,
    )
    .all(bookId) as unknown as Array<{
    id: string
    book_id: string
    chapter_id: string
    chapter_title: string
    scroll_ratio: number
    scroll_top: number
    page: number | null
    label: string
    quote: string | null
    created_at: string
  }>
  return rows.map((row) => ({
    id: row.id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    scrollRatio: Number(row.scroll_ratio) || 0,
    scrollTop: Number(row.scroll_top) || 0,
    page: row.page == null ? null : Number(row.page),
    label: row.label,
    quote: row.quote,
    createdAt: row.created_at,
  }))
}

export function createBookmark(input: {
  bookId: string
  chapterId: string
  scrollRatio: number
  scrollTop: number
  page?: number | null
  label: string
  quote?: string | null
}): BookmarkRecord {
  const scrollTop = Math.max(0, Number(input.scrollTop) || 0)
  const existing = database()
    .prepare(
      `SELECT id FROM bookmarks
       WHERE book_id = ? AND chapter_id = ? AND ABS(scroll_top - ?) <= 12
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(input.bookId, input.chapterId, scrollTop) as { id: string } | undefined
  if (existing) return listBookmarks(input.bookId).find((item) => item.id === existing.id)!

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  database()
    .prepare(
      `INSERT INTO bookmarks (id, book_id, chapter_id, scroll_ratio, scroll_top, page, label, quote, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.bookId,
      input.chapterId,
      Math.min(1, Math.max(0, Number(input.scrollRatio) || 0)),
      scrollTop,
      input.page == null ? null : Math.max(1, Math.round(input.page)),
      input.label.trim() || '书签',
      input.quote?.trim() || null,
      now,
    )
  return listBookmarks(input.bookId).find((item) => item.id === id)!
}

export function deleteBookmark(id: string): void {
  database().prepare('DELETE FROM bookmarks WHERE id = ?').run(id)
}

