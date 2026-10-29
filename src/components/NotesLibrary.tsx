import { useEffect, useState, type JSX } from 'react'
import type { BookSummary, LibraryNote, NoteKind, ReviewStats, TagCount } from '../../shared/types.js'
import { snippet } from '../lib/links.js'
import { ReviewSession } from './ReviewSession.js'

interface NotesLibraryProps {
  books: BookSummary[]
  onBack(): void
  onOpen(note: LibraryNote): void
}

const KIND_LABEL: Record<NoteKind, string> = {
  condensed: '读薄稿',
  summary: '摘要',
  claim: '论点',
  point: '知识点',
  question: '问题',
  thought: '想法',
  highlight: '划线',
}

const KIND_OPTIONS: Array<{ value: NoteKind | ''; label: string }> = [
  { value: '', label: '全部类型' },
  { value: 'point', label: '知识点' },
  { value: 'claim', label: '论点' },
  { value: 'summary', label: '摘要' },
  { value: 'question', label: '问题' },
  { value: 'thought', label: '想法' },
  { value: 'highlight', label: '划线' },
  { value: 'condensed', label: '读薄稿' },
]

export function NotesLibrary({ books, onBack, onOpen }: NotesLibraryProps): JSX.Element {
  const [notes, setNotes] = useState<LibraryNote[]>([])
  const [tags, setTags] = useState<TagCount[]>([])
  const [stats, setStats] = useState<ReviewStats | null>(null)
  const [query, setQuery] = useState('')
  const [bookId, setBookId] = useState('')
  const [kind, setKind] = useState<NoteKind | ''>('')
  const [tag, setTag] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviewCards, setReviewCards] = useState<LibraryNote[] | null>(null)
  const [starting, setStarting] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    void window.api
      .getReviewStats()
      .then(setStats)
      .catch(() => setStats(null))
  }, [refreshTick])

  useEffect(() => {
    void window.api
      .listLibraryTags(bookId || null)
      .then(setTags)
      .catch(() => setTags([]))
  }, [bookId, refreshTick])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      void window.api
        .listLibraryNotes({
          bookId: bookId || null,
          kind: kind || null,
          tag,
          query: query.trim() || undefined,
          limit: 300,
        })
        .then((items) => {
          if (!cancelled) {
            setNotes(items)
            setError(null)
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [bookId, kind, tag, query, refreshTick])

  async function startReview(): Promise<void> {
    setStarting(true)
    setError(null)
    try {
      const cards = await window.api.getReviewQueue(30)
      if (cards.length === 0) {
        setError('现在没有到期需要复习的笔记。')
        return
      }
      setReviewCards(cards)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }

  function closeReview(): void {
    setReviewCards(null)
    setRefreshTick((value) => value + 1)
  }

  const dueCount = stats?.due ?? 0

  return (
    <main className="notes-library">
      <div className="notes-library-head">
        <div>
          <h1>笔记库</h1>
          <p>
            {stats ? `${stats.total} 张可复习 · 今日待复习 ${stats.due} · 今日已复习 ${stats.reviewedToday}` : `${notes.length} 条笔记`}
          </p>
        </div>
        <div className="notes-library-actions">
          <button type="button" className="ghost-button" onClick={onBack}>
            返回
          </button>
          <button type="button" className="primary-button" onClick={() => void startReview()} disabled={starting || dueCount === 0}>
            {starting ? '准备中…' : dueCount > 0 ? `开始复习 · ${dueCount}` : '暂无到期'}
          </button>
        </div>
      </div>

      <div className="notes-toolbar">
        <input
          className="notes-filter-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="筛选标题或内容…"
          aria-label="筛选笔记"
        />
        <select
          className="notes-select"
          value={bookId}
          onChange={(event) => {
            setBookId(event.target.value)
            setTag(null)
          }}
          aria-label="按书筛选"
        >
          <option value="">全部书</option>
          {books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.title}
            </option>
          ))}
        </select>
        <select
          className="notes-select"
          value={kind}
          onChange={(event) => setKind(event.target.value as NoteKind | '')}
          aria-label="按类型筛选"
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.value || 'all'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {tags.length > 0 ? (
        <div className="tag-filter">
          <button type="button" className={tag === null ? 'is-active' : ''} onClick={() => setTag(null)}>
            全部标签
          </button>
          {tags.map((item) => (
            <button
              key={item.tag}
              type="button"
              className={tag === item.tag ? 'is-active' : ''}
              onClick={() => setTag((current) => (current === item.tag ? null : item.tag))}
            >
              {item.tag}
              <span>{item.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? <div className="inline-error">{error}</div> : null}

      {loading && notes.length === 0 ? (
        <p className="notes-library-empty">正在加载笔记…</p>
      ) : notes.length === 0 ? (
        <p className="notes-library-empty">没有符合筛选条件的笔记。换个标签或去读一章生成笔记。</p>
      ) : (
        <div className="notes-library-list">
          {notes.map((note) => {
            const due = !note.dueAt || new Date(note.dueAt).getTime() <= Date.now()
            return (
              <button key={note.id} type="button" className="library-note" onClick={() => onOpen(note)}>
                <span className="library-note-top">
                  <span className={`kind-badge kind-${note.kind}`}>{KIND_LABEL[note.kind]}</span>
                  {due ? <span className="review-badge">{note.dueAt ? '待复习' : '新卡片'}</span> : null}
                  <span className="library-note-title">{note.title}</span>
                  <span className="library-note-date">{note.updatedAt.slice(0, 10)}</span>
                </span>
                <span className="library-note-meta">
                  {note.bookTitle}
                  {note.chapterTitle ? ` · ${note.chapterTitle}` : ''}
                </span>
                <span className="library-note-snippet">{snippet(note.content, 160)}</span>
                {note.tags.length > 0 ? (
                  <span className="library-note-tags">
                    {note.tags.slice(0, 5).map((item) => (
                      <span key={item} className="tag">
                        {item}
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}

      {reviewCards ? (
        <ReviewSession
          initialCards={reviewCards}
          onRate={(noteId, rating) => window.api.reviewNote(noteId, rating)}
          onClose={closeReview}
        />
      ) : null}
    </main>
  )
}
