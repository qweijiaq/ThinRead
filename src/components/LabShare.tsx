import { useEffect, useMemo, useState, type JSX } from 'react'
import type { LibraryNote } from '../../shared/types.js'
import { noteDisplayTitle, titleRepeatsContent } from '../lib/note-display.js'

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const chars = [...text]
  const lines: string[] = []
  let line = ''
  for (const char of chars) {
    const next = line + char
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = char
      if (lines.length >= maxLines) break
    } else {
      line = next
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (lines.length === maxLines && chars.length > lines.join('').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, -1)}…`
  }
  return lines
}

export function LabShare(): JSX.Element {
  const [notes, setNotes] = useState<LibraryNote[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void window.api
      .listLibraryNotes({ limit: 200 })
      .then((items) => {
        setNotes(items)
        setSelectedId(items[0]?.id ?? '')
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return term
      ? notes.filter((note) => `${note.title} ${note.content} ${note.bookTitle}`.toLowerCase().includes(term))
      : notes
  }, [notes, query])

  const selected = notes.find((note) => note.id === selectedId) ?? filtered[0] ?? null
  const title = selected ? noteDisplayTitle(selected) : ''
  const repeats = selected ? titleRepeatsContent(selected) : false

  async function save(): Promise<void> {
    if (!selected) return
    setError(null)
    setSaved(false)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 1080
      canvas.height = 1440
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('无法创建画布。')
      ctx.fillStyle = '#f6f1e7'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#fbf8f1'
      ctx.beginPath()
      ctx.roundRect(72, 72, 936, 1296, 28)
      ctx.fill()
      ctx.strokeStyle = '#e2d9c8'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = '#a84a2b'
      ctx.fillRect(120, 132, 72, 6)

      ctx.fillStyle = '#847967'
      ctx.font = '30px "PingFang SC", sans-serif'
      ctx.fillText('页边 · ThinRead', 120, 190)

      ctx.fillStyle = '#2b2720'
      ctx.font = '600 62px "Songti SC", "Noto Serif SC", serif'
      const titleLines = wrapText(ctx, title, 800, 4)
      titleLines.forEach((line, index) => ctx.fillText(line, 120, 330 + index * 82))

      const bodyTop = 330 + titleLines.length * 82 + 48
      if (!repeats && selected.content.trim()) {
        ctx.fillStyle = '#4b443a'
        ctx.font = '38px "Songti SC", "Noto Serif SC", serif'
        const bodyLines = wrapText(ctx, selected.content.trim(), 800, 9)
        bodyLines.forEach((line, index) => ctx.fillText(line, 120, bodyTop + index * 62))
      }

      ctx.fillStyle = '#847967'
      ctx.font = '28px "PingFang SC", sans-serif'
      const source = `${selected.bookTitle}${selected.chapterTitle ? ` · ${selected.chapterTitle}` : ''}`
      ctx.fillText(wrapText(ctx, source, 760, 1)[0] ?? source, 120, 1250)
      if (selected.tags.length > 0) {
        ctx.fillStyle = '#a84a2b'
        ctx.font = '24px "PingFang SC", sans-serif'
        ctx.fillText(selected.tags.slice(0, 5).join(' · '), 120, 1310)
      }

      const result = await window.api.saveImage(canvas.toDataURL('image/png'), `页边-${title.slice(0, 18)}.png`)
      setSaved(result.saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="lab-share">
      <div className="lab-share-layout">
        <div className="lab-share-list">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索要分享的笔记…" />
          <div className="lab-share-notes">
            {filtered.map((note) => (
              <button
                key={note.id}
                type="button"
                className={note.id === selected?.id ? 'is-active' : ''}
                onClick={() => {
                  setSelectedId(note.id)
                  setSaved(false)
                }}
              >
                <strong>{noteDisplayTitle(note)}</strong>
                <em>{note.bookTitle}</em>
              </button>
            ))}
          </div>
        </div>
        <div className="lab-share-preview">
          {selected ? (
            <>
              <div className="share-card-preview">
                <span className="share-mark">页边 · ThinRead</span>
                <h3>{title}</h3>
                {!repeats && selected.content.trim() ? <p>{selected.content}</p> : null}
                <div className="share-source">
                  {selected.bookTitle}
                  {selected.chapterTitle ? ` · ${selected.chapterTitle}` : ''}
                </div>
                {selected.tags.length > 0 ? <div className="share-tags">{selected.tags.slice(0, 5).join(' · ')}</div> : null}
              </div>
              <div className="lab-share-actions">
                <button type="button" className="primary-button small" onClick={() => void save()}>
                  {saved ? '已保存' : '保存 PNG'}
                </button>
              </div>
            </>
          ) : (
            <p className="lab-empty">还没有可以分享的笔记。</p>
          )}
          {error ? <div className="inline-error">{error}</div> : null}
        </div>
      </div>
    </div>
  )
}
