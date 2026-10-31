import { useEffect, useMemo, useState, type JSX } from 'react'
import type { BookSummary } from '../../shared/types.js'
import { bookGenreLabel } from '../lib/genres.js'
import { confirmDialog } from './ConfirmDialog.js'
import { Select } from './Select.js'

interface LibraryProps {
  books: BookSummary[]
  importing: boolean
  onOpen(bookId: string): void
  onImport(): void
  onDelete(bookId: string): void
  onRename(book: BookSummary): void
  onCompose(bookId: string): void
  onMerge(): void
}

function formatWords(value: number): string {
  if (value >= 10000) {
    const wan = value / 10000
    return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1)} 万字`
  }
  return `${value.toLocaleString()} 字`
}

type LibrarySort = 'recent' | 'title' | 'progress' | 'chars'

export function Library({ books, importing, onOpen, onImport, onDelete, onRename, onCompose, onMerge }: LibraryProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<LibrarySort>('recent')
  const [covers, setCovers] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    const candidates = books.filter((book) => book.hasCover)
    if (candidates.length === 0) {
      setCovers({})
      return
    }
    void Promise.all(
      candidates.map(async (book) => [book.id, await window.api.getBookCover(book.id)] as const),
    ).then((entries) => {
      if (cancelled) return
      setCovers(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))))
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [books])

  const visibleBooks = useMemo(() => {
    const term = query.trim().toLowerCase()
    const filtered = term
      ? books.filter((book) => `${book.title} ${book.author}`.toLowerCase().includes(term))
      : books
    // SQLite 返回的顺序已经按最近打开时间排序，这里只重排用户明确选择的维度。
    return [...filtered].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'zh-CN')
      if (sort === 'progress') return b.progress - a.progress || b.readChars - a.readChars
      if (sort === 'chars') return b.totalChars - a.totalChars
      return 0
    })
  }, [books, query, sort])

  if (books.length === 0) {
    return (
      <main className="welcome">
        <div className="welcome-mark">页边</div>
        <h1>把一本书读成自己的</h1>
        <p className="welcome-lead">
          AI 先替你读一遍，生成带原文引用的笔记草稿；你边读边改、补充、把想法连起来。
          书和笔记都在本地。
        </p>
        <button type="button" className="primary-button large" onClick={onImport} disabled={importing}>
          {importing ? '正在解析…' : '导入一本书'}
        </button>
        <div className="welcome-grid">
          <div>
            <h3>按章生成</h3>
            <p>读到哪一章生成到哪一章，摘要、论点、问题都附原文，可逐条修改。</p>
          </div>
          <div>
            <h3>边读边写</h3>
            <p>选中正文就能记想法，笔记和原文互相跳转，阅读位置不丢。</p>
          </div>
          <div>
            <h3>笔记互链</h3>
            <p>用 [[笔记标题]] 互相引用，自动出现反向链接和跨章相关笔记。</p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="library">
      <div className="library-head">
        <div>
          <h1>书架</h1>
          <p>
            {books.length} 本书 · {formatWords(books.reduce((sum, book) => sum + book.totalChars, 0))} ·{' '}
            {books.reduce((sum, book) => sum + book.noteCount, 0)} 条笔记
          </p>
        </div>
        <div className="library-head-actions">
          {books.length >= 2 ? (
            <button type="button" className="ghost-button" onClick={onMerge}>
              合并书籍
            </button>
          ) : null}
          <button type="button" className="primary-button" onClick={onImport} disabled={importing}>
            {importing ? '正在解析…' : '导入新书'}
          </button>
        </div>
      </div>
      <div className="library-toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索书名或作者…"
          aria-label="搜索书架"
        />
        <Select
          value={sort}
          onChange={(value) => setSort(value as LibrarySort)}
          ariaLabel="书架排序"
          options={[
            { value: 'recent', label: '最近阅读' },
            { value: 'title', label: '书名' },
            { value: 'progress', label: '阅读进度' },
            { value: 'chars', label: '总字数' },
          ]}
        />
        <span>{visibleBooks.length} 本</span>
      </div>
      <div className="book-grid">
        {visibleBooks.map((book) => (
          <article
            key={book.id}
            className="book-card"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(book.id)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpen(book.id)
              }
            }}
          >
            <div className={`book-spine ${book.format}${covers[book.id] ? ' has-cover' : ''}`}>
              {covers[book.id] ? (
                <img src={covers[book.id]} alt={`${book.title} 封面`} />
              ) : (
                <span>{book.title.slice(0, 12)}</span>
              )}
            </div>
            <div className="book-body">
              <h3>{book.title}</h3>
              <p className="book-author">{book.author || '未知作者'}</p>
              <div className="book-meta">
                <span>{formatWords(book.totalChars)}</span>
                <span>{book.chapterCount} 节</span>
                {book.hiddenChapterCount > 0 ? <span>已隐藏 {book.hiddenChapterCount}</span> : null}
                <span>{book.noteCount} 条笔记</span>
                <span>{book.format.toUpperCase()}</span>
                <span>{bookGenreLabel(book.genre)}</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.round(book.progress * 100)}%` }} />
              </div>
              <div className="book-actions">
                <span>
                  {book.progress > 0
                    ? `已读 ${Math.round(book.progress * 100)}% · ${formatWords(book.readChars)}`
                    : '尚未开始'}
                </span>
                <span className="book-action-buttons">
                  <button
                    type="button"
                    className="text-button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onCompose(book.id)
                    }}
                  >
                    成书
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onRename(book)
                    }}
                  >
                    改名
                  </button>
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={(event) => {
                      event.stopPropagation()
                      void confirmDialog({
                        title: '移除书籍',
                        message: `从书架移除《${book.title}》？笔记也会一并删除。`,
                        confirmLabel: '移除',
                        danger: true,
                      }).then((confirmed) => {
                        if (confirmed) onDelete(book.id)
                      })
                    }}
                  >
                    移除
                  </button>
                </span>
              </div>
            </div>
          </article>
        ))}
        {visibleBooks.length === 0 ? <p className="library-filter-empty">没有匹配「{query.trim()}」的书。</p> : null}
      </div>
    </main>
  )
}
