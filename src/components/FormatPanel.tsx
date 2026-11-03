import { useEffect, useRef, useState, type JSX } from 'react'

import type { ChapterContent, ReaderStyle, RemovedPart } from '../../shared/types.js'
import { t, useLocale } from '../lib/i18n.js'
import { Checkbox } from './Checkbox.js'

export interface FormatMessage {
  role: 'user' | 'ai'
  text: string
}

interface FormatPanelProps {
  chapter: ChapterContent | null
  style: ReaderStyle
  busy: boolean
  error: string | null
  note: string | null
  messages: FormatMessage[]
  demo: boolean
  onFormat(instruction?: string): void
  onReset(): void
  onStyleChange(patch: Partial<ReaderStyle>): void
}

function snippet(text: string, length = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > length ? `${flat.slice(0, length)}…` : flat
}

function RemovedRow({ part, onRestore }: { part: RemovedPart; onRestore(): void }): JSX.Element {
  useLocale()
  return (
    <div className="removed-row">
      <div className="removed-head">
        <span className="removed-reason">{part.reason}</span>
        <span className={`verify-chip ${part.verified ? 'ok' : 'warn'}`}>
          {part.verified ? t('已核对') : t('未核对')}
        </span>
        <button type="button" className="text-button" onClick={onRestore}>
          {t('保留')}
        </button>
      </div>
      <p className="removed-text">“{snippet(part.text)}”</p>
    </div>
  )
}

export function FormatPanel({
  chapter,
  style,
  busy,
  error,
  note,
  messages,
  demo,
  onFormat,
  onReset,
  onStyleChange,
}: FormatPanelProps): JSX.Element {
  useLocale()
  const [input, setInput] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)
  // 滑杆先改本地草稿，停手 120ms 再提交；否则拖动一次会触发几十次全应用重渲染。
  const [draft, setDraft] = useState(style)
  const draftRef = useRef(draft)
  const styleTimer = useRef<number | null>(null)
  const onStyleChangeRef = useRef(onStyleChange)
  onStyleChangeRef.current = onStyleChange

  useEffect(() => {
    // 正在拖动时不要用外部（较旧的）style 覆盖本地草稿。
    if (styleTimer.current !== null) return
    setDraft(style)
    draftRef.current = style
  }, [style])

  useEffect(
    () => () => {
      if (styleTimer.current === null) return
      window.clearTimeout(styleTimer.current)
      styleTimer.current = null
      onStyleChangeRef.current(draftRef.current)
    },
    [],
  )

  function previewStyle(patch: Partial<ReaderStyle>): void {
    const next = { ...draftRef.current, ...patch }
    draftRef.current = next
    setDraft(next)
    if (styleTimer.current !== null) window.clearTimeout(styleTimer.current)
    styleTimer.current = window.setTimeout(() => {
      styleTimer.current = null
      onStyleChangeRef.current(next)
    }, 120)
  }

  function flushStyle(): void {
    if (styleTimer.current === null) return
    window.clearTimeout(styleTimer.current)
    styleTimer.current = null
    onStyleChangeRef.current(draftRef.current)
  }

  useEffect(() => {
    const node = messagesRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, note])

  if (!chapter) {
    return (
      <div className="format-panel">
        <div className="format-empty">{t('选择一章后，可以在这里让 AI 整理正文排版。')}</div>
      </div>
    )
  }

  const hasFormatted = Boolean(chapter.formattedHtml)
  const removed = chapter.removed

  function send(): void {
    const text = input.trim()
    if (!text || busy) return
    onFormat(text)
    setInput('')
  }

  return (
    <div className="format-panel">
      <div className="format-head">
        <div>
          <h2>{t('AI 排版')}</h2>
          <p>{chapter.title}</p>
        </div>
        {hasFormatted ? (
          <button type="button" className="text-button muted" onClick={onReset}>
            {t('还原原文')}
          </button>
        ) : null}
      </div>

      {demo ? (
        <div className="format-hint">
          {t('演示模式不支持 AI 排版。样式滑杆仍然可用；要让 AI 清理无关内容，请先在设置里配置真实模型。')}
        </div>
      ) : null}

      <button
        type="button"
        className="primary-button format-run"
        onClick={() => onFormat()}
        disabled={busy || demo}
      >
        {busy ? t('AI 正在整理这一章…') : hasFormatted ? t('✦ 重新整理这一章') : t('✦ 整理这一章')}
      </button>

      {error ? <div className="inline-error" role="alert">{error}</div> : null}

      {busy ? (
        <div className="streaming-card format-streaming">
          <div className="streaming-head">
            <span className="spinner" />
            <span>{t('正在清理广告、重复标题，并调整段落与标题层级…')}</span>
          </div>
        </div>
      ) : null}

      {note ? <div className="format-note">{note}</div> : null}

      {removed.length > 0 ? (
        <section className="format-section">
          <div className="format-section-head">
            <span>{t('本次移除')} {removed.length} {t('处')}</span>
            <span className="muted">{t('原文未修改，可逐条保留')}</span>
          </div>
          {removed.map((part, index) => (
            <RemovedRow
              key={`${index}-${part.text.slice(0, 12)}`}
              part={part}
              onRestore={() => onFormat(`${t('保留以下内容，不要删除：')}${part.text}`)}
            />
          ))}
        </section>
      ) : hasFormatted ? (
        <section className="format-section">
          <div className="format-section-head">
            <span>{t('这次没有删除正文')}</span>
          </div>
          <p className="format-section-note">{t('AI 只调整了标题、段落、引用或列表的层级。')}</p>
        </section>
      ) : (
        <p className="format-section-note">
          {t('AI 会保留全部正文，只清理广告、推广、重复标题、页码水印和乱码，并整理段落、标题与引用层级。原文不会被修改。')}
        </p>
      )}

      <section className="format-section">
        <div className="format-section-head">
          <span>{t('排版偏好')}</span>
          <span className="muted">{t('字号/段距按书保存')}</span>
        </div>

        <div className="style-row">
          <span className="style-label">{t('字体')}</span>
          <div className="segmented">
            <button
              type="button"
              className={style.fontFamily === 'serif' ? 'active' : ''}
              onClick={() => onStyleChange({ fontFamily: 'serif' })}
            >
              {t('衬线')}
            </button>
            <button
              type="button"
              className={style.fontFamily === 'sans' ? 'active' : ''}
              onClick={() => onStyleChange({ fontFamily: 'sans' })}
            >
              {t('黑体')}
            </button>
          </div>
        </div>

        <div className="style-row">
          <span className="style-label">{t('字号')}</span>
          <input
            type="range"
            min={15}
            max={22}
            step={0.5}
            value={draft.fontSize}
            onChange={(event) => previewStyle({ fontSize: Number(event.target.value) })}
            onPointerUp={flushStyle}
            onKeyUp={flushStyle}
            onBlur={flushStyle}
          />
          <span className="style-value">{draft.fontSize}px</span>
        </div>

        <div className="style-row">
          <span className="style-label">{t('行距')}</span>
          <input
            type="range"
            min={1.5}
            max={2.4}
            step={0.05}
            value={draft.lineHeight}
            onChange={(event) => previewStyle({ lineHeight: Number(event.target.value) })}
            onPointerUp={flushStyle}
            onKeyUp={flushStyle}
            onBlur={flushStyle}
          />
          <span className="style-value">{draft.lineHeight.toFixed(2)}</span>
        </div>

        <div className="style-row">
          <span className="style-label">{t('段距')}</span>
          <input
            type="range"
            min={0.4}
            max={1.8}
            step={0.1}
            value={draft.paragraphSpacing}
            onChange={(event) => previewStyle({ paragraphSpacing: Number(event.target.value) })}
            onPointerUp={flushStyle}
            onKeyUp={flushStyle}
            onBlur={flushStyle}
          />
          <span className="style-value">{draft.paragraphSpacing.toFixed(1)}</span>
        </div>

        <div className="style-row">
          <span className="style-label">{t('版心宽度')}</span>
          <input
            type="range"
            min={560}
            max={960}
            step={20}
            value={draft.maxWidth}
            onChange={(event) => previewStyle({ maxWidth: Number(event.target.value) })}
            onPointerUp={flushStyle}
            onKeyUp={flushStyle}
            onBlur={flushStyle}
          />
          <span className="style-value">{draft.maxWidth}px</span>
        </div>

        <div className="style-row">
          <span className="style-label">{t('缩进')}</span>
          <Checkbox
            className="checkbox-label"
            checked={style.indent}
            onChange={(checked) => onStyleChange({ indent: checked })}
            label={t('首行缩进两字')}
          />
        </div>
      </section>

      <section className="format-section chat-section">
        <div className="format-section-head">
          <span>{t('和 AI 说')}</span>
          <span className="muted">{t('继续调整这一章')}</span>
        </div>

        {messages.length > 0 ? (
          <div className="format-messages" ref={messagesRef}>
            {messages.map((message, index) => (
              <div key={index} className={`format-message ${message.role}`}>
                {message.text}
              </div>
            ))}
          </div>
        ) : (
          <p className="format-section-note">
            {t('例如：「引用改成缩进」「段距再松一点」「标题大一号」「保留刚才删掉的那段」。')}
          </p>
        )}

        <div className="format-input-row">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) send()
            }}
            placeholder={demo ? t('演示模式无法发送 AI 指令') : t('告诉 AI 你想怎么排…')}
            disabled={busy || demo}
          />
          <button type="button" className="primary-button small" onClick={send} disabled={busy || demo || !input.trim()}>
            {t('发送')}
          </button>
        </div>
      </section>
    </div>
  )
}
