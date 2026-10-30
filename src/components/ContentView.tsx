import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'

import type {
  BookSummary,
  ContentApplyAction,
  ContentItem,
  ContentKind,
  ContentStatus,
} from '../../shared/types.js'
import { notifyContentCurrent } from '../lib/content-events.js'
import { CONTENT_KIND_LABELS, contentSnippet, contentToMarkdown } from '../lib/content-view.js'
import { Markdown } from './Markdown.js'

interface ContentViewProps {
  books: BookSummary[]
  initialItemId?: string | null
  onBack(): void
  onOpenSource(bookId: string, chapterId: string | null): void
  onAppliedSource?(bookId: string, chapterId: string): void
}

type StatusFilter = 'active' | ContentStatus | 'all'

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: '使用中' },
  { value: 'adopted', label: '已采用' },
  { value: 'archived', label: '已归档' },
  { value: 'deleted', label: '回收站' },
  { value: 'all', label: '全部（含回收站）' },
]

const KIND_OPTIONS: Array<{ value: ContentKind | ''; label: string }> = [
  { value: '', label: '全部类型' },
  { value: 'report', label: '报告' },
  { value: 'chat', label: '对话' },
  { value: 'quiz', label: '出题' },
  { value: 'notes', label: '章节笔记' },
  { value: 'format', label: 'AI 排版' },
  { value: 'compose', label: '整本成稿' },
  { value: 'suggestion', label: '整理建议' },
  { value: 'pdf', label: 'PDF 页' },
]

const STATUS_LABEL: Record<ContentStatus, string> = {
  draft: '草稿',
  adopted: '已采用',
  archived: '已归档',
  deleted: '已删除',
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 16).replace('T', ' ')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function sourceLabel(item: ContentItem): string {
  if (item.bookTitle) {
    return `${item.bookTitle}${item.chapterTitle ? ` · ${item.chapterTitle}` : ''}`
  }
  return item.scope === 'library' || item.scope === 'all' || item.scope === 'latest' ? '全库' : item.scope
}

export function ContentView({ books, initialItemId, onBack, onOpenSource, onAppliedSource }: ContentViewProps): JSX.Element {
  const [items, setItems] = useState<ContentItem[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<ContentKind | ''>('')
  const [bookId, setBookId] = useState('')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      void window.api
        .listContent({
          query: query.trim() || undefined,
          kind: kind || undefined,
          bookId: bookId || undefined,
          favorite: favoriteOnly || undefined,
          status,
          limit: 300,
        })
        .then((found) => {
          if (cancelled) return
          setItems(found)
          setError(null)
          setSelectedId((current) => {
            if (current && found.some((item) => item.id === current)) return current
            if (initialItemId && found.some((item) => item.id === initialItemId)) return initialItemId
            return found[0]?.id ?? ''
          })
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 160)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, kind, bookId, status, favoriteOnly, initialItemId, refreshTick])

  useEffect(() => {
    if (!initialItemId) return
    setSelectedId(initialItemId)
    void window.api.getContent(initialItemId).then((item) => {
      if (!item) return
      setItems((current) => (current.some((row) => row.id === item.id) ? current : [item, ...current]))
    })
  }, [initialItemId])

  const refresh = useCallback(() => setRefreshTick((value) => value + 1), [])

  function replaceItem(next: ContentItem): void {
    setItems((current) => current.map((item) => (item.id === next.id ? next : item)))
  }

  async function toggleFavorite(item: ContentItem): Promise<void> {
    setBusy(`favorite:${item.id}`)
    setError(null)
    try {
      const next = await window.api.setContentFavorite(item.id, !item.favorite)
      replaceItem(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function changeStatus(item: ContentItem, nextStatus: ContentStatus): Promise<void> {
    setBusy(`status:${item.id}`)
    setError(null)
    try {
      const next = await window.api.setContentStatus(item.id, nextStatus)
      const stays =
        status === 'all' ||
        (status === 'active' ? nextStatus === 'draft' || nextStatus === 'adopted' : status === nextStatus)
      if (stays) replaceItem(next)
      else setItems((current) => current.filter((row) => row.id !== item.id))
      setNotice(nextStatus === 'archived' ? '已归档。' : nextStatus === 'deleted' ? '已放入回收站。' : '已恢复。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function remove(item: ContentItem): Promise<void> {
    if (!window.confirm(`删除「${item.title}」？它会进入回收站，之后还可以恢复。`)) return
    await changeStatus(item, 'deleted')
  }

  async function apply(item: ContentItem, action: ContentApplyAction): Promise<void> {
    if (action === 'source') {
      const label = item.kind === 'format' ? '应用这次排版会覆盖当前章节的排版' : '恢复这组笔记会替换本章未人工修改的 AI 笔记'
      if (!window.confirm(`${label}，确定继续？`)) return
    }
    setBusy(`apply:${action}:${item.id}`)
    setError(null)
    setNotice(null)
    try {
      const result = await window.api.applyContent(item.id, action)
      setNotice(result.message)
      if (action === 'current') notifyContentCurrent({ tool: item.tool, scope: item.scope })
      if (action === 'source' && result.chapterId && item.bookId) onAppliedSource?.(item.bookId, result.chapterId)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function copy(item: ContentItem): Promise<void> {
    setError(null)
    try {
      await window.api.copyText(contentToMarkdown(item))
      setNotice('内容已复制。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function exportItem(item: ContentItem): Promise<void> {
    setError(null)
    try {
      const name = `${item.title}.md`.replace(/[\\/:*?"<>|#%{}]/g, ' ').replace(/\s+/g, ' ').trim()
      const saved = await window.api.saveMarkdown(name, contentToMarkdown(item))
      if (saved.saved) setNotice(`已导出到 ${saved.path}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const canApplySource = selected?.kind === 'format' || selected?.kind === 'notes'
  const canSetCurrent = selected?.kind === 'chat' || selected?.kind === 'quiz' || selected?.kind === 'compose'

  return (
    <main className="content-view">
      <div className="content-head">
        <div>
          <h1>生成内容库</h1>
          <p>所有 AI 生成的结果都在这里；可以收藏、归档、删除，或重新应用到章节和笔记。</p>
        </div>
        <button type="button" className="ghost-button" onClick={onBack}>
          返回
        </button>
      </div>

      <div className="content-toolbar">
        <input
          className="notes-filter-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题或正文…"
        />
        <select className="notes-select" value={kind} onChange={(event) => setKind(event.target.value as ContentKind | '')}>
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select className="notes-select" value={bookId} onChange={(event) => setBookId(event.target.value)}>
          <option value="">全部书</option>
          {books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.title}
            </option>
          ))}
        </select>
        <select
          className="notes-select"
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`ghost-button small${favoriteOnly ? ' is-active' : ''}`}
          onClick={() => setFavoriteOnly((value) => !value)}
        >
          ★ 收藏
        </button>
        <span className="content-count">{loading ? '加载中…' : `${items.length} 条`}</span>
      </div>

      {error ? <div className="inline-error">{error}</div> : null}
      {notice ? <div className="inline-notice">{notice}</div> : null}

      <div className="content-layout">
        <div className="content-list">
          {!loading && items.length === 0 ? (
            <p className="content-empty">还没有符合条件的生成内容。去阅读、出题或工作台生成一次吧。</p>
          ) : null}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`content-row${selected?.id === item.id ? ' is-active' : ''}`}
              onClick={() => {
                setSelectedId(item.id)
                setNotice(null)
                setError(null)
              }}
            >
              <span className="content-row-top">
                <span className={`content-kind kind-${item.kind}`}>{CONTENT_KIND_LABELS[item.kind]}</span>
                <span className="content-row-title">{item.title}</span>
                {item.favorite ? <span className="content-star">★</span> : null}
              </span>
              <span className="content-row-meta">
                {sourceLabel(item)} · {formatDate(item.updatedAt)} · {STATUS_LABEL[item.status]}
              </span>
              <span className="content-row-snippet">{contentSnippet(item)}</span>
            </button>
          ))}
        </div>

        <section className="content-detail">
          {selected ? (
            <>
              <div className="content-detail-head">
                <div>
                  <span className={`content-kind kind-${selected.kind}`}>{CONTENT_KIND_LABELS[selected.kind]}</span>
                  <h2>{selected.title}</h2>
                  <p>
                    {sourceLabel(selected)} · {formatDate(selected.updatedAt)} · {STATUS_LABEL[selected.status]}
                    {selected.appliedNoteId ? ' · 已存为笔记' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className={`icon-button content-favorite${selected.favorite ? ' is-on' : ''}`}
                  onClick={() => void toggleFavorite(selected)}
                  disabled={busy === `favorite:${selected.id}`}
                  title={selected.favorite ? '取消收藏' : '收藏'}
                  aria-label={selected.favorite ? '取消收藏' : '收藏'}
                >
                  {selected.favorite ? '★' : '☆'}
                </button>
              </div>

              <div className="content-actions">
                <button
                  type="button"
                  className="primary-button small"
                  onClick={() => void apply(selected, 'note')}
                  disabled={busy !== null || selected.status === 'deleted'}
                >
                  {busy === `apply:note:${selected.id}` ? '保存中…' : '存为笔记'}
                </button>
                {canApplySource ? (
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={() => void apply(selected, 'source')}
                    disabled={busy !== null || selected.status === 'deleted'}
                  >
                    {busy === `apply:source:${selected.id}` ? '应用中…' : '应用到章节'}
                  </button>
                ) : null}
                {canSetCurrent ? (
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={() => void apply(selected, 'current')}
                    disabled={busy !== null || selected.status === 'deleted'}
                  >
                    {busy === `apply:current:${selected.id}` ? '设置中…' : '设为当前'}
                  </button>
                ) : null}
                <button type="button" className="ghost-button small" onClick={() => void copy(selected)}>
                  复制
                </button>
                <button type="button" className="ghost-button small" onClick={() => void exportItem(selected)}>
                  导出 .md
                </button>
                {selected.bookId ? (
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={() => onOpenSource(selected.bookId!, selected.chapterId)}
                  >
                    打开来源
                  </button>
                ) : null}
                {selected.status === 'deleted' || selected.status === 'archived' ? (
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={() => void changeStatus(selected, 'draft')}
                    disabled={busy !== null}
                  >
                    恢复
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-button muted"
                    onClick={() => void changeStatus(selected, 'archived')}
                    disabled={busy !== null}
                  >
                    归档
                  </button>
                )}
                {selected.status !== 'deleted' ? (
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() => void remove(selected)}
                    disabled={busy !== null}
                  >
                    删除
                  </button>
                ) : null}
              </div>

              <div className="content-preview">
                <Markdown text={contentToMarkdown(selected)} />
              </div>
            </>
          ) : (
            <p className="content-empty">从左侧选择一条生成内容查看。</p>
          )}
        </section>
      </div>
    </main>
  )
}
