import { useEffect, type JSX } from 'react'
import type { RelatedNote } from '../../shared/types.js'
import { Markdown } from './Markdown.js'

interface EchoDialogProps {
  bookTitle: string
  chapterTitle: string
  excerpt: string
  echoes: RelatedNote[]
  onOpen(echo: RelatedNote): void
  onClose(): void
}

export function EchoDialog({ bookTitle, chapterTitle, excerpt, echoes, onOpen, onClose }: EchoDialogProps): JSX.Element {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="echo-modal" role="dialog" aria-modal="true" aria-label="页边回声" onMouseDown={(event) => event.stopPropagation()}>
        <div className="echo-head">
          <div>
            <h2>页边回声</h2>
            <p>这一章和你其他书里的笔记，靠语义相似度找到的连接。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="echo-grid">
          <section className="echo-current">
            <div className="echo-label">这一章</div>
            <h3>{chapterTitle}</h3>
            <p className="echo-source">{bookTitle}</p>
            <div className="echo-excerpt">
              {excerpt.trim() ? <Markdown text={excerpt} /> : <p className="muted">这一章还没有读薄稿或卡片。</p>}
            </div>
          </section>

          <section className="echo-side">
            <div className="echo-label">其他书里的回声 · {echoes.length}</div>
            <div className="echo-list">
              {echoes.map((echo) => (
                <button key={echo.id} type="button" className="echo-card" onClick={() => onOpen(echo)}>
                  <span className="echo-card-source">
                    {echo.bookTitle}
                    {echo.chapterTitle ? ` · ${echo.chapterTitle}` : ''}
                  </span>
                  <span className="echo-card-title">{echo.title}</span>
                  <span className="echo-card-body">
                    {echo.content.replace(/\s+/g, ' ').trim().slice(0, 180)}
                    {echo.content.length > 180 ? '…' : ''}
                  </span>
                  <span className="echo-card-open">打开这一章</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <p className="echo-foot">回声只来自你本机的笔记；相似度由本地语义索引计算。</p>
      </div>
    </div>
  )
}
