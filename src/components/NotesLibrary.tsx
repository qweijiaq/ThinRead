import { bridge } from '../lib/bridge.js'
import { useEffect, useRef, useState, type JSX } from 'react'
import type { BookSummary, LibraryNote, LibraryNoteAudit, NoteAuditFilter, NoteKind, TagCount } from '../../shared/types.js'
import { countUnit, t, useLocale } from '../lib/i18n.js'
import { snippet } from '../lib/links.js'
import { noteDisplayTitle, titleRepeatsContent } from '../lib/note-display.js'
import { NoteTrashDialog } from './NoteTrashDialog.js'
import { ChevronIcon } from './Icon.js'
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
  condensed: t('读薄稿'),
  summary: t('摘要'),
  claim: t('论点'),
  point: t('知识点'),
  question: t('问题'),
  thought: t('想法'),
  highlight: t('划线'),
}

const KIND_OPTIONS: Array<{ value: NoteKind | ''; label: string }> = [
  { value: '', label: t('全部类型') },
  { value: 'point', label: t('知识点') },
  { value: 'claim', label: t('论点') },
  { value: 'summary', label: t('摘要') },
  { value: 'question', label: t('问题') },
  { value: 'thought', label: t('想法') },
  { value: 'highlight', label: t('划线') },
  { value: 'condensed', label: t('读薄稿') },
]

export function NotesLibrary({ books, onBack, onOpen, onShare, onShareDeck }: NotesLibraryProps): JSX.Element {
  useLocale()
  const [notes, setNotes] = useState<LibraryNote[]>([])
  const [tags, setTags] = useState<TagCount[]>([])
  const [audit, setAudit] = useState<LibraryNoteAudit | null>(null)
  const [auditFilter, setAuditFilter] = useState<NoteAuditFilter | ''>('')
  const [query, setQuery] = useState('')
  const [bookId, setBookId] = useState('')
  const [kind, setKind] = useState<NoteKind | ''>('')
  const [tag, setTag] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [sort, setSort] = useState<'updated' | 'created' | 'title' | 'book'>('updated')
  const tagStripRef = useRef<HTMLDivElement | null>(null)
  const [tagScroll, setTagScroll] = useState({ left: false, right: false })
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [trashOpen, setTrashOpen] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    void bridge
      .listLibraryTags(bookId || null)
      .then(setTags)
      .catch(() => setTags([]))
  }, [bookId])

  useEffect(() => {
    let cancelled = false
    void bridge
      .getLibraryNoteAudit({
        bookId: bookId || null,
        kind: kind || null,
        tag,
        query: query.trim() || undefined,
      })
      .then((result) => {
        if (!cancelled) setAudit(result)
      })
      .catch(() => {
        if (!cancelled) setAudit(null)
      })
    return () => {
      cancelled = true
    }
  }, [bookId, kind, tag, query, refreshTick])

  useEffect(() => {
    setPage(0)
    setSelected(new Set())
  }, [bookId, kind, tag, query, auditFilter, sort])

  useEffect(() => {
    setSelected(new Set())
  }, [page])

  useEffect(() => {
    const element = tagStripRef.current
    if (!element) {
      setTagScroll({ left: false, right: false })
      return
    }
    const update = () => {
      setTagScroll({
        left: element.scrollLeft > 4,
        right: element.scrollLeft + element.clientWidth < element.scrollWidth - 4,
      })
    }
    update()
    element.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      element.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [tags, bookId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      void bridge
        .listLibraryNotesPage({
          bookId: bookId || null,
          kind: kind || null,
          tag,
          query: query.trim() || undefined,
          audit: auditFilter || null,
          sort,
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
  }, [bookId, kind, tag, query, page, auditFilter, sort, refreshTick])

  function toggleSelected(id: string): void {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else if (next.size < 12) next.add(id)
      else window.setTimeout(() => setNotice(t('一次最多选择 12 条笔记。')), 0)
      return next
    })
  }

  function selectAllVisible(): void {
    const ids = notes.slice(0, 12).map((note) => note.id)
    setSelected(new Set(ids))
    if (notes.length > 12) setNotice(t('已选当前页前 12 条；一次最多 12 条。'))
  }

  function scrollTags(direction: 1 | -1): void {
    tagStripRef.current?.scrollBy({ left: direction * 260, behavior: 'smooth' })
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

  async function exportMarkdown(): Promise<void> {
    if (exporting) return
    if (selectMode && selected.size === 0) {
      setError(t('先选择要导出的笔记。'))
      return
    }
    setExporting(true)
    setError(null)
    setNotice(null)
    try {
      const result = await bridge.exportNotesMarkdown({
        bookId: bookId || null,
        kind: kind || null,
        tag,
        query: query.trim() || undefined,
        audit: auditFilter || null,
        ...(selectMode ? { ids: [...selected] } : {}),
      })
      if (result.canceled) return
      if (!result.saved || result.count === 0) {
        setNotice(t('没有可导出的笔记。'))
        return
      }
      setNotice(`${t('已导出')} ${result.count} ${t('条笔记到')} ${result.path}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  function clearFilters(): void {
    setQuery('')
    setBookId('')
    setKind('')
    setTag(null)
    setAuditFilter('')
  }

  function toggleAuditFilter(next: NoteAuditFilter): void {
    setAuditFilter((current) => (current === next ? '' : next))
  }

  const hasFilters = Boolean(query.trim() || bookId || kind || tag || auditFilter)

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
              <button type="button" className="ghost-button" onClick={selectAllVisible} disabled={notes.length === 0}>
                {t('全选本页')}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={shareSelected}
                disabled={selected.size < 2}
              >
                {t('长图')} · {t('已选')} {selected.size}/12
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => void exportMarkdown()}
                disabled={exporting || selected.size === 0}
              >
                {exporting ? t('正在导出…') : t('导出选中')}
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
              <button
                type="button"
                className="ghost-button"
                onClick={() => void exportMarkdown()}
                disabled={exporting || total === 0}
              >
                {exporting ? t('正在导出…') : t('导出 Markdown')}
              </button>
              <button type="button" className="ghost-button" onClick={onBack}>
                {t('返回')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="notes-filters">
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
        <Select
          className="filter-select"
          value={sort}
          onChange={(value) => setSort(value as 'updated' | 'created' | 'title' | 'book')}
          ariaLabel={t('排序')}
          options={[
            { value: 'updated', label: t('最近更新') },
            { value: 'created', label: t('创建时间') },
            { value: 'title', label: t('按标题') },
            { value: 'book', label: t('按书名') },
          ]}
        />
      </div>

      {tags.length > 0 ? (
        <div className="tag-filter-wrap">
          <button
            type="button"
            className="tag-scroll"
            onClick={() => scrollTags(-1)}
            disabled={!tagScroll.left}
            aria-label={t('向左滚动标签')}
          >
            <ChevronIcon direction="left" />
          </button>
          <div className="tag-filter" ref={tagStripRef}>
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
          <button
            type="button"
            className="tag-scroll"
            onClick={() => scrollTags(1)}
            disabled={!tagScroll.right}
            aria-label={t('向右滚动标签')}
          >
            <ChevronIcon direction="right" />
          </button>
        </div>
      ) : null}
      </div>

      {audit ? (
        <div className="notes-audit" role="group" aria-label={t('笔记审计')}>
          <span className="notes-audit-title">{t('笔记审计')}</span>
          <span>{audit.notes} {t('条笔记')}</span>
          <button
            type="button"
            className={auditFilter === 'unverified' ? 'is-active' : ''}
            onClick={() => toggleAuditFilter('unverified')}
            disabled={audit.unverified === 0}
          >
            {t('待核对')} {audit.unverified}
          </button>
          <button
            type="button"
            className={auditFilter === 'noQuote' ? 'is-active' : ''}
            onClick={() => toggleAuditFilter('noQuote')}
            disabled={audit.noQuote === 0}
          >
            {t('无引用')} {audit.noQuote}
          </button>
          <button
            type="button"
            className={auditFilter === 'edited' ? 'is-active' : ''}
            onClick={() => toggleAuditFilter('edited')}
            disabled={audit.edited === 0}
          >
            {t('人工修改')} {audit.edited}
          </button>
          <span className="notes-audit-coverage">
            {t('有笔记')} {audit.chapterWithNotes}/{audit.chapterTotal} {t('章')} · {t('读薄覆盖')} {audit.chapterWithCondensed}/{audit.chapterTotal} {t('章')}
          </span>
        </div>
      ) : null}

      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      {notice ? <div className="inline-notice" role="status" aria-live="polite">{notice}</div> : null}

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
        <div className="notes-library-list notes-skeleton" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="skeleton-card">
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
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
