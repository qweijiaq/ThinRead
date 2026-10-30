import type { JSX } from 'react'
import type { BookSummary } from '../../shared/types.js'
import { bookGenreLabel } from '../lib/genres.js'
import { confirmDialog } from './ConfirmDialog.js'

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

export function Library({ books, importing, onOpen, onImport, onDelete, onRename, onCompose, onMerge }: LibraryProps): JSX.Element {
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
      <div className="book-grid">
        {books.map((book) => (
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
            <div className={`book-spine ${book.format}`}>
              <span>{book.title.slice(0, 12)}</span>
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
      </div>
    </main>
  )
}
