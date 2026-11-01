import { useEffect, useMemo, useState, type JSX } from 'react'
import { useDialogFocus } from '../lib/useDialogFocus.js'

import type { BookSummary } from '../../shared/types.js'
import type { PublishCoverStyle } from '../lib/publish-cover.js'
import { todayStamp } from '../lib/export.js'
import { Checkbox } from './Checkbox.js'
import { Select } from './Select.js'

interface PublishDialogProps {
  open: boolean
  book: BookSummary
  title: string
  markdown: string
  onClose(): void
}

function summaryOf(markdown: string, length = 140): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, length)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

export function PublishDialog({ open, book, title, markdown, onClose }: PublishDialogProps): JSX.Element | null {
  const [displayTitle, setDisplayTitle] = useState(title || book.title)
  const [description, setDescription] = useState('')
  const [includeCover, setIncludeCover] = useState(true)
  const [includeMarkdown, setIncludeMarkdown] = useState(true)
  const [coverStyle, setCoverStyle] = useState<PublishCoverStyle>('paper')
  const [cover, setCover] = useState('')
  const [coverError, setCoverError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const date = useMemo(() => todayStamp(), [open])

  useEffect(() => {
    if (!open) return
    setDisplayTitle(title || book.title)
    setDescription(summaryOf(markdown, 140))
    setIncludeCover(true)
    setIncludeMarkdown(true)
    setCoverStyle('paper')
    setError(null)
    setNotice(null)
    setCoverError('')
  }, [open, title, markdown, book.title])

  useEffect(() => {
    if (!open || !includeCover) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void import('../lib/publish-cover.js')
        .then(({ renderPublishCover }) => {
          const next = renderPublishCover({
            title: displayTitle.trim() || book.title,
            author: book.author,
            date,
            description,
            style: coverStyle,
          })
          if (!cancelled) {
            setCover(next)
            setCoverError('')
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) setCoverError(err instanceof Error ? err.message : String(err))
        })
    }, 80)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, includeCover, displayTitle, description, book.title, book.author, date, coverStyle])

  const dialogRef = useDialogFocus<HTMLDivElement>(open, () => { if (!busy) onClose() }, 'button')
  if (!open) return null

  async function exportPackage(): Promise<void> {
    if (!markdown.trim() || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const { buildPublishPackage } = await import('../lib/publish-package.js')
      const pkg = await buildPublishPackage({
        bookTitle: book.title,
        author: book.author,
        title: displayTitle,
        markdown,
        description,
        date,
        coverDataUrl: cover,
        includeCover,
        includeMarkdown,
        coverStyle,
      })
      const saved = await window.api.saveBinary(pkg.fileName, bytesToBase64(pkg.archive))
      if (saved.saved) setNotice(`发布包已导出到 ${saved.path}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        ref={dialogRef}
        className="publish-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="导出发布包"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="import-head">
          <div>
            <h2>发布这本书</h2>
            <p>生成一个可以直接上传到静态托管的发布包。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="publish-grid">
          <div className="publish-preview">
            {includeCover ? (
              cover ? (
                <img src={cover} alt="发布封面预览" />
              ) : (
                <div className="publish-cover-empty">{coverError ? '封面生成失败' : '正在生成封面…'}</div>
              )
            ) : (
              <div className="publish-cover-empty">不包含封面</div>
            )}
            <span>{includeCover ? '封面 / OG 图 · 1200 × 630' : '未选择封面'}</span>
          </div>

          <div className="publish-fields">
            <label className="import-field">
              文章标题
              <input value={displayTitle} onChange={(event) => setDisplayTitle(event.target.value)} />
            </label>
            <label className="import-field">
              摘要
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                placeholder="用于页面描述和社交分享"
              />
            </label>
            <label className="import-field">
              封面样式
              <Select
                value={coverStyle}
                onChange={(value) => setCoverStyle(value as PublishCoverStyle)}
                ariaLabel="封面样式"
                options={[
                  { value: 'paper', label: '纸色 · 页边' },
                  { value: 'ink', label: '墨色 · 夜读' },
                  { value: 'minimal', label: '极简 · 蓝' },
                ]}
              />
            </label>
            <div className="publish-checks">
              <Checkbox checked={includeCover} onChange={setIncludeCover} label="包含封面和 OG 图" />
              <Checkbox checked={includeMarkdown} onChange={setIncludeMarkdown} label="附带 Markdown 原稿" />
            </div>
            <p className="field-hint">
              发布包包含 index.html、cover.png、metadata.json{includeMarkdown ? '、notes.md' : ''}
              和一份上传说明。静态页不依赖外部资源。
            </p>
            {coverError ? <div className="inline-error" role="alert">{coverError}</div> : null}
            {error ? <div className="inline-error" role="alert">{error}</div> : null}
            {notice ? <div className="inline-notice" role="status" aria-live="polite">{notice}</div> : null}
            <div className="publish-actions">
              <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>
                关闭
              </button>
              <button type="button" className="primary-button" onClick={() => void exportPackage()} disabled={busy || !markdown.trim()}>
                {busy ? '正在打包…' : '导出发布包'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
