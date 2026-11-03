import { useEffect, useState, type JSX } from 'react'
import type { BookSummary, LibraryNote, NoteKind, TagCount } from '../../shared/types.js'
import { countUnit, t, useLocale } from '../lib/i18n.js'
import { snippet } from '../lib/links.js'
import { noteDisplayTitle, titleRepeatsContent } from '../lib/note-display.js'
import { NoteTrashDialog } from './NoteTrashDialog.js'
import { Select } from './Select.js'

interface NotesLibraryProps {
  books: BookSummary[]
  onBack(): void
  onOpen(note: LibraryNote): void
  onShare(note: LibraryNote): void
  onShareDeck(notes: LibraryNote[]): void
}

const PAGE_SIZE = 30

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

export function NotesLibrary({ books, onBack, onOpen, onShare, onShareDeck }: NotesLibraryProps): JSX.Element {
  useLocale()
  const [notes, setNotes] = useState<LibraryNote[]>([])
  const [tags, setTags] = useState<TagCount[]>([])
  const [query, setQuery] = useState('')
  const [bookId, setBookId] = useState('')
  const [kind, setKind] = useState<NoteKind | ''>('')
  const [tag, setTag] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [trashOpen, setTrashOpen] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    void window.api
      .listLibraryTags(bookId || null)
      .then(setTags)
      .catch(() => setTags([]))
  }, [bookId])

  useEffect(() => {
    setPage(0)
    setSelected(new Set())
  }, [bookId, kind, tag, query])

  useEffect(() => {
    setSelected(new Set())
  }, [page])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      void window.api
        .listLibraryNotesPage({
          bookId: bookId || null,
          kind: kind || null,
          tag,
          query: query.trim() || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        })
        .then((result) => {
          if (cancelled) return
          setNotes(result.items)
          setTotal(result.total)
          setError(null)
          const lastPage = Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1)
          if (page > lastPage) setPage(lastPage)
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
  }, [bookId, kind, tag, query, page, refreshTick])

  function toggleSelected(id: string): void {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else if (next.size < 12) next.add(id)
      return next
    })
  }

  function exitSelectMode(): void {
    setSelectMode(false)
    setSelected(new Set())
  }

  function shareSelected(): void {
    const chosen = notes.filter((note) => selected.has(note.id))
    if (chosen.length < 2) return
    onShareDeck(chosen)
  }

  function clearFilters(): void {
    setQuery('')
    setBookId('')
    setKind('')
    setTag(null)
  }

  const hasFilters = Boolean(query.trim() || bookId || kind || tag)

  return (
    <main className="notes-library">
      <div className="notes-library-head">
        <div>
          <h1>{t('笔记库')}</h1>
          <p>
            {total} {countUnit(total, t('条笔记'), t('条笔记一'))} · {books.length} {countUnit(books.length, t('本书'), t('本书一'))}
          </p>
        </div>
        <div className="notes-library-actions">
          {selectMode ? (
            <>
              <button type="button" className="ghost-button" onClick={exitSelectMode}>
                {t('取消多选')}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={shareSelected}
                disabled={selected.size < 2}
              >
                {t('长图')} · {t('已选')} {selected.size}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="ghost-button" onClick={() => setTrashOpen(true)}>
                {t('回收站')}
              </button>
              <button type="button" className="ghost-button" onClick={() => setSelectMode(true)}>
                {t('多选')}
              </button>
              <button type="button" className="ghost-button" onClick={onBack}>
                {t('返回')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="notes-toolbar">
        <input
          className="notes-filter-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('筛选标题或内容…')}
          aria-label={t('筛选笔记')}
        />
        <Select
          className="filter-select"
          value={bookId}
          onChange={(value) => {
            setBookId(value)
            setTag(null)
          }}
          ariaLabel={t('按书筛选')}
          options={[{ value: '', label: t('全部书') }, ...books.map((book) => ({ value: book.id, label: book.title }))]}
        />
        <Select
          className="filter-select"
          value={kind}
          onChange={(value) => setKind(value as NoteKind | '')}
          ariaLabel={t('按类型筛选')}
          options={KIND_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
        />
      </div>

      {tags.length > 0 ? (
        <div className="tag-filter">
          <button type="button" className={tag === null ? 'is-active' : ''} onClick={() => setTag(null)}>
            {t('全部标签')}
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

      {error ? <div className="inline-error" role="alert">{error}</div> : null}

      <div className="notes-result-bar">
        <span>
          {loading
            ? t('正在筛选…')
            : `${t('第')} ${page + 1} / ${Math.max(1, Math.ceil(total / PAGE_SIZE))} ${t('页')} · ${t('共')} ${total} ${t('条')}`}
        </span>
        {hasFilters ? (
          <button type="button" className="text-button muted" onClick={clearFilters}>
            {t('清除筛选')}
          </button>
        ) : null}
      </div>

      {loading && notes.length === 0 ? (
        <p className="notes-library-empty">{t('正在加载笔记…')}</p>
      ) : notes.length === 0 ? (
        <p className="notes-library-empty">{t('没有符合筛选条件的笔记。换个标签或去读一章生成笔记。')}</p>
      ) : (
        <>
        <div className="notes-library-list">
          {notes.map((note) => {
            const statement = titleRepeatsContent(note)
            const displayTitle = statement ? noteDisplayTitle(note) : note.title
            return (
              <div key={note.id} className={`library-note-wrap${selectMode ? ' is-selecting' : ''}`}>
                {selectMode ? (
                  <span className={`library-note-check${selected.has(note.id) ? ' is-on' : ''}`}>
                    {selected.has(note.id) ? '✓' : ''}
                  </span>
                ) : null}
                <button
                  type="button"
                  className={`library-note kind-${note.kind}${selected.has(note.id) ? ' is-selected' : ''}`}
                  onClick={() => (selectMode ? toggleSelected(note.id) : onOpen(note))}
                >
                  <span className="library-note-top">
                    <span className={`kind-badge kind-${note.kind}`}>{t(KIND_LABEL[note.kind])}</span>
                    <span className={`library-note-title${statement ? ' is-statement' : ''}`} title={displayTitle}>
                      {displayTitle}
                    </span>
                    <span className="library-note-date">{note.updatedAt.slice(0, 10)}</span>
                  </span>
                  <span className="library-note-meta">
                    {note.bookTitle}
                    {note.chapterTitle ? ` · ${note.chapterTitle}` : ''}
                  </span>
                  {statement ? null : <span className="library-note-snippet">{snippet(note.content, 160)}</span>}
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
                {selectMode ? null : (
                  <button type="button" className="library-note-share" onClick={() => onShare(note)} title={t('分享这张卡片')}>
                    {t('分享')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {Math.ceil(total / PAGE_SIZE) > 1 ? (
          <div className="library-pager">
            <button type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
              {t('上一页')}
            </button>
            <span>
              {page + 1} / {Math.ceil(total / PAGE_SIZE)}
            </span>
            <button
              type="button"
              disabled={page + 1 >= Math.ceil(total / PAGE_SIZE)}
              onClick={() => setPage((current) => current + 1)}
            >
              {t('下一页')}
            </button>
          </div>
        ) : null}
        </>
      )}
      <NoteTrashDialog
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        onChanged={() => setRefreshTick((value) => value + 1)}
      />
    </main>
  )
}
