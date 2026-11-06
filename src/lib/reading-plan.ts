import type { ChapterMeta, ReadingPlanDay } from '../../shared/types.js'

/** 中文深读大致按每分钟 400 字估算，只用于排计划，不做精确阅读速度承诺。 */
export const CHARS_PER_MINUTE = 400

export function readingPlanDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function addReadingPlanDays(dateKey: string, offset: number): string {
  const [year, month, day] = dateKey.split('-').map((part) => Number(part))
  const date = new Date(year, (month || 1) - 1, (day || 1) + offset)
  return readingPlanDateKey(date)
}

export function readingPlanMinutes(chars: number): number {
  return Math.max(1, Math.round(chars / CHARS_PER_MINUTE))
}

/**
 * 按每天可读分钟数，把可见章节按原顺序连续分到各天。
 * 这是本地计算，不调用模型，也不改动书籍或笔记。
 */
export function buildReadingPlan(
  chapters: ChapterMeta[],
  startDate = readingPlanDateKey(),
  dailyMinutes = 30,
): ReadingPlanDay[] {
  const minutes = Math.min(1440, Math.max(1, Math.floor(Number(dailyMinutes) || 30)))
  const target = minutes * CHARS_PER_MINUTE
  const readable = chapters
    .filter((chapter) => !chapter.hidden && chapter.chars > 0)
    .sort((a, b) => a.idx - b.idx)
  const days: ReadingPlanDay[] = []
  let chapterIds: string[] = []
  let chars = 0

  function flush(): void {
    if (chapterIds.length === 0) return
    days.push({ date: addReadingPlanDays(startDate, days.length), chapterIds, chars })
    chapterIds = []
    chars = 0
  }

  for (const chapter of readable) {
    if (chapterIds.length > 0 && chars >= target) flush()
    chapterIds.push(chapter.id)
    chars += chapter.chars
    if (chars >= target) flush()
  }
  flush()
  return days
}

export function readingPlanDoneDays(days: ReadingPlanDay[], done: string[]): number {
  const finished = new Set(done)
  return days.filter((day) => day.chapterIds.length > 0 && day.chapterIds.every((id) => finished.has(id))).length
}
