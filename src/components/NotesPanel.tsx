import { useEffect, useState, type JSX } from 'react'
import type { ChapterContent, GeneratePartial, Note, NoteDraft, NotePatch, NoteReport, RelatedNote } from '../../shared/types.js'
import { buildChapterMarkdown, markdownFilename, todayStamp } from '../lib/export.js'
import { noteBacklinks, relatedNotes, snippet } from '../lib/links.js'
import { NoteCard } from './NoteCard.js'

interface NotesPanelProps {
  chapter: ChapterContent | null
  bookTitle: string
  author: string
  notes: Note[]
  allNotes: Note[]
  chapterTitles: Record<string, string>
  generating: boolean
  partial: GeneratePartial | null
  error: string | null
  report: NoteReport | null
  crossBookNotes: RelatedNote[]
  focusNoteId: string | null
  focusKey: number
  expandingNoteId: string | null
  onGenerate(): void
  onCancel(): void
  onCreate(draft: NoteDraft): Promise<Note>
  onUpdate(id: string, patch: NotePatch): Promise<void>
  onDelete(id: string): Promise<void>
  onExpand(id: string): void
  onJumpQuote(quote: string): void
  onOpenNote(note: Note): void
  onOpenRelated(note: RelatedNote): void
  onListen(text: string): void
}

function StreamingCard({ partial, onCancel }: { partial: GeneratePartial | null; onCancel(): void }): JSX.Element {
  const progress = partial?.progress
  const phaseLabel =
    progress?.phase === 'condense'
      ? '正在把这一章读薄'
      : progress?.phase === 'cards'
        ? '正在提炼核心卡片'
        : progress?.phase === 'expand'
          ? '正在生成发散'
          : 'AI 正在读这一章'
  const progressDetail = progress
    ? progress.phase === 'condense'
      ? `${progress.done}/${progress.total} 节 · 保留全部观点做压缩`
      : progress.phase === 'cards'
        ? `已提炼 ${progress.cards} 张核心卡片`
        : `${progress.done}/${progress.total} 张卡片 · 共 ${progress.cards} 张`
    : null
  return (
    <div className="streaming-card">
      <div className="streaming-head">
        <span className="spinner" />
        <span>{phaseLabel}…</span>
        <button type="button" className="text-button muted" onClick={onCancel}>
          取消
        </button>
      </div>
      {progress ? (
        <div className="streaming-progress">
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
            />
          </div>
          <p>{progressDetail}</p>
        </div>
      ) : (
        <p className="streaming-hint">正在拆解本章的论证结构…</p>
      )}
      {partial?.summary ? <p className="streaming-summary">{partial.summary}</p> : null}
      {partial?.claims && partial.claims.length > 0 ? (
        <ul className="streaming-claims">
          {partial.claims.map((claim, index) => (
            <li key={index}>
              {claim.claim ? <strong>{claim.claim}</strong> : <span className="streaming-hint">…</span>}
              {claim.quote ? <em>“{claim.quote}”</em> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {partial?.questions && partial.questions.length > 0 ? (
        <ul className="streaming-questions">
          {partial.questions.map((question, index) => (
            <li key={index}>{question}</li>
          ))}
        </ul>
      ) : null}
      {partial?.concepts && partial.concepts.length > 0 ? (
        <div className="tag-row">
          {partial.concepts.map((concept, index) => (
            <span key={`${concept}-${index}`} className="tag">
              {concept}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function NotesPanel({
  chapter,
  bookTitle,
  author,
  notes,
  allNotes,
  chapterTitles,
  generating,
  partial,
  error,
  report,
  crossBookNotes,
  focusNoteId,
  focusKey,
  expandingNoteId,
  onGenerate,
  onCancel,
  onCreate,
  onUpdate,
  onDelete,
  onExpand,
  onJumpQuote,
  onOpenNote,
  onOpenRelated,
  onListen,
}: NotesPanelProps): JSX.Element {
  const condensedNote = notes.find((note) => note.kind === 'condensed') ?? null
  const summaryNotes = notes.filter((note) => note.kind === 'summary')
  const pointNotes = notes.filter((note) => note.kind === 'point' || note.kind === 'claim')
  const questionNotes = notes.filter((note) => note.kind === 'question')
  const mineNotes = notes.filter((note) => note.kind === 'highlight' || note.kind === 'thought')
  const related = relatedNotes(chapter?.id ?? null, notes, allNotes)
  const [includeCards, setIncludeCards] = useState(false)
  const [exportState, setExportState] = useState<'idle' | 'copied' | 'saved'>('idle')
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    setExportState('idle')
    setExportError(null)
  }, [chapter?.id])

  function markdown(): string {
    if (!condensedNote) return ''
    return buildChapterMarkdown({
      bookTitle,
      author,
      chapterTitle: chapter?.title ?? '',
      date: todayStamp(),
      condensed: condensedNote,
      cards: pointNotes,
      includeCards,
    })
  }

  async function copyDraft(): Promise<void> {
    if (!condensedNote) return
    setExportError(null)
    try {
      await window.api.copyText(markdown())
      setExportState('copied')
      window.setTimeout(() => setExportState('idle'), 1800)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    }
  }

  async function exportDraft(): Promise<void> {
    if (!condensedNote) return
    setExportError(null)
    try {
      const result = await window.api.saveMarkdown(
        markdownFilename(bookTitle, chapter?.title ?? ''),
        markdown(),
      )
      if (result.saved) {
        setExportState('saved')
        window.setTimeout(() => setExportState('idle'), 1800)
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    }
  }

  function renderCard(note: Note, hideTitle = false): JSX.Element {
    return (
      <NoteCard
        key={note.id}
        note={note}
        hideTitle={hideTitle}
        backlinks={noteBacklinks(note, allNotes)}
        linkCandidates={allNotes.filter((candidate) => candidate.id !== note.id)}
        focusKey={focusNoteId === note.id ? focusKey : 0}
        expanding={expandingNoteId === note.id}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onExpand={onExpand}
        onJumpQuote={onJumpQuote}
        onOpenNote={onOpenNote}
        onWikiLink={(title) => {
          const target = allNotes.find((candidate) => candidate.title === title)
          if (target) onOpenNote(target)
        }}
      />
    )
  }

  function renderGroup(label: string, group: Note[]): JSX.Element | null {
    if (group.length === 0) return null
    return (
      <section className="note-group">
        <div className="note-group-head">
          <span>{label}</span>
          <span className="muted">{group.length}</span>
        </div>
        {group.map((note) => renderCard(note))}
      </section>
    )
  }

  async function addNote(): Promise<void> {
    if (!chapter) return
    await onCreate({
      bookId: chapter.bookId,
      chapterId: chapter.id,
      kind: 'thought',
      content: '',
    })
  }

  return (
    <div className="notes-panel">
      <div className="notes-head">
        <div>
          <h2>本章笔记</h2>
          <p>{chapter ? chapter.title : '选择一章开始'}</p>
        </div>
        {generating ? (
          <button type="button" className="ghost-button small" onClick={onCancel}>
            取消生成
          </button>
        ) : (
          <button type="button" className="primary-button small" onClick={onGenerate} disabled={!chapter}>
            ✦ 读薄并提炼
          </button>
        )}
      </div>


      <p className="condense-hint">
        AI 会把这一章重写成可直接发博客的读薄稿：只保留断言，并列改列表，删掉铺垫；压缩幅度由内容密度决定，保留断言优先。
      </p>

      {error ? <div className="inline-error">{error}</div> : null}

      {generating ? <StreamingCard partial={partial} onCancel={onCancel} /> : null}

      {report && report.originalChars > 0 ? (
        <div className="condense-card">
          <div className="condense-head">
            <span>读薄</span>
            <span>
              {report.originalChars.toLocaleString()} → {report.condensedChars.toLocaleString()} 字 ·{' '}
              {report.ratio > 0 ? `1/${report.ratio.toFixed(1)}` : '—'}
            </span>
          </div>
          <div
            className="condense-ratio-bar"
            title={`读薄稿约为原文的 ${Math.round((report.condensedChars / Math.max(1, report.originalChars)) * 100)}%`}
          >
            <span
              style={{
                width: `${Math.max(3, Math.min(100, (report.condensedChars / Math.max(1, report.originalChars)) * 100))}%`,
              }}
            />
          </div>
          <div className="condense-meta">
            {report.sections} 节 · {report.cards} 张核心卡片 · {report.divergences} 条延伸
            {report.fidelityMissing > 0 ? ` · 审计补遗 ${report.fidelityMissing} 条` : ''}
            {report.omitted > 0 ? ` · 未采纳 ${report.omitted} 处` : ''}
            {report.durationMs > 0
              ? ` · 用时 ${report.durationMs < 10000 ? (report.durationMs / 1000).toFixed(1) : Math.round(report.durationMs / 1000)}s`
              : ''}
          </div>
          {report.omittedItems && report.omittedItems.length > 0 ? (
            <details className="omitted-details">
              <summary>查看未采纳的 {report.omittedItems.length} 处原文</summary>
              <ul>
                {report.omittedItems.map((item, index) => (
                  <li key={index}>
                    <span>{item.text}</span>
                    {item.reason ? <em>{item.reason}</em> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {!generating && notes.length === 0 ? (
        <div className="notes-empty">
          <p className="notes-empty-title">这一章还没有读薄稿</p>
          <p>AI 会先把这一章重写成可发博客的读薄稿（只保留断言、并列改列表，压缩幅度由内容密度决定），再从稿子里用「不知道它是否影响全文理解」的标准提炼 5–25 张核心卡片，最后做最多 3 条延伸。</p>
          <div className="notes-empty-actions">
            <button type="button" className="primary-button" onClick={onGenerate}>
              ✦ 读薄并提炼
            </button>
            <button type="button" className="ghost-button" onClick={() => void addNote()}>
              自己写一条
            </button>
          </div>
        </div>
      ) : null}

      {condensedNote ? (
        <section className="condensed-section">
          <div className="note-group-head">
            <span>读薄稿</span>
            <div className="condensed-tools">
              {report && report.ratio > 0 ? <span className="muted">约 1/{report.ratio.toFixed(1)}</span> : null}
              <label className="export-check">
                <input type="checkbox" checked={includeCards} onChange={(event) => setIncludeCards(event.target.checked)} />
                附卡片
              </label>
              <button type="button" className="text-button" onClick={() => onListen(condensedNote.content)}>
                朗读
              </button>
              <button type="button" className="text-button" onClick={() => void copyDraft()}>
                {exportState === 'copied' ? '已复制' : '复制'}
              </button>
              <button type="button" className="text-button" onClick={() => void exportDraft()}>
                {exportState === 'saved' ? '已导出' : '导出 .md'}
              </button>
            </div>
          </div>
          {exportError ? <div className="inline-error">{exportError}</div> : null}
          {renderCard(condensedNote, true)}
        </section>
      ) : null}

      {renderGroup('摘要', summaryNotes)}
      {renderGroup('核心知识点', pointNotes)}
      {renderGroup('问题', questionNotes)}
      {renderGroup('我的笔记', mineNotes)}

      {!generating && notes.length > 0 ? (
        <button type="button" className="add-note-button" onClick={() => void addNote()}>
          ＋ 添加一条自己的笔记
        </button>
      ) : null}

      {related.length > 0 ? (
        <section className="related-section">
          <div className="note-group-head">
            <span>这本书里的相关笔记</span>
            <span className="muted">{related.length}</span>
          </div>
          {related.map((note) => (
            <button key={note.id} type="button" className="related-card" onClick={() => onOpenNote(note)}>
              <span className="related-chapter">{note.chapterId ? (chapterTitles[note.chapterId] ?? '其他章节') : '其他章节'}</span>
              <span className="related-title">{note.title}</span>
              <span className="related-snippet">{snippet(note.content)}</span>
              {note.tags.length > 0 ? (
                <span className="tag-row">
                  {note.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
          ))}
        </section>
      ) : null}

      {crossBookNotes.length > 0 ? (
        <section className="related-section crossbook-section">
          <div className="note-group-head">
            <span>其他书里的相关笔记</span>
            <span className="muted">{crossBookNotes.length}</span>
          </div>
          {crossBookNotes.map((note) => (
            <button key={note.id} type="button" className="related-card" onClick={() => onOpenRelated(note)}>
              <span className="related-chapter">
                {note.bookTitle}
                {note.chapterTitle ? ` · ${note.chapterTitle}` : ''}
              </span>
              <span className="related-title">{note.title}</span>
              <span className="related-snippet">{snippet(note.content)}</span>
            </button>
          ))}
        </section>
      ) : null}
    </div>
  )
}
