import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import type { SearchResult, SearchResultType } from '../../shared/types.js'

interface SearchDialogProps {
  open: boolean
  onClose(): void
  onOpen(result: SearchResult): void
}

const GROUPS: Array<{ type: SearchResultType; label: string }> = [
  { type: 'book', label: '书' },
  { type: 'chapter', label: '章节' },
  { type: 'note', label: '笔记' },
]

const KIND_LABEL: Record<SearchResultType, string> = {
  book: '书',
  chapter: '章节',
  note: '笔记',
}

function highlight(text: string, query: string): JSX.Element {
  const term = query.trim()
  if (!term) return <>{text}</>
  const index = text.toLowerCase().indexOf(term.toLowerCase())
  if (index < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + term.length)}</mark>
      {text.slice(index + term.length)}
    </>
  )
}

export function SearchDialog({ open, onClose, onOpen }: SearchDialogProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setError(null)
    setActive(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const term = query.trim()
    if (!term) {
      setResults([])
      setLoading(false)
      setError(null)
      setActive(0)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      void window.api
        .search(term)
        .then((found) => {
          if (cancelled) return
          setResults(found)
          setActive(0)
          setError(null)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setResults([])
          setError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 160)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, open])

  if (!open) return null

  function handleKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (results.length === 0 ? 0 : (current + 1) % results.length))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => (results.length === 0 ? 0 : (current - 1 + results.length) % results.length))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const result = results[active]
      if (result) onOpen(result)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="search-modal"
        role="dialog"
        aria-modal="true"
        aria-label="搜索"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="search-input-row">
          <span className="search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKey}
            placeholder="搜索书名、章节或笔记内容…"
            aria-label="搜索书名、章节或笔记内容"
          />
          <span className="search-shortcut">Esc</span>
        </div>

        <div className="search-results">
          {error ? <div className="inline-error">{error}</div> : null}
          {!query.trim() ? (
            <p className="search-empty">输入关键词，跨所有书搜索书名、章节正文和笔记。</p>
          ) : loading && results.length === 0 ? (
            <p className="search-empty">正在搜索…</p>
          ) : results.length === 0 ? (
            <p className="search-empty">没有找到「{query.trim()}」。</p>
          ) : (
            GROUPS.map((group) => {
              const items = results.filter((result) => result.type === group.type)
              if (items.length === 0) return null
              return (
                <section key={group.type} className="search-group">
                  <div className="search-group-label">
                    {group.label}
                    <span>{items.length}</span>
                  </div>
                  {items.map((result) => {
                    const index = results.indexOf(result)
                    return (
                      <button
                        key={`${result.type}-${result.id}`}
                        type="button"
                        className={`search-result${index === active ? ' is-active' : ''}`}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => onOpen(result)}
                      >
                        <span className="search-result-line">
                          <span className={`search-result-kind type-${result.type}`}>{KIND_LABEL[result.type]}</span>
                          <span className="search-result-title">{highlight(result.title, query)}</span>
                        </span>
                        <span className="search-result-meta">
                          {result.type === 'book'
                            ? result.snippet
                            : `${result.bookTitle}${result.chapterTitle ? ` · ${result.chapterTitle}` : ''}`}
                        </span>
                        {result.type !== 'book' && result.snippet ? (
                          <span className="search-result-snippet">{highlight(result.snippet, query)}</span>
                        ) : null}
                      </button>
                    )
                  })}
                </section>
              )
            })
          )}
        </div>
        <div className="search-footer">
          <span>↑↓ 选择 · ↵ 打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  )
}
