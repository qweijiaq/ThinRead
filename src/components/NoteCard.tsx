import { useEffect, useRef, useState, type JSX } from 'react'

import type { Note, NoteKind, NotePatch } from '../../shared/types.js'
import { confirmDialog } from './ConfirmDialog.js'
import { Select } from './Select.js'
import { titleRepeatsContent } from '../lib/note-display.js'
import { Markdown } from './Markdown.js'

export const KIND_LABEL: Record<NoteKind, string> = {
  condensed: '读薄稿',
  summary: '摘要',
  claim: '论点',
  point: '知识点',
  question: '问题',
  highlight: '高亮',
  thought: '想法',
}

const DIVERGENCE_LABEL = {
  boundary: '边界',
  crossbook: '跨书',
  transfer: '触类',
} as const

interface NoteCardProps {
  note: Note
  backlinks: Note[]
  linkCandidates: Note[]
  focusKey: number
  expanding: boolean
  onUpdate(id: string, patch: NotePatch): Promise<void>
  onDelete(id: string): Promise<void>
  onShare?(note: Note): void
  onExpand(id: string): void
  onJumpQuote(quote: string): void
  onOpenNote(note: Note): void
  onWikiLink(title: string): void
  hideTitle?: boolean
}

function titleFromContent(content: string): string {
  const first = content
    .replace(/^[#>\-\s]+/, '')
    .split('\n')[0]
    ?.trim()
  return first ? first.slice(0, 26) : '未命名笔记'
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export function NoteCard({
  note,
  backlinks,
  linkCandidates,
  focusKey,
  expanding,
  onUpdate,
  onDelete,
  onShare,
  onExpand,
  onJumpQuote,
  onOpenNote,
  onWikiLink,
  hideTitle = false,
}: NoteCardProps): JSX.Element {
  const [editing, setEditing] = useState(note.author === 'user' && note.content.trim() === '')
  const [draftTitle, setDraftTitle] = useState(note.title)
  const [draftContent, setDraftContent] = useState(note.content)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const repeatsTitle = titleRepeatsContent(note)

  useEffect(() => {
    if (focusKey === 0) return
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    rootRef.current?.classList.add('flash')
    const timer = window.setTimeout(() => rootRef.current?.classList.remove('flash'), 1400)
    if (note.author === 'user' && note.content.trim() === '') setEditing(true)
    return () => window.clearTimeout(timer)
  }, [focusKey, note.author, note.content])

  async function save(): Promise<void> {
    const titleUnchanged = draftTitle.trim() === note.title.trim()
    const title =
      titleUnchanged && repeatsTitle
        ? titleFromContent(draftContent)
        : draftTitle.trim() && draftTitle.trim() !== '未命名笔记'
          ? draftTitle.trim()
          : titleFromContent(draftContent)
    setSaving(true)
    try {
      await onUpdate(note.id, { title, content: draftContent })
      setEditing(false)
      setPreviewOpen(false)
    } finally {
      setSaving(false)
    }
  }

  function cancel(): void {
    if (!note.content.trim() && note.author === 'user') {
      void onDelete(note.id)
      return
    }
    setDraftTitle(note.title)
    setDraftContent(note.content)
    setPreviewOpen(false)
    setEditing(false)
  }

  function insertLink(title: string): void {
    if (!title) return
    setDraftContent((current) => `${current}${current && !current.endsWith('\n') ? '\n' : ''}[[${title}]]`)
  }

  function insertMermaid(): void {
    const template = '```mermaid\nflowchart LR\n  A[观点] --> B[依据]\n  B --> C[结论]\n```\n'
    setDraftContent((current) => `${current}${current && !current.endsWith('\n') ? '\n' : ''}${template}`)
    setPreviewOpen(true)
  }

  return (
    <article className={`note-card kind-${note.kind}`} ref={rootRef}>
      <div className="note-head">
        <span className={`kind-badge kind-${note.kind}`}>{KIND_LABEL[note.kind]}</span>
        <span className={`author-badge ${note.author}`}>
          {note.author === 'ai' ? (note.edited ? 'AI · 已改' : 'AI') : '我'}
        </span>
        {note.importance != null && note.importance >= 4 ? (
          <span className="importance-badge">核心</span>
        ) : null}
        <span className="note-time">{formatTime(note.updatedAt)}</span>
        <div className="note-actions">
          {editing ? (
            <>
              <button type="button" className="text-button" onClick={() => void save()} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
              <button type="button" className="text-button muted" onClick={cancel}>
                取消
              </button>
            </>
          ) : (
            <>
              {onShare ? (
                <button type="button" className="text-button" onClick={() => onShare(note)}>
                  分享
                </button>
              ) : null}
              <button type="button" className="text-button" onClick={() => setEditing(true)}>
                编辑
              </button>
              <button
                type="button"
                className="text-button danger"
                onClick={() => {
                  void confirmDialog({
                    title: '删除笔记',
                    message: '删除这条笔记？删除后可以在提示条里撤销。',
                    confirmLabel: '删除',
                    danger: true,
                  }).then((confirmed) => {
                    if (confirmed) void onDelete(note.id)
                  })
                }}
              >
                删除
              </button>
            </>
          )}
        </div>
      </div>

      {note.section ? <div className="note-section">{note.section}</div> : null}

      {editing ? (
        <div className="note-editor">
          <input
            className="note-title-input"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder="笔记标题"
          />
          <textarea
            className="note-textarea"
            value={draftContent}
            onChange={(event) => setDraftContent(event.target.value)}
            placeholder="写下你的想法，或用 [[另一条笔记的标题]] 建立联系…"
            rows={5}
            autoFocus={note.content.trim() === ''}
          />
          <div className="note-editor-tools">
            <button type="button" className="text-button" onClick={insertMermaid}>
              插入 Mermaid
            </button>
            <button type="button" className="text-button" onClick={() => setPreviewOpen((value) => !value)}>
              {previewOpen ? '隐藏预览' : '预览 Markdown'}
            </button>
            {linkCandidates.length > 0 ? (
              <Select
                className="link-select"
                value=""
                onChange={(value) => {
                  if (value) insertLink(value)
                }}
                placeholder="插入笔记链接…"
                ariaLabel="插入笔记链接"
                options={linkCandidates.map((candidate) => ({ value: candidate.title, label: candidate.title }))}
              />
            ) : null}
          </div>
          {previewOpen ? (
            <div className="note-editor-preview" aria-label="笔记预览">
              <Markdown text={draftContent} onWikiLink={onWikiLink} />
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {hideTitle || repeatsTitle ? null : <h3 className="note-title">{note.title}</h3>}
          {note.content.trim() ? (
            <div className={repeatsTitle ? 'note-statement' : undefined}>
              <Markdown text={note.content} onWikiLink={onWikiLink} />
            </div>
          ) : (
            <p className="note-empty">（空笔记，点“编辑”补充）</p>
          )}
        </>
      )}

      {note.role ? (
        <div className="note-role">
          <span>在文中的作用</span>
          {note.role}
        </div>
      ) : null}

      {note.quote ? (
        <button type="button" className="note-quote" onClick={() => onJumpQuote(note.quote!)} title="回到原文">
          <span className="quote-label">{note.kind === 'point' || note.kind === 'claim' ? '原文依据' : '原文'}</span>
          <span className="quote-text">“{note.quote}”</span>
          {note.author === 'ai' ? (
            <span className={`verify-chip ${note.quoteVerified ? 'ok' : 'warn'}`}>
              {note.quoteVerified
                ? '已核对'
                : note.kind === 'point' || note.kind === 'claim'
                  ? '位置/概述'
                  : '未核对'}
            </span>
          ) : null}
        </button>
      ) : null}

      {note.tags.length > 0 ? (
        <div className="tag-row">
          {note.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {note.divergences.length > 0 ? (
        <div className="note-divergences">
          <div className="divergence-title">
            AI 延伸<span>非作者原文</span>
          </div>
          {note.divergences.map((divergence, index) => (
            <p key={`${divergence.type}-${index}`} className={`divergence type-${divergence.type}`}>
              <strong>{DIVERGENCE_LABEL[divergence.type]}</strong>
              <span>{divergence.text}</span>
            </p>
          ))}
        </div>
      ) : note.author === 'ai' && (note.kind === 'point' || note.kind === 'claim') ? (
        <button
          type="button"
          className="expansion-trigger"
          onClick={() => onExpand(note.id)}
          disabled={expanding}
        >
          {expanding ? '正在延伸…' : '✦ 延伸'}
        </button>
      ) : null}

      {backlinks.length > 0 ? (
        <div className="backlinks">
          <span className="backlinks-label">被引用</span>
          {backlinks.map((linked) => (
            <button key={linked.id} type="button" className="backlink" onClick={() => onOpenNote(linked)}>
              {linked.title}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  )
}
