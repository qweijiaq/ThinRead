import type { PdfAnnotation, PdfAnnotationColor } from '../shared/types.js'
import { getDb } from './db.js'

function mapPdfAnnotation(row: {
  id: string
  book_id: string
  page: number
  x: number
  y: number
  width: number
  height: number
  note: string
  color: string
  created_at: string
  updated_at: string
}): PdfAnnotation {
  return {
    id: row.id,
    bookId: row.book_id,
    page: Number(row.page),
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    note: row.note ?? '',
    color: (row.color as PdfAnnotationColor) || 'yellow',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number(value) || 0))
}

export function listPdfAnnotations(bookId: string, page: number): PdfAnnotation[] {
  const rows = getDb()
    .prepare('SELECT * FROM pdf_annotations WHERE book_id = ? AND page = ? ORDER BY created_at')
    .all(bookId, Math.max(1, Math.floor(page))) as unknown as Array<Parameters<typeof mapPdfAnnotation>[0]>
  return rows.map(mapPdfAnnotation)
}

export function savePdfAnnotation(input: {
  bookId: string
  page: number
  x: number
  y: number
  width: number
  height: number
  note?: string
  color?: PdfAnnotationColor
}): PdfAnnotation {
  const x = clamp01(input.x)
  const y = clamp01(input.y)
  const width = clamp01(input.width)
  const height = clamp01(input.height)
  if (width < 0.002 || height < 0.002) throw new Error('标注区域太小。')
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO pdf_annotations (id, book_id, page, x, y, width, height, note, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.bookId,
      Math.max(1, Math.floor(input.page)),
      x,
      y,
      width,
      height,
      (input.note ?? '').slice(0, 10_000),
      input.color ?? 'yellow',
      now,
      now,
    )
  const row = getDb().prepare('SELECT * FROM pdf_annotations WHERE id = ?').get(id) as unknown as Parameters<
    typeof mapPdfAnnotation
  >[0]
  return mapPdfAnnotation(row)
}

export function updatePdfAnnotation(
  id: string,
  patch: { note?: string; color?: PdfAnnotationColor },
): PdfAnnotation {
  const current = getDb().prepare('SELECT * FROM pdf_annotations WHERE id = ?').get(id) as unknown as
    | Parameters<typeof mapPdfAnnotation>[0]
    | undefined
  if (!current) throw new Error('找不到这条标注。')
  getDb()
    .prepare('UPDATE pdf_annotations SET note = ?, color = ?, updated_at = ? WHERE id = ?')
    .run(
      patch.note !== undefined ? patch.note.slice(0, 10_000) : current.note,
      patch.color ?? current.color,
      new Date().toISOString(),
      id,
    )
  const row = getDb().prepare('SELECT * FROM pdf_annotations WHERE id = ?').get(id) as unknown as Parameters<
    typeof mapPdfAnnotation
  >[0]
  return mapPdfAnnotation(row)
}

export function deletePdfAnnotation(id: string): void {
  getDb().prepare('DELETE FROM pdf_annotations WHERE id = ?').run(id)
}


export function listPdfAnnotationsForBook(bookId: string): PdfAnnotation[] {
  const rows = getDb()
    .prepare('SELECT * FROM pdf_annotations WHERE book_id = ? ORDER BY page, created_at')
    .all(bookId) as unknown as Array<Parameters<typeof mapPdfAnnotation>[0]>
  return rows.map(mapPdfAnnotation)
}
