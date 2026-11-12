import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { getDb } from './db.js'

export interface MergeSnapshotResult {
  books: number
  chapters: number
  newBooks: string[]
  notes: number
  annotations: number
  bookmarks: number
  positions: number
  stats: number
  plans: number
  reviews: number
  skipped: number
}

function tableColumns(conn: DatabaseSync, table: string): Set<string> {
  try {
    return new Set(
      (conn.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>).map((row) => row.name),
    )
  } catch {
    return new Set()
  }
}

function hasTable(conn: DatabaseSync, table: string): boolean {
  try {
    const row = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
    return Boolean(row)
  } catch {
    return false
  }
}

/**
 * 把另一份快照里的笔记、PDF 标注和书签合并进当前库。
 *
 * 只做「新增 + 较新覆盖」，不处理删除（快照里没有墓碑）。
 * 找不到对应书/章节的记录会被跳过，避免把笔记挂到不存在的书上。
 */
function sqlValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  return String(value)
}

export function mergeSnapshotDatabase(
  sourcePath: string,
  options: { booksRoot?: string } = {},
): MergeSnapshotResult {
  const source = new DatabaseSync(sourcePath, { readOnly: true })
  const conn = getDb()
  const result: MergeSnapshotResult = {
    books: 0,
    chapters: 0,
    newBooks: [],
    notes: 0,
    annotations: 0,
    bookmarks: 0,
    positions: 0,
    stats: 0,
    plans: 0,
    reviews: 0,
    skipped: 0,
  }
  try {
    const books = new Set((conn.prepare('SELECT id FROM books').all() as unknown as Array<{ id: string }>).map((row) => row.id))
    const chapters = new Set(
      (conn.prepare('SELECT id FROM chapters').all() as unknown as Array<{ id: string }>).map((row) => row.id),
    )

    // 先导入快照里本地没有的书和章节；已有书不覆盖，避免把本地正文改掉。
    if (hasTable(source, 'books') && hasTable(source, 'chapters')) {
      const sourceBookCols = tableColumns(source, 'books')
      const localBookCols = tableColumns(conn, 'books')
      const bookCols = [
        'id', 'title', 'author', 'format', 'file_path', 'created_at', 'last_opened_at',
        'current_chapter_id', 'style_json', 'genre', 'cover_path', 'shelf_status',
      ].filter((col) => sourceBookCols.has(col) && localBookCols.has(col))
      const sourceChapterCols = tableColumns(source, 'chapters')
      const localChapterCols = tableColumns(conn, 'chapters')
      const chapterCols = [
        'id', 'book_id', 'idx', 'title', 'text', 'html', 'chars', 'hidden', 'kind', 'reason',
        'classified_by', 'part_title', 'part_index', 'is_part', 'formatted_html', 'format_removed',
        'format_updated_at', 'note_report', 'translated_text', 'translated_html', 'translated_at',
      ].filter((col) => sourceChapterCols.has(col) && localChapterCols.has(col))

      const bookRows = source.prepare('SELECT * FROM books').all() as unknown as Array<Record<string, unknown>>
      const insertBook = conn.prepare(
        `INSERT INTO books (${bookCols.join(', ')}) VALUES (${bookCols.map(() => '?').join(', ')})`,
      )
      const chapterRows = source.prepare('SELECT * FROM chapters ORDER BY book_id, idx').all() as unknown as Array<
        Record<string, unknown>
      >
      const insertChapter = conn.prepare(
        `INSERT INTO chapters (${chapterCols.join(', ')}) VALUES (${chapterCols.map(() => '?').join(', ')})`,
      )
      conn.exec('BEGIN IMMEDIATE')
      try {
        for (const row of bookRows) {
          const bookId = String(row.id ?? '')
          if (!bookId || books.has(bookId)) continue
          const values = bookCols.map((col) => {
            if (col === 'file_path' && options.booksRoot) {
              const sourcePath = String(row.file_path ?? '')
              return path.join(options.booksRoot, bookId, path.basename(sourcePath || 'source'))
            }
            return sqlValue(row[col])
          })
          insertBook.run(...values)
          books.add(bookId)
          result.books += 1
          result.newBooks.push(bookId)
        }
        for (const row of chapterRows) {
          const bookId = String(row.book_id ?? '')
          if (!result.newBooks.includes(bookId)) continue
          const chapterId = String(row.id ?? '')
          if (!chapterId) continue
          insertChapter.run(...chapterCols.map((col) => sqlValue(row[col])))
          chapters.add(chapterId)
          result.chapters += 1
        }
        conn.exec('COMMIT')
      } catch (error) {
        conn.exec('ROLLBACK')
        throw error
      }
    }

    if (hasTable(source, 'notes')) {
      const sourceCols = tableColumns(source, 'notes')
      const localCols = tableColumns(conn, 'notes')
      const cols = [
        'id', 'book_id', 'chapter_id', 'kind', 'title', 'content', 'quote', 'quote_verified',
        'author', 'edited', 'tags', 'created_at', 'updated_at', 'section', 'importance', 'expansion', 'role',
      ].filter((col) => sourceCols.has(col) && localCols.has(col))
      const rows = source.prepare('SELECT * FROM notes').all() as unknown as Array<Record<string, unknown>>
      const find = conn.prepare('SELECT updated_at FROM notes WHERE id = ?')
      const insert = conn.prepare(`INSERT INTO notes (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      const update = conn.prepare(
        `UPDATE notes SET ${cols.filter((col) => col !== 'id').map((col) => `${col} = ?`).join(', ')} WHERE id = ?`,
      )
      conn.exec('BEGIN IMMEDIATE')
      try {
        for (const row of rows) {
          const bookId = String(row.book_id ?? '')
          const chapterId = row.chapter_id == null ? null : String(row.chapter_id)
          if (!books.has(bookId) || (chapterId && !chapters.has(chapterId))) {
            result.skipped += 1
            continue
          }
          const existing = find.get(String(row.id)) as unknown as { updated_at?: string } | undefined
          const incoming = String(row.updated_at ?? '')
          if (!existing) {
            insert.run(...cols.map((col) => sqlValue(row[col])))
            result.notes += 1
          } else if (incoming > String(existing.updated_at ?? '')) {
            update.run(...cols.filter((col) => col !== 'id').map((col) => sqlValue(row[col])), String(row.id))
            result.notes += 1
          }
        }
        conn.exec('COMMIT')
      } catch (error) {
        conn.exec('ROLLBACK')
        throw error
      }
    }

    if (hasTable(source, 'pdf_annotations') && hasTable(conn, 'pdf_annotations')) {
      const cols = ['id', 'book_id', 'page', 'x', 'y', 'width', 'height', 'note', 'color', 'created_at', 'updated_at']
      const rows = source.prepare('SELECT * FROM pdf_annotations').all() as unknown as Array<Record<string, unknown>>
      const find = conn.prepare('SELECT updated_at FROM pdf_annotations WHERE id = ?')
      const insert = conn.prepare(
        `INSERT INTO pdf_annotations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      )
      const update = conn.prepare(
        `UPDATE pdf_annotations SET ${cols.filter((col) => col !== 'id').map((col) => `${col} = ?`).join(', ')} WHERE id = ?`,
      )
      conn.exec('BEGIN IMMEDIATE')
      try {
        for (const row of rows) {
          if (!books.has(String(row.book_id ?? ''))) {
            result.skipped += 1
            continue
          }
          const existing = find.get(String(row.id)) as unknown as { updated_at?: string } | undefined
          if (!existing) {
            insert.run(...cols.map((col) => sqlValue(row[col])))
            result.annotations += 1
          } else if (String(row.updated_at ?? '') > String(existing.updated_at ?? '')) {
            update.run(...cols.filter((col) => col !== 'id').map((col) => sqlValue(row[col])), String(row.id))
            result.annotations += 1
          }
        }
        conn.exec('COMMIT')
      } catch (error) {
        conn.exec('ROLLBACK')
        throw error
      }
    }

    if (hasTable(source, 'reading_positions') && hasTable(conn, 'reading_positions')) {
      const rows = source.prepare('SELECT * FROM reading_positions').all() as unknown as Array<Record<string, unknown>>
      const find = conn.prepare('SELECT updated_at FROM reading_positions WHERE chapter_id = ?')
      const insert = conn.prepare(
        `INSERT INTO reading_positions (chapter_id, book_id, scroll_ratio, scroll_top, page, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      const update = conn.prepare(
        'UPDATE reading_positions SET book_id = ?, scroll_ratio = ?, scroll_top = ?, page = ?, updated_at = ? WHERE chapter_id = ?',
      )
      conn.exec('BEGIN IMMEDIATE')
      try {
        for (const row of rows) {
          const chapterId = String(row.chapter_id ?? '')
          const bookId = String(row.book_id ?? '')
          if (!books.has(bookId) || !chapters.has(chapterId)) {
            result.skipped += 1
            continue
          }
          const existing = find.get(chapterId) as unknown as { updated_at?: string } | undefined
          if (!existing) {
            insert.run(chapterId, bookId, sqlValue(row.scroll_ratio), sqlValue(row.scroll_top), sqlValue(row.page), sqlValue(row.updated_at))
            result.positions += 1
          } else if (String(row.updated_at ?? '') > String(existing.updated_at ?? '')) {
            update.run(bookId, sqlValue(row.scroll_ratio), sqlValue(row.scroll_top), sqlValue(row.page), sqlValue(row.updated_at), chapterId)
            result.positions += 1
          }
        }
        conn.exec('COMMIT')
      } catch (error) {
        conn.exec('ROLLBACK')
        throw error
      }
    }

    if (hasTable(source, 'bookmarks') && hasTable(conn, 'bookmarks')) {
      const cols = ['id', 'book_id', 'chapter_id', 'scroll_ratio', 'scroll_top', 'page', 'label', 'quote', 'created_at']
      const rows = source.prepare('SELECT * FROM bookmarks').all() as unknown as Array<Record<string, unknown>>
      const exists = conn.prepare('SELECT 1 FROM bookmarks WHERE id = ?')
      const insert = conn.prepare(
        `INSERT OR IGNORE INTO bookmarks (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      )
      conn.exec('BEGIN IMMEDIATE')
      try {
        for (const row of rows) {
          if (!books.has(String(row.book_id ?? '')) || !chapters.has(String(row.chapter_id ?? ''))) {
            result.skipped += 1
            continue
          }
          if (exists.get(String(row.id))) continue
          insert.run(...cols.map((col) => sqlValue(row[col])))
          result.bookmarks += 1
        }
        conn.exec('COMMIT')
      } catch (error) {
        conn.exec('ROLLBACK')
        throw error
      }
    }
    if (hasTable(source, 'reading_stats_days') && hasTable(conn, 'reading_stats_days')) {
      const rows = source.prepare('SELECT day, seconds FROM reading_stats_days').all() as unknown as Array<{
        day: string
        seconds: number
      }>
      const upsert = conn.prepare(
        `INSERT INTO reading_stats_days (day, seconds) VALUES (?, ?)
         ON CONFLICT(day) DO UPDATE SET seconds = MAX(reading_stats_days.seconds, excluded.seconds)`,
      )
      conn.exec('BEGIN IMMEDIATE')
      try {
        for (const row of rows) {
          upsert.run(row.day, Math.max(0, Math.floor(Number(row.seconds) || 0)))
          result.stats += 1
        }
        conn.exec('COMMIT')
      } catch (error) {
        conn.exec('ROLLBACK')
        throw error
      }
    }

    if (hasTable(source, 'reading_stats_books') && hasTable(conn, 'reading_stats_books')) {
      const rows = source.prepare('SELECT book_id, seconds FROM reading_stats_books').all() as unknown as Array<{
        book_id: string
        seconds: number
      }>
      const upsert = conn.prepare(
        `INSERT INTO reading_stats_books (book_id, seconds) VALUES (?, ?)
         ON CONFLICT(book_id) DO UPDATE SET seconds = MAX(reading_stats_books.seconds, excluded.seconds)`,
      )
      conn.exec('BEGIN IMMEDIATE')
      try {
        for (const row of rows) {
          if (!books.has(String(row.book_id))) {
            result.skipped += 1
            continue
          }
          upsert.run(row.book_id, Math.max(0, Math.floor(Number(row.seconds) || 0)))
          result.stats += 1
        }
        conn.exec('COMMIT')
      } catch (error) {
        conn.exec('ROLLBACK')
        throw error
      }
    }

    if (hasTable(source, 'reading_plans') && hasTable(conn, 'reading_plans')) {
      const rows = source.prepare('SELECT * FROM reading_plans').all() as unknown as Array<Record<string, unknown>>
      const find = conn.prepare('SELECT updated_at FROM reading_plans WHERE book_id = ?')
      const upsert = conn.prepare(
        `INSERT INTO reading_plans (book_id, plan, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(book_id) DO UPDATE SET plan = excluded.plan, updated_at = excluded.updated_at`,
      )
      conn.exec('BEGIN IMMEDIATE')
      try {
        for (const row of rows) {
          const bookId = String(row.book_id ?? '')
          if (!books.has(bookId)) {
            result.skipped += 1
            continue
          }
          const existing = find.get(bookId) as unknown as { updated_at?: string } | undefined
          if (!existing || String(row.updated_at ?? '') > String(existing.updated_at ?? '')) {
            upsert.run(bookId, sqlValue(row.plan), sqlValue(row.created_at), sqlValue(row.updated_at))
            result.plans += 1
          }
        }
        conn.exec('COMMIT')
      } catch (error) {
        conn.exec('ROLLBACK')
        throw error
      }
    }

    if (hasTable(source, 'weekly_reviews') && hasTable(conn, 'weekly_reviews')) {
      const rows = source.prepare('SELECT * FROM weekly_reviews').all() as unknown as Array<Record<string, unknown>>
      const find = conn.prepare('SELECT updated_at FROM weekly_reviews WHERE week = ?')
      const insert = conn.prepare(
        `INSERT INTO weekly_reviews (id, week, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      const update = conn.prepare(
        'UPDATE weekly_reviews SET title = ?, content = ?, updated_at = ? WHERE week = ?',
      )
      conn.exec('BEGIN IMMEDIATE')
      try {
        for (const row of rows) {
          const week = String(row.week ?? '')
          if (!week) {
            result.skipped += 1
            continue
          }
          const existing = find.get(week) as unknown as { updated_at?: string } | undefined
          if (!existing) {
            insert.run(
              sqlValue(row.id),
              week,
              sqlValue(row.title),
              sqlValue(row.content),
              sqlValue(row.created_at),
              sqlValue(row.updated_at),
            )
            result.reviews += 1
          } else if (String(row.updated_at ?? '') > String(existing.updated_at ?? '')) {
            update.run(sqlValue(row.title), sqlValue(row.content), sqlValue(row.updated_at), week)
            result.reviews += 1
          }
        }
        conn.exec('COMMIT')
      } catch (error) {
        conn.exec('ROLLBACK')
        throw error
      }
    }

  } finally {
    source.close()
  }
  return result
}
