import { useEffect, useRef, useState, type JSX } from 'react'

import type { ChapterContent, ReaderStyle, RemovedPart } from '../../shared/types.js'

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
  return (
    <div className="removed-row">
      <div className="removed-head">
        <span className="removed-reason">{part.reason}</span>
        <span className={`verify-chip ${part.verified ? 'ok' : 'warn'}`}>
          {part.verified ? '已核对' : '未核对'}
        </span>
        <button type="button" className="text-button" onClick={onRestore}>
          保留
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
  const [input, setInput] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = messagesRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, note])

  if (!chapter) {
    return (
      <div className="format-panel">
        <div className="format-empty">选择一章后，可以在这里让 AI 整理正文排版。</div>
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
          <h2>AI 排版</h2>
          <p>{chapter.title}</p>
        </div>
        {hasFormatted ? (
          <button type="button" className="text-button muted" onClick={onReset}>
            还原原文
          </button>
        ) : null}
      </div>

      {demo ? (
        <div className="format-hint">
          演示模式不支持 AI 排版。样式滑杆仍然可用；要让 AI 清理无关内容，请先在设置里配置真实模型。
        </div>
      ) : null}

      <button
        type="button"
        className="primary-button format-run"
        onClick={() => onFormat()}
        disabled={busy || demo}
      >
        {busy ? 'AI 正在整理这一章…' : hasFormatted ? '✦ 重新整理这一章' : '✦ 整理这一章'}
      </button>

      {error ? <div className="inline-error">{error}</div> : null}

      {busy ? (
        <div className="streaming-card format-streaming">
          <div className="streaming-head">
            <span className="spinner" />
            <span>正在清理广告、重复标题，并调整段落与标题层级…</span>
          </div>
        </div>
      ) : null}

      {note ? <div className="format-note">{note}</div> : null}

      {removed.length > 0 ? (
        <section className="format-section">
          <div className="format-section-head">
            <span>本次移除 {removed.length} 处</span>
            <span className="muted">原文未修改，可逐条保留</span>
          </div>
          {removed.map((part, index) => (
            <RemovedRow
              key={`${index}-${part.text.slice(0, 12)}`}
              part={part}
              onRestore={() => onFormat(`保留以下内容，不要删除：${part.text}`)}
            />
          ))}
        </section>
      ) : hasFormatted ? (
        <section className="format-section">
          <div className="format-section-head">
            <span>这次没有删除正文</span>
          </div>
          <p className="format-section-note">AI 只调整了标题、段落、引用或列表的层级。</p>
        </section>
      ) : (
        <p className="format-section-note">
          AI 会保留全部正文，只清理广告、推广、重复标题、页码水印和乱码，并整理段落、标题与引用层级。原文不会被修改。
        </p>
      )}

      <section className="format-section">
        <div className="format-section-head">
          <span>排版偏好</span>
          <span className="muted">字号/段距按书保存</span>
        </div>

        <div className="style-row">
          <span className="style-label">字体</span>
          <div className="segmented">
            <button
              type="button"
              className={style.fontFamily === 'serif' ? 'active' : ''}
              onClick={() => onStyleChange({ fontFamily: 'serif' })}
            >
              衬线
            </button>
            <button
              type="button"
              className={style.fontFamily === 'sans' ? 'active' : ''}
              onClick={() => onStyleChange({ fontFamily: 'sans' })}
            >
              黑体
            </button>
          </div>
        </div>

        <div className="style-row">
          <span className="style-label">字号</span>
          <input
            type="range"
            min={15}
            max={22}
            step={0.5}
            value={style.fontSize}
            onChange={(event) => onStyleChange({ fontSize: Number(event.target.value) })}
          />
          <span className="style-value">{style.fontSize}px</span>
        </div>

        <div className="style-row">
          <span className="style-label">行距</span>
          <input
            type="range"
            min={1.5}
            max={2.4}
            step={0.05}
            value={style.lineHeight}
            onChange={(event) => onStyleChange({ lineHeight: Number(event.target.value) })}
          />
          <span className="style-value">{style.lineHeight.toFixed(2)}</span>
        </div>

        <div className="style-row">
          <span className="style-label">段距</span>
          <input
            type="range"
            min={0.4}
            max={1.8}
            step={0.1}
            value={style.paragraphSpacing}
            onChange={(event) => onStyleChange({ paragraphSpacing: Number(event.target.value) })}
          />
          <span className="style-value">{style.paragraphSpacing.toFixed(1)}</span>
        </div>

        <div className="style-row">
          <span className="style-label">缩进</span>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={style.indent}
              onChange={(event) => onStyleChange({ indent: event.target.checked })}
            />
            首行缩进两字
          </label>
        </div>
      </section>

      <section className="format-section chat-section">
        <div className="format-section-head">
          <span>和 AI 说</span>
          <span className="muted">继续调整这一章</span>
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
            例如：「引用改成缩进」「段距再松一点」「标题大一号」「保留刚才删掉的那段」。
          </p>
        )}

        <div className="format-input-row">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) send()
            }}
            placeholder={demo ? '演示模式无法发送 AI 指令' : '告诉 AI 你想怎么排…'}
            disabled={busy || demo}
          />
          <button type="button" className="primary-button small" onClick={send} disabled={busy || demo || !input.trim()}>
            发送
          </button>
        </div>
      </section>
    </div>
  )
}
