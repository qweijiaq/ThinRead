import { useEffect, type JSX } from 'react'
import { t, useLocale } from '../lib/i18n.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
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
  useLocale()
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose, 'button')
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="echo-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('相关笔记')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="echo-head">
          <div>
            <h2>{t('相关笔记')}</h2>
            <p>{t('这一章和你其他书里的笔记，靠语义相似度找到的连接。')}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        <div className="echo-grid">
          <section className="echo-current">
            <div className="echo-label">{t('这一章')}</div>
            <h3>{chapterTitle}</h3>
            <p className="echo-source">{bookTitle}</p>
            <div className="echo-excerpt">
              {excerpt.trim() ? <Markdown text={excerpt} /> : <p className="muted">{t('这一章还没有知识点卡片。')}</p>}
            </div>
          </section>

          <section className="echo-side">
            <div className="echo-label">{t('其他书里的相关笔记')} · {echoes.length}</div>
            <div className="echo-list">
              {echoes.length === 0 ? (
                <div className="echo-empty">
                  <p>{t('暂时没有找到足够相关的知识点。')}</p>
                  <p className="muted">{t('相关笔记只参考其他书里的知识点卡片；相似度不够的弱关联不会显示。')}</p>
                </div>
              ) : (
                echoes.map((echo) => (
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
                    <span className="echo-card-open">{t('打开这一章')}</span>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>

        <p className="echo-foot">{t('相关笔记只来自你本机的知识点和笔记；相似度由本地语义索引或概念标签计算。')}</p>
      </div>
    </div>
  )
}
