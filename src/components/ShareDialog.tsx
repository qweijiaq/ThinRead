import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useDialogFocus } from '../lib/useDialogFocus.js'

import { Checkbox } from './Checkbox.js'

import {
  renderShareCard,
  shareFilename,
  shareText,
  type ShareBook,
  type ShareCardInput,
  type ShareNote,
  type ShareRatio,
  type ShareTemplate,
  type ShareTheme,
} from '../lib/share-card.js'

interface ShareDialogProps {
  note?: ShareNote | null
  book?: ShareBook | null
  notes?: ShareNote[] | null
  initialTemplate?: ShareTemplate
  onClose(): void
}

const TEMPLATE_OPTIONS: Array<{ value: ShareTemplate; label: string }> = [
  { value: 'quote', label: '金句卡' },
  { value: 'knowledge', label: '知识卡' },
  { value: 'condensed', label: '读薄卡' },
  { value: 'book', label: '整本书' },
  { value: 'deck', label: '长图' },
]

const TEMPLATE_HINT: Record<ShareTemplate, string> = {
  quote: '把一句原文放大，适合摘录和转发。',
  knowledge: '一句话主张 + 简短解释，适合知识点。',
  condensed: '一段读薄稿，适合分享一章的完整意思。',
  book: '书名 + 关键卡片，适合读完一本书后发总结。',
  deck: '把多张笔记排成一张长图，适合一次分享一组摘录。',
}

function preferredTemplate(note: ShareNote): ShareTemplate {
  if (note.quote?.trim()) return 'quote'
  if (note.kind === 'condensed') return 'condensed'
  return 'knowledge'
}

function quoteFallback(note: ShareNote): string {
  const text = note.quote?.trim() || note.content.trim()
  return text.length > 260 ? `${text.slice(0, 260).replace(/[，。；、,.;:]?$/, '')}…` : text
}

function readPreference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    if (stored && (allowed as readonly string[]).includes(stored)) return stored as T
  } catch {
    // localStorage 不可用时用默认值。
  }
  return fallback
}

export function ShareDialog({ note, book, notes, initialTemplate, onClose }: ShareDialogProps): JSX.Element {
  const [template, setTemplate] = useState<ShareTemplate>(
    initialTemplate ?? (note ? preferredTemplate(note) : (notes?.length ?? 0) > 1 ? 'deck' : 'book'),
  )
  const [theme, setTheme] = useState<ShareTheme>(() =>
    readPreference<'paper' | 'ink'>('reading-notes-share-theme', ['paper', 'ink'], 'paper'),
  )
  const [ratio, setRatio] = useState<ShareRatio>(() =>
    readPreference<'portrait' | 'square'>('reading-notes-share-ratio', ['portrait', 'square'], 'portrait'),
  )
  const [title, setTitle] = useState(note?.title ?? book?.title ?? ((notes?.length ?? 0) > 0 ? '读书摘录' : ''))
  const [body, setBody] = useState(note?.content ?? '')
  const [quote, setQuote] = useState(note ? quoteFallback(note) : '')
  const [source, setSource] = useState(
    note
      ? `${note.bookTitle}${note.chapterTitle ? ` · ${note.chapterTitle}` : ''}`
      : book?.author ?? ((notes?.length ?? 0) > 0 ? '我的读书摘录' : ''),
  )
  const [tags, setTags] = useState<string[]>(note?.tags ?? [])
  const [hideSource, setHideSource] = useState(false)
  const [hideTags, setHideTags] = useState(false)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState<'copy' | 'save' | 'text' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    setTemplate(initialTemplate ?? (note ? preferredTemplate(note) : (notes?.length ?? 0) > 1 ? 'deck' : 'book'))
    setTitle(note?.title ?? book?.title ?? ((notes?.length ?? 0) > 0 ? '读书摘录' : ''))
    setBody(note?.content ?? '')
    setQuote(note ? quoteFallback(note) : '')
    setSource(
      note
        ? `${note.bookTitle}${note.chapterTitle ? ` · ${note.chapterTitle}` : ''}`
        : book?.author ?? ((notes?.length ?? 0) > 0 ? '我的读书摘录' : ''),
    )
    setTags(note?.tags ?? [])
    setNotice(null)
    setError(null)
  }, [note?.id, book?.title, initialTemplate, notes?.length])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    try {
      localStorage.setItem('reading-notes-share-theme', theme)
      localStorage.setItem('reading-notes-share-ratio', ratio)
    } catch {
      // 忽略存储失败。
    }
  }, [theme, ratio])

  const templateOptions = useMemo(
    () =>
      TEMPLATE_OPTIONS.filter((option) => {
        if (option.value === 'book') return Boolean(book)
        if (option.value === 'deck') return (notes?.length ?? 0) > 1
        return Boolean(note)
      }),
    [book, note, notes],
  )

  const input: ShareCardInput = useMemo(
    () => ({
      template,
      theme,
      ratio,
      title,
      body,
      quote,
      source,
      tags,
      hideSource,
      hideTags,
      book: book ?? null,
      deck: notes ?? null,
    }),
    [template, theme, ratio, title, body, quote, source, tags, hideSource, hideTags, book, notes],
  )

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await document.fonts.ready
          if (cancelled) return
          const canvas = canvasRef.current
          if (!canvas) return
          renderShareCard(canvas, input)
          setPreview(canvas.toDataURL('image/png'))
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err))
        }
      })()
    }, 80)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [input])

  async function copyImage(): Promise<void> {
    if (!preview || busy) return
    setBusy('copy')
    setError(null)
    try {
      await window.api.copyImage(preview)
      setNotice('图片已复制，可以直接粘贴到聊天窗口或编辑器。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function saveImage(): Promise<void> {
    if (!preview || busy) return
    setBusy('save')
    setError(null)
    try {
      const result = await window.api.saveImage(preview, shareFilename(input))
      if (result.saved) setNotice(`已保存到 ${result.path}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function copyText(): Promise<void> {
    if (busy) return
    setBusy('text')
    setError(null)
    try {
      await window.api.copyText(shareText(input))
      setNotice('文字和出处已复制。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose, 'button')
  return (
    <div className="modal-backdrop share-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="share-modal"
        role="dialog"
        aria-modal="true"
        aria-label="分享卡片"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="share-head">
          <div>
            <h2>做一张分享卡</h2>
            <p>{TEMPLATE_HINT[template]}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="share-layout">
          <div className="share-preview-pane">
            <div className={`share-preview-frame ratio-${ratio}${template === 'deck' ? ' is-deck' : ''}`}>
              {preview ? <img src={preview} alt="分享卡预览" /> : <span className="muted">正在排版…</span>}
            </div>
            <div className="share-preview-actions">
              <button type="button" className="primary-button small" onClick={() => void copyImage()} disabled={!preview || busy !== null}>
                {busy === 'copy' ? '复制中…' : '复制图片'}
              </button>
              <button type="button" className="ghost-button small" onClick={() => void saveImage()} disabled={!preview || busy !== null}>
                {busy === 'save' ? '保存中…' : '保存 PNG'}
              </button>
              <button type="button" className="ghost-button small" onClick={() => void copyText()} disabled={busy !== null}>
                {busy === 'text' ? '复制中…' : '复制文字'}
              </button>
            </div>
            {notice ? <div className="inline-notice">{notice}</div> : null}
            {error ? <div className="inline-error">{error}</div> : null}
          </div>

          <div className="share-controls">
            <div className="share-control-group">
              <span className="share-control-label">模板</span>
              <div className="share-segmented">
                {templateOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={template === option.value ? 'active' : ''}
                    onClick={() => setTemplate(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="share-control-row">
              <div className="share-control-group">
                <span className="share-control-label">主题</span>
                <div className="share-segmented compact">
                  <button type="button" className={theme === 'paper' ? 'active' : ''} onClick={() => setTheme('paper')}>
                    纸
                  </button>
                  <button type="button" className={theme === 'ink' ? 'active' : ''} onClick={() => setTheme('ink')}>
                    墨
                  </button>
                </div>
              </div>
              {template === 'deck' ? null : (
                <div className="share-control-group">
                  <span className="share-control-label">比例</span>
                  <div className="share-segmented compact">
                    <button type="button" className={ratio === 'portrait' ? 'active' : ''} onClick={() => setRatio('portrait')}>
                      3:4
                    </button>
                    <button type="button" className={ratio === 'square' ? 'active' : ''} onClick={() => setRatio('square')}>
                      1:1
                    </button>
                  </div>
                </div>
              )}
            </div>

            {template === 'deck' ? (
              <>
                <label className="share-field">
                  摘录集标题
                  <input value={title} onChange={(event) => setTitle(event.target.value)} />
                </label>
                <p className="share-hint">已选 {notes?.length ?? 0} 张笔记，会排成一张长图；最多显示 12 张。</p>
              </>
            ) : template === 'book' ? (
              <>
                <label className="share-field">
                  书名
                  <input value={title} onChange={(event) => setTitle(event.target.value)} />
                </label>
                <label className="share-field">
                  结尾一句
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={3}
                    placeholder="可选：读完这本书后最想留下的一句话。"
                  />
                </label>
              </>
            ) : template === 'quote' ? (
              <>
                <label className="share-field">
                  摘录
                  <textarea value={quote} onChange={(event) => setQuote(event.target.value)} rows={6} />
                </label>
                <label className="share-field">
                  卡片署名
                  <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="这张卡在说什么" />
                </label>
              </>
            ) : (
              <>
                <label className="share-field">
                  标题
                  <textarea value={title} onChange={(event) => setTitle(event.target.value)} rows={2} />
                </label>
                <label className="share-field">
                  正文
                  <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={7} />
                </label>
              </>
            )}

            <label className="share-field">
              出处
              <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="书名 · 章节" />
            </label>

            <div className="share-toggles">
              <Checkbox checked={hideSource} onChange={setHideSource} label="隐藏出处" />
              {template === 'book' || template === 'deck' ? null : (
                <Checkbox checked={hideTags} onChange={setHideTags} label="隐藏标签" />
              )}
              {note && note.tags.length > 0 ? <span className="muted">{tags.slice(0, 4).join(' · ')}</span> : null}
            </div>
            <p className="share-hint">文字会按卡片大小自动缩排；太长时保留开头，导出前可以再改。</p>
          </div>
        </div>
        <canvas ref={canvasRef} className="share-canvas" aria-hidden="true" />
      </div>
    </div>
  )
}
