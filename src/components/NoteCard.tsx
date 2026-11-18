import { bridge } from '../lib/bridge.js'
import { memo, useEffect, useMemo, useRef, useState, type JSX } from 'react'

import type { Note, NoteKind, NotePatch } from '../../shared/types.js'
import { getLocale, t, useLocale } from '../lib/i18n.js'
import { confirmDialog } from './ConfirmDialog.js'
import { Select } from './Select.js'
import { TextDiffDialog } from './TextDiffDialog.js'
import { titleRepeatsContent } from '../lib/note-display.js'
import { SparkleIcon } from './Icon.js'
import { Markdown } from './Markdown.js'
import { SentenceCheck } from './SentenceCheck.js'

export const KIND_LABEL: Record<NoteKind, string> = {
  condensed: t('读薄稿'),
  summary: t('摘要'),
  claim: t('论点'),
  point: t('知识点'),
  question: t('问题'),
  highlight: t('高亮'),
  thought: t('想法'),
}

const DIVERGENCE_LABEL = {
  boundary: t('边界'),
  crossbook: t('跨书'),
  transfer: t('触类'),
} as const

interface NoteCardProps {
  note: Note
  backlinks: Note[]
  allNotes: Note[]
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
  sentenceCheck?: boolean
  evidenceNotes?: Note[]
  demo?: boolean
}

function colorHex(color: NonNullable<Note['color']>): string {
  return color === 'red' ? '#d65345' : color === 'yellow' ? '#d8a53a' : color === 'green' ? '#4f8a63' : '#4f7fa8'
}

function titleFromContent(content: string): string {
  const first = content
    .replace(/^[#>\-\s]+/, '')
    .split('\n')[0]
    ?.trim()
  return first ? first.slice(0, 26) : t('未命名笔记')
}

function parseTags(value: string): string[] {
  const seen = new Set<string>()
  for (const raw of value.split(/[,，]/)) {
    const tag = raw.trim().replace(/^#/, '').slice(0, 24)
    if (tag) seen.add(tag)
  }
  return [...seen].slice(0, 8)
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (getLocale() === 'en') return `${date.getMonth() + 1}/${date.getDate()}`
  return `${date.getMonth() + 1}${t('月')}${date.getDate()}${t('日')}`
}

function NoteCardImpl({
  note,
  backlinks,
  allNotes,
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
  sentenceCheck = false,
  evidenceNotes,
  demo = false,
}: NoteCardProps): JSX.Element {
  useLocale()
  const [editing, setEditing] = useState(note.author === 'user' && note.content.trim() === '')
  const [draftTitle, setDraftTitle] = useState(note.title)
  const [draftContent, setDraftContent] = useState(note.content)
  const [draftTags, setDraftTags] = useState(note.tags.join('，'))
  const [autoSaved, setAutoSaved] = useState(false)
  const busyRef = useRef(false)
  const closeAfterRef = useRef(false)
  const initialRef = useRef({ title: note.title, content: note.content, tags: note.tags })
  const [previewOpen, setPreviewOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [selection, setSelection] = useState({ start: 0, end: 0, text: '' })
  const [sectionRewrite, setSectionRewrite] = useState<{
    start: number
    end: number
    before: string
    after: string
  } | null>(null)
  const [rewriting, setRewriting] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const repeatsTitle = titleRepeatsContent(note)
  // 链接候选只在编辑时用到；memo 化后按 allNotes 缓存，避免每次父组件渲染都filter 一遍。
  const linkCandidates = useMemo(() => allNotes.filter((candidate) => candidate.id !== note.id), [allNotes, note.id])

  useEffect(() => {
    if (focusKey === 0) return
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    rootRef.current?.classList.add('flash')
    const timer = window.setTimeout(() => rootRef.current?.classList.remove('flash'), 1400)
    if (note.author === 'user' && note.content.trim() === '') beginEdit()
    return () => window.clearTimeout(timer)
  }, [focusKey, note.author, note.content])

  function computedTitle(): string {
    const titleUnchanged = draftTitle.trim() === note.title.trim()
    return titleUnchanged && repeatsTitle
      ? titleFromContent(draftContent)
      : draftTitle.trim() && draftTitle.trim() !== t('未命名笔记')
        ? draftTitle.trim()
        : titleFromContent(draftContent)
  }

  function currentPatch(): NotePatch {
    return { title: computedTitle(), content: draftContent, tags: parseTags(draftTags) }
  }

  function isDirty(): boolean {
    const patch = currentPatch()
    return (
      patch.title !== note.title ||
      patch.content !== note.content ||
      patch.tags!.join('\u0000') !== note.tags.join('\u0000')
    )
  }

  function beginEdit(): void {
    initialRef.current = { title: note.title, content: note.content, tags: note.tags }
    setDraftTitle(note.title)
    setDraftContent(note.content)
    setDraftTags(note.tags.join('，'))
    setPreviewOpen(false)
    setSaveError(null)
    setAutoSaved(false)
    setEditing(true)
  }

  async function persist(close: boolean): Promise<void> {
    if (busyRef.current) {
      if (close) closeAfterRef.current = true
      return
    }
    busyRef.current = true
    closeAfterRef.current = close
    setSaving(true)
    setSaveError(null)
    let ok = true
    try {
      await onUpdate(note.id, currentPatch())
    } catch (error) {
      ok = false
      closeAfterRef.current = false
      // 保存失败不能悄悄把编辑框关掉，用户会以为已经存上了。
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      busyRef.current = false
      setSaving(false)
      if (ok) setAutoSaved(true)
      if (ok && closeAfterRef.current) {
        setEditing(false)
        setPreviewOpen(false)
        setAutoSaved(false)
      }
      closeAfterRef.current = false
    }
  }

  useEffect(() => {
    if (!editing || !isDirty()) return
    if (!draftContent.trim() && !draftTitle.trim()) return
    const timer = window.setTimeout(() => void persist(false), 1200)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draftTitle, draftContent, draftTags, note.title, note.content, note.tags])

  async function cancel(): Promise<void> {
    const initial = initialRef.current
    const startedEmpty = !initial.content.trim() && !initial.title.trim()
    if (startedEmpty && note.author === 'user') {
      setEditing(false)
      setPreviewOpen(false)
      void onDelete(note.id)
      return
    }
    const patch = currentPatch()
    const changed =
      patch.title !== initial.title ||
      patch.content !== initial.content ||
      patch.tags!.join('\u0000') !== initial.tags.join('\u0000')
    setEditing(false)
    setPreviewOpen(false)
    setAutoSaved(false)
    setDraftTitle(initial.title)
    setDraftContent(initial.content)
    setDraftTags(initial.tags.join('，'))
    if (changed) {
      try {
        await onUpdate(note.id, { title: initial.title, content: initial.content, tags: initial.tags })
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : String(error))
      }
    }
  }

  async function rewriteSelection(): Promise<void> {
    if (selection.text.trim().length < 20) {
      setSaveError(t('先选中一段文字再重写。'))
      return
    }
    setRewriting(true)
    setSaveError(null)
    try {
      const rewritten = await bridge.rewriteComposeSection({
        bookId: note.bookId,
        fullText: draftContent,
        start: selection.start,
        end: selection.end,
      })
      if (rewritten.demo && rewritten.text.trim() === selection.text.trim()) return
      setSectionRewrite({
        start: selection.start,
        end: selection.end,
        before: draftContent.slice(selection.start, selection.end),
        after: rewritten.text,
      })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setRewriting(false)
    }
  }

  function applySectionRewrite(): void {
    if (!sectionRewrite) return
    setDraftContent(
      `${draftContent.slice(0, sectionRewrite.start)}${sectionRewrite.after}${draftContent.slice(sectionRewrite.end)}`,
    )
    setSectionRewrite(null)
    setSelection({ start: 0, end: 0, text: '' })
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
    <>
      <article
        className={`note-card kind-${note.kind}`}
        ref={rootRef}
        style={note.color ? { borderLeftColor: colorHex(note.color) } : undefined}
      >
      <div className="note-head">
        <span className={`kind-badge kind-${note.kind}`}>{t(KIND_LABEL[note.kind])}</span>
        {note.color ? (
          <span
            className="note-color-dot"
            title={t('笔记颜色')}
            style={{
              background:
                note.color === 'red' ? '#d65345' : note.color === 'yellow' ? '#d8a53a' : note.color === 'green' ? '#4f8a63' : '#4f7fa8',
            }}
          />
        ) : null}
        <span className={`author-badge ${note.author}`}>
          {note.author === 'ai' ? (note.edited ? `AI · ${t('已改')}` : 'AI') : t('我')}
        </span>
        {note.importance != null && note.importance >= 4 ? (
          <span className="importance-badge">{t('核心')}</span>
        ) : null}
        <span className="note-time">{formatTime(note.updatedAt)}</span>
        <div className="note-actions">
          {editing ? (
            <>
              <button type="button" className="text-button" onClick={() => void persist(true)} disabled={saving}>
                {saving ? t('保存中…') : t('完成')}
              </button>
              <button type="button" className="text-button muted" onClick={() => void cancel()}>
                {t('取消')}
              </button>
            </>
          ) : (
            <>
              {onShare ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onShare(note)}
                  disabled={demo}
                  title={demo ? t('演示结果不能分享为真实内容') : undefined}
                >
                  {t('分享')}
                </button>
              ) : null}
              <button
                type="button"
                className="text-button"
                aria-expanded={colorOpen}
                onClick={() => setColorOpen((value) => !value)}
              >
                {t('颜色')}
              </button>
              <button type="button" className="text-button" onClick={beginEdit}>
                {t('编辑')}
              </button>
              <button
                type="button"
                className="text-button danger"
                onClick={() => {
                  void confirmDialog({
                    title: t('删除笔记'),
                    message: t('删除这条笔记？删除后可以在提示条里撤销。'),
                    confirmLabel: t('删除'),
                    danger: true,
                  }).then((confirmed) => {
                    if (confirmed) void onDelete(note.id)
                  })
                }}
              >
                {t('删除')}
              </button>
            </>
          )}
        </div>
      </div>

      {note.section ? <div className="note-section">{note.section}</div> : null}

      {colorOpen && !editing ? (
        <div className="note-color-picker" aria-label={t('笔记颜色')}>
          {([
            ['red', '#d65345'],
            ['yellow', '#d8a53a'],
            ['green', '#4f8a63'],
            ['blue', '#4f7fa8'],
          ] as const).map(([color, hex]) => (
            <button
              key={color}
              type="button"
              className={note.color === color ? 'active' : ''}
              aria-label={color}
              title={color}
              style={{ background: hex }}
              onClick={() => {
                void onUpdate(note.id, { color })
                setColorOpen(false)
              }}
            />
          ))}
          <button
            type="button"
            className="note-color-clear"
            onClick={() => {
              void onUpdate(note.id, { color: null })
              setColorOpen(false)
            }}
          >
            {t('清除颜色')}
          </button>
        </div>
      ) : null}

      {editing ? (
        <div className="note-editor">
          {saveError ? (
            <div className="inline-error" role="alert">
              {t('保存失败')}：{saveError}
            </div>
          ) : null}
          <input
            className="note-title-input"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder={t('笔记标题')}
          />
          <input
            className="note-tags-input"
            value={draftTags}
            onChange={(event) => setDraftTags(event.target.value)}
            placeholder={t('标签，用逗号分隔（最多 8 个）')}
            aria-label={t('标签')}
          />
          <div className="note-color-picker" aria-label={t('笔记颜色')}>
            {([
              ['red', '#d65345'],
              ['yellow', '#d8a53a'],
              ['green', '#4f8a63'],
              ['blue', '#4f7fa8'],
            ] as const).map(([color, hex]) => (
              <button
                key={color}
                type="button"
                className={note.color === color ? 'active' : ''}
                aria-label={color}
                title={color}
                style={{ background: hex }}
                onClick={() => void onUpdate(note.id, { color })}
              />
            ))}
            <button type="button" className="note-color-clear" onClick={() => void onUpdate(note.id, { color: null })}>
              {t('清除颜色')}
            </button>
          </div>
          <textarea
            className="note-textarea"
            value={draftContent}
            onChange={(event) => setDraftContent(event.target.value)}
            onSelect={(event) => {
              const target = event.currentTarget
              const start = target.selectionStart ?? 0
              const end = target.selectionEnd ?? 0
              setSelection({ start, end, text: target.value.slice(start, end) })
            }}
            placeholder={t('写下你的想法，或用 [[另一条笔记的标题]] 建立联系…')}
            rows={5}
            autoFocus={note.content.trim() === ''}
          />
          <div className="note-editor-tools">
            <button type="button" className="text-button" onClick={insertMermaid}>
              {t('插入 Mermaid')}
            </button>
            {selection.text.trim().length >= 20 ? (
              <button type="button" className="text-button" onClick={() => void rewriteSelection()} disabled={rewriting}>
                {rewriting ? t('正在重写…') : t('重写选中')}
              </button>
            ) : null}
            <button type="button" className="text-button" onClick={() => setPreviewOpen((value) => !value)}>
              {previewOpen ? t('隐藏预览') : t('预览 Markdown')}
            </button>
            <span className="note-save-hint" role="status">
              {saving ? t('正在保存…') : autoSaved ? t('已自动保存') : ''}
            </span>
            {linkCandidates.length > 0 ? (
              <Select
                className="link-select"
                value=""
                onChange={(value) => {
                  if (value) insertLink(value)
                }}
                placeholder={t('插入笔记链接…')}
                ariaLabel={t('插入笔记链接')}
                options={linkCandidates.map((candidate) => ({ value: candidate.title, label: candidate.title }))}
              />
            ) : null}
          </div>
          {previewOpen ? (
            <div className="note-editor-preview" aria-label={t('笔记预览')}>
              <Markdown text={draftContent} onWikiLink={onWikiLink} />
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {hideTitle || repeatsTitle ? null : <h3 className="note-title">{note.title}</h3>}
          {note.content.trim() ? (
            <div className={repeatsTitle ? 'note-statement' : undefined}>
              {sentenceCheck && note.kind === 'condensed' ? (
                <SentenceCheck
                  content={note.content}
                  evidenceNotes={evidenceNotes ?? allNotes}
                  onJumpQuote={onJumpQuote}
                />
              ) : (
                <Markdown text={note.content} onWikiLink={onWikiLink} />
              )}
            </div>
          ) : (
            <p className="note-empty">{t('（空笔记，点“编辑”补充）')}</p>
          )}
        </>
      )}

      {note.role ? (
        <div className="note-role">
          <span>{t('在文中的作用')}</span> · {note.role}
        </div>
      ) : null}

      {note.quote ? (
        <button type="button" className="note-quote" onClick={() => onJumpQuote(note.quote!)} title={t('回到原文')}>
          <span className="quote-label">{note.kind === 'point' || note.kind === 'claim' ? t('原文依据') : t('原文')}</span>
          <span className="quote-text">“{note.quote}”</span>
          {note.author === 'ai' ? (
            <span className={`verify-chip ${demo ? 'warn' : note.quoteVerified ? 'ok' : 'warn'}`}>
              {demo
                ? t('演示样例')
                : note.quoteVerified
                  ? t('已核对')
                  : note.kind === 'point' || note.kind === 'claim'
                    ? t('位置/概述')
                    : t('未核对')}
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
            {t('AI 延伸')}<span>{t('非作者原文')}</span>
          </div>
          {note.divergences.map((divergence, index) => (
            <p key={`${divergence.type}-${index}`} className={`divergence type-${divergence.type}`}>
              <strong>{t(DIVERGENCE_LABEL[divergence.type])}</strong>
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
          {expanding ? t('正在延伸…') : <><SparkleIcon /> {t('延伸此笔记')}</>}
        </button>
      ) : null}

      {backlinks.length > 0 ? (
        <div className="backlinks">
          <span className="backlinks-label">{t('被引用')}</span>
          {backlinks.map((linked) => (
            <button key={linked.id} type="button" className="backlink" onClick={() => onOpenNote(linked)}>
              {linked.title}
            </button>
          ))}
        </div>
      ) : null}
    </article>
      {sectionRewrite ? (
        <TextDiffDialog
          title={t('按段重写对比')}
          before={sectionRewrite.before}
          after={sectionRewrite.after}
          applyLabel={t('应用改写')}
          onApply={applySectionRewrite}
          onClose={() => setSectionRewrite(null)}
        />
      ) : null}
    </>
  )
}

export const NoteCard = memo(NoteCardImpl)
