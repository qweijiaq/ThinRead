import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import type { SearchResult, SearchResultType } from '../../shared/types.js'
import { t, useLocale } from '../lib/i18n.js'
import { mergeSearchResults } from '../lib/search-merge.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'

interface SearchDialogProps {
  open: boolean
  hasBook?: boolean
  onClose(): void
  onOpen(result: SearchResult): void
  onCommand(action: SearchCommandId): void
}

export type SearchCommandId =
  | 'library'
  | 'reader'
  | 'notes'
  | 'content'
  | 'compose'
  | 'map'
  | 'lab'
  | 'stats'
  | 'weekly'
  | 'settings'
  | 'import'
  | 'manual'

const COMMANDS: Array<{ id: SearchCommandId; label: string; requiresBook?: boolean }> = [
  { id: 'library', label: '书架' },
  { id: 'reader', label: '返回阅读', requiresBook: true },
  { id: 'notes', label: '全库笔记' },
  { id: 'content', label: '内容库' },
  { id: 'compose', label: '成书', requiresBook: true },
  { id: 'map', label: '知识地图' },
  { id: 'lab', label: 'AI 工作台' },
  { id: 'stats', label: '阅读统计' },
  { id: 'weekly', label: '历次周复盘' },
  { id: 'settings', label: '设置' },
  { id: 'import', label: '导入' },
  { id: 'manual', label: '使用手册' },
]

const GROUPS: Array<{ type: SearchResultType; label: string }> = [
  { type: 'book', label: '书' },
  { type: 'chapter', label: '章节' },
  { type: 'note', label: '笔记' },
  { type: 'content', label: '生成内容' },
]

const KIND_LABEL: Record<SearchResultType, string> = {
  book: '书',
  chapter: '章节',
  note: '笔记',
  content: '生成',
}

type Filter = 'all' | SearchResultType
const PAGE_SIZE = 12
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '全部' },
  ...GROUPS.map((group) => ({ value: group.type as Filter, label: group.label })),
]

function mergeResults(base: SearchResult[], extra: SearchResult[]): SearchResult[] {
  return mergeSearchResults(base, extra)
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

export function SearchDialog({ open, hasBook = false, onClose, onOpen, onCommand }: SearchDialogProps): JSX.Element | null {
  useLocale()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose, 'input')

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setError(null)
    setActive(0)
    setFilter('all')
    setPage(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    setPage(0)
    setActive(0)
  }, [query, filter])

  useEffect(() => {
    if (!open) return
    const term = query.trim()
    if (!term || term.startsWith('>')) {
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
          setResults((current) => mergeResults(found, current.filter((item) => item.source === 'semantic')))
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
      void window.api
        .searchSemantic(term)
        .then((extra) => {
          if (!cancelled && extra.length > 0) {
            setResults((current) => mergeResults(current, extra))
          }
        })
        .catch(() => undefined)
    }, 160)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, open])

  if (!open) return null

  const trimmedQuery = query.trim()
  const commandMode = trimmedQuery === '' || trimmedQuery.startsWith('>')
  const commandTerm = trimmedQuery.startsWith('>') ? trimmedQuery.slice(1).trim().toLowerCase() : ''
  const commandList = commandMode
    ? COMMANDS.filter(
        (command) =>
          (!command.requiresBook || hasBook) &&
          (commandTerm === '' || t(command.label).toLowerCase().includes(commandTerm) || command.label.includes(commandTerm)),
      )
    : []
  const usingCommands = commandMode && commandList.length > 0
  const filtered = filter === 'all' ? results : results.filter((result) => result.type === filter)
  const ordered = GROUPS.flatMap((group) => filtered.filter((result) => result.type === group.type))
  const pageCount = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = ordered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  const visibleCount = visible.length

  function runCommand(id: SearchCommandId): void {
    onCommand(id)
    onClose()
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (usingCommands) {
        setActive((current) => (current + 1) % commandList.length)
      } else {
        setActive((current) => (visibleCount === 0 ? 0 : (current + 1) % visibleCount))
      }
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (usingCommands) {
        setActive((current) => (current - 1 + commandList.length) % commandList.length)
      } else {
        setActive((current) => (visibleCount === 0 ? 0 : (current - 1 + visibleCount) % visibleCount))
      }
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (usingCommands) {
        const command = commandList[active] ?? commandList[0]
        if (command) runCommand(command.id)
        return
      }
      const result = visible[active]
      if (result) onOpen(result)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="search-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('搜索')}
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
            placeholder={t('搜索，或输入 > 执行命令…')}
            aria-label={t('搜索书名、章节、笔记或生成内容')}
            role="searchbox"
            aria-controls="search-results"
            aria-describedby="search-active-result"
          />
          <span className="search-shortcut">Esc</span>
        </div>

        {!commandMode && query.trim() ? (
          <div className="search-filters" role="group" aria-label={t('按类型筛选')}>
            {FILTERS.map((item) => {
              const count = item.value === 'all' ? results.length : results.filter((result) => result.type === item.value).length
              return (
                <button
                  key={item.value}
                  type="button"
                  className={`search-filter${filter === item.value ? ' is-active' : ''}`}
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                >
                  {t(item.label)}
                  <span>{count}</span>
                </button>
              )
            })}
          </div>
        ) : null}

        <div
          className="search-results"
          id="search-results"
          role="region"
          aria-label={t('搜索结果')}
          aria-busy={loading}
        >
          {error ? <div className="inline-error" role="alert">{error}</div> : null}
          {commandMode ? (
            commandList.length > 0 ? (
              <div className="search-commands">
                <div className="search-commands-label">{t('快速操作')}</div>
                {commandList.map((command, index) => (
                  <button
                    key={command.id}
                    type="button"
                    className={`search-command${index === active ? ' is-active' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => runCommand(command.id)}
                  >
                    <span>{t(command.label)}</span>
                    <span className="search-command-key">↵</span>
                  </button>
                ))}
                <p className="search-command-hint">{t('↑↓ 选择，回车执行；输入关键词继续搜索。')}</p>
              </div>
            ) : (
              <p className="search-empty">{t('没有匹配的命令。')}</p>
            )
          ) : !trimmedQuery ? (
            <p className="search-empty">{t('输入关键词，跨所有书搜索书名、章节正文、笔记和生成内容。')}</p>
          ) : loading && results.length === 0 ? (
            <p className="search-empty">{t('正在搜索…')}</p>
          ) : results.length === 0 ? (
            <p className="search-empty">{t('没有找到')}「{trimmedQuery}」。</p>
          ) : ordered.length === 0 ? (
            <p className="search-empty">{t('没有这一类型的结果。')}</p>
          ) : (
            <>
              {GROUPS.map((group) => {
                const items = visible.filter((result) => result.type === group.type)
                if (items.length === 0) return null
                return (
                  <section key={group.type} className="search-group">
                    <div className="search-group-label">
                      {t(group.label)}
                      <span>{items.length}</span>
                    </div>
                    {items.map((result) => {
                      const index = visible.indexOf(result)
                      return (
                        <button
                          key={`${result.type}-${result.id}`}
                          type="button"
                          className={`search-result${index === active ? ' is-active' : ''}`}
                          aria-current={index === active ? 'true' : undefined}
                          onMouseEnter={() => setActive(index)}
                          onClick={() => onOpen(result)}
                        >
                          <span className="search-result-line">
                            <span className={`search-result-kind type-${result.type}`}>{t(KIND_LABEL[result.type])}</span>
                            {result.source === 'semantic' ? <span className="search-result-source">{t('语义')}</span> : null}
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
              })}
              {pageCount > 1 ? (
                <div className="search-pager">
                  <button
                    type="button"
                    disabled={safePage === 0}
                    onClick={() => {
                      setPage(safePage - 1)
                      setActive(0)
                    }}
                  >
                    {t('上一页')}
                  </button>
                  <span>
                    {t('第')} {safePage + 1} / {pageCount} · {t('共')} {ordered.length} {t('条')}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => {
                      setPage(safePage + 1)
                      setActive(0)
                    }}
                  >
                    {t('下一页')}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
        <div className="search-footer">
          <span>{t('↑↓ 选择 · ↵ 打开')}</span>
          <span>{filter === 'all' ? `${results.length} ${t('条结果')}` : `${ordered.length} ${t('条结果')}`} · {t('Esc 关闭')}</span>
        </div>
        <p id="search-active-result" className="sr-only" aria-live="polite">
          {visible[active]
            ? `${t('当前结果')}：${visible[active]!.title}，${visible[active]!.bookTitle}`
            : `${results.length} ${t('条结果')}`}
        </p>
      </div>
    </div>
  )
}
