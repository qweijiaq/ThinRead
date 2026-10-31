import { useEffect, useState, type JSX } from 'react'

import type { BookSummary, HighlightImportResult } from '../../shared/types.js'
import { Checkbox } from './Checkbox.js'

interface ImportDialogProps {
  open: boolean
  onClose(): void
  onFileImport(): Promise<BookSummary | null>
  onImported(book: BookSummary): void
  onHighlightsImported(result: HighlightImportResult): void
  onOcrStarted(fileName: string): void
}

type ImportMode = 'file' | 'text' | 'url' | 'highlights'

export function ImportDialog({
  open,
  onClose,
  onFileImport,
  onImported,
  onHighlightsImported,
  onOcrStarted,
}: ImportDialogProps): JSX.Element | null {
  const [mode, setMode] = useState<ImportMode>('file')
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [ocrStart, setOcrStart] = useState('')
  const [ocrEnd, setOcrEnd] = useState('')
  const [mergeHighlights, setMergeHighlights] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMode('file')
    setTitle('')
    setAuthor('')
    setText('')
    setUrl('')
    setOcrStart('')
    setOcrEnd('')
    setMergeHighlights(false)
    setError(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  async function chooseFile(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const book = await onFileImport()
      if (book) onImported(book)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function chooseScannedPdf(): Promise<void> {
    const startPage = ocrStart.trim() ? Number(ocrStart) : 0
    const endPage = ocrEnd.trim() ? Number(ocrEnd) : 0
    if (
      (startPage && (!Number.isFinite(startPage) || startPage < 1)) ||
      (endPage && (!Number.isFinite(endPage) || endPage < 1)) ||
      (startPage > 0 && endPage > 0 && startPage > endPage)
    ) {
      setError('页码范围无效：起始页不能大于结束页。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.importScannedPdf(
        startPage > 0 || endPage > 0
          ? {
              ...(startPage > 0 ? { startPage } : {}),
              ...(endPage > 0 ? { endPage } : {}),
            }
          : undefined,
      )
      if (result?.started) {
        onOcrStarted(result.fileName)
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function chooseHighlights(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.importHighlights({ mergeExisting: mergeHighlights })
      if (result) onHighlightsImported(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function importText(): Promise<void> {
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const book = await window.api.importText({ title: title.trim(), author: author.trim(), text })
      onImported(book)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function importUrl(): Promise<void> {
    if (!url.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const book = await window.api.importUrl(url.trim())
      onImported(book)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop import-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="import-modal"
        role="dialog"
        aria-modal="true"
        aria-label="导入书籍"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="import-head">
          <div>
            <h2>导入一本书</h2>
            <p>从电子书、粘贴的文字或网页开始读。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="import-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'file'} className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')} disabled={busy}>
            电子书文件
          </button>
          <button type="button" role="tab" aria-selected={mode === 'text'} className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')} disabled={busy}>
            粘贴文本
          </button>
          <button type="button" role="tab" aria-selected={mode === 'url'} className={mode === 'url' ? 'active' : ''} onClick={() => setMode('url')} disabled={busy}>
            网页链接
          </button>
          <button type="button" role="tab" aria-selected={mode === 'highlights'} className={mode === 'highlights' ? 'active' : ''} onClick={() => setMode('highlights')} disabled={busy}>
            划线 / 标注
          </button>
        </div>

        {mode === 'file' ? (
          <section className="import-pane">
            <p className="import-hint">支持 EPUB、PDF、MOBI、AZW3、DOCX、HTML、Markdown 和 TXT。DRM 加密的电子书无法导入。</p>
            <div className="import-field-row">
              <label className="import-field">
                扫描版起始页
                <input
                  type="number"
                  min={1}
                  value={ocrStart}
                  onChange={(event) => setOcrStart(event.target.value)}
                  placeholder="留空为第 1 页"
                />
              </label>
              <label className="import-field">
                结束页
                <input
                  type="number"
                  min={1}
                  value={ocrEnd}
                  onChange={(event) => setOcrEnd(event.target.value)}
                  placeholder="留空为最后一页"
                />
              </label>
            </div>
            <div className="import-actions">
              <button type="button" className="primary-button" onClick={() => void chooseFile()} disabled={busy}>
                {busy ? '正在解析…' : '选择电子书文件'}
              </button>
              <button type="button" className="ghost-button" onClick={() => void chooseScannedPdf()} disabled={busy}>
                扫描版 PDF（OCR）
              </button>
            </div>
            <p className="import-foot">普通 PDF 会优先读取文字层；扫描版请用 OCR 入口（仅 macOS，最多 300 页）。选完文件后会转到右下角任务中心，导入过程中可以离开这个页面或取消。页码范围只对扫描版 OCR 生效，留空表示整本；单次最多 300 页。Markdown / HTML / DOCX 会保留标题层级并切成章节。</p>
          </section>
        ) : mode === 'text' ? (
          <section className="import-pane">
            <div className="import-field-row">
              <label className="import-field">
                标题
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="不填则使用「未命名文本」" />
              </label>
              <label className="import-field">
                作者
                <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="可选" />
              </label>
            </div>
            <label className="import-field">
              正文
              <textarea value={text} onChange={(event) => setText(event.target.value)} rows={12} placeholder="粘贴文章、读书笔记或整本书的文字…" />
            </label>
            <div className="import-actions">
              <span className="muted">{text.trim().length.toLocaleString()} 字</span>
              <button type="button" className="primary-button" onClick={() => void importText()} disabled={busy || text.trim().length < 20}>
                {busy ? '正在整理…' : '导入文本'}
              </button>
            </div>
          </section>
        ) : mode === 'highlights' ? (
          <section className="import-pane">
            <p className="import-hint">
              支持 Readwise 的 CSV 导出和 Kindle 的 My Clippings.txt。每本书会建立一本独立书籍，每条划线保存为可编辑的高亮笔记。
            </p>
            <Checkbox
              checked={mergeHighlights}
              onChange={setMergeHighlights}
              label="合并到同名书（书名和作者都匹配时追加划线）"
            />
            <button type="button" className="primary-button" onClick={() => void chooseHighlights()} disabled={busy}>
              {busy ? '正在整理划线…' : '选择划线文件'}
            </button>
            <p className="import-foot">Readwise 请选择 readwise.csv；Kindle 请选择 My Clippings.txt。重复划线会自动去重；不勾选合并时会为每本书建立新书。</p>
          </section>
        ) : (
          <section className="import-pane">
            <label className="import-field">
              网页地址
              <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" autoFocus />
            </label>
            <p className="import-hint">会抓取网页正文，去掉导航和广告；只保存正文文本，不下载图片。也可以直接导入本地 HTML 文件。</p>
            <div className="import-actions">
              <span className="muted">只支持公开的 http / https 页面</span>
              <button type="button" className="primary-button" onClick={() => void importUrl()} disabled={busy || !url.trim()}>
                {busy ? '正在抓取…' : '抓取并导入'}
              </button>
            </div>
          </section>
        )}

        {error ? <div className="inline-error">{error}</div> : null}
      </div>
    </div>
  )
}
