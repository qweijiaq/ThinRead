import type { JSX } from 'react'
import type { BookSummary } from '../../shared/types.js'

interface LibraryProps {
  books: BookSummary[]
  importing: boolean
  onOpen(bookId: string): void
  onImport(): void
  onDelete(bookId: string): void
}

export function Library({ books, importing, onOpen, onImport, onDelete }: LibraryProps): JSX.Element {
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
          {importing ? '正在解析…' : '导入一本 EPUB / PDF'}
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
          <p>{books.length} 本书 · {books.reduce((sum, book) => sum + book.noteCount, 0)} 条笔记</p>
        </div>
        <button type="button" className="primary-button" onClick={onImport} disabled={importing}>
          {importing ? '正在解析…' : '导入新书'}
        </button>
      </div>
      <div className="book-grid">
        {books.map((book) => (
          <article key={book.id} className="book-card" onClick={() => onOpen(book.id)}>
            <div className={`book-spine ${book.format}`}>
              <span>{book.title.slice(0, 12)}</span>
            </div>
            <div className="book-body">
              <h3>{book.title}</h3>
              <p className="book-author">{book.author || '未知作者'}</p>
              <div className="book-meta">
                <span>{book.chapterCount} 节</span>
                {book.hiddenChapterCount > 0 ? <span>已隐藏 {book.hiddenChapterCount}</span> : null}
                <span>{book.noteCount} 条笔记</span>
                <span>{book.format.toUpperCase()}</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.round(book.progress * 100)}%` }} />
              </div>
              <div className="book-actions">
                <span>{book.progress > 0 ? `已读 ${Math.round(book.progress * 100)}%` : '尚未开始'}</span>
                <button
                  type="button"
                  className="text-button danger"
                  onClick={(event) => {
                    event.stopPropagation()
                    if (window.confirm(`从书架移除《${book.title}》？笔记也会一并删除。`)) onDelete(book.id)
                  }}
                >
                  移除
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}
