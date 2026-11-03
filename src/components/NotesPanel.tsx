import { memo, useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { ChapterContent, GeneratePartial, GenerationMode, Note, NoteDraft, NotePatch, NoteReport, ReaderMark, RelatedNote } from '../../shared/types.js'
import { t, useLocale } from '../lib/i18n.js'
import { buildChapterMarkdown, markdownFilename, todayStamp } from '../lib/export.js'
import { backlinksFor, buildNoteIndex } from '../lib/note-index.js'
import { relatedNotes, snippet } from '../lib/links.js'
import { Checkbox } from './Checkbox.js'
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
  generationMode: GenerationMode
  marks: ReaderMark[]
  crossBookNotes: RelatedNote[]
  focusNoteId: string | null
  focusKey: number
  expandingNoteId: string | null
  onGenerate(fresh?: boolean): void
  onCancel(): void
  onCreate(draft: NoteDraft): Promise<Note>
  onUpdate(id: string, patch: NotePatch): Promise<void>
  onDelete(id: string): Promise<void>
  onExpand(id: string): void
  onJumpQuote(quote: string): void
  onOpenNote(note: Note): void
  onOpenRelated(note: RelatedNote): void
  onListen(text: string): void
  onShare(note: Note): void
  onDeleteMark(id: string): void
  onRevealMark(quote: string): void
}

const STAGE_LABEL: Record<string, string> = {
  condense: '读薄',
  'audit-fidelity': '保真回查',
  'audit-details': '细节回查',
  'extract-cards': '卡片提炼',
  'refilter-cards': '卡片筛选',
  'expand-cards': '卡片延伸',
}

function degradedSummary(report: NoteReport): string {
  return (report.degraded ?? [])
    .map((step) => {
      const label = t(STAGE_LABEL[step.stage] ?? step.stage)
      return step.total && step.total > 1 ? `${label} ${step.failed}/${step.total}` : label
    })
    .join(' · ')
}

function StreamingCard({ partial, onCancel }: { partial: GeneratePartial | null; onCancel(): void }): JSX.Element {
  useLocale()
  const progress = partial?.progress
  const phaseLabel =
    progress?.phase === 'condense'
      ? t('正在把这一章读薄')
      : progress?.phase === 'cards'
        ? t('正在提炼核心卡片')
        : progress?.phase === 'expand'
          ? t('正在生成发散')
          : t('AI 正在读这一章')
  const progressDetail = progress
    ? progress.phase === 'condense'
      ? `${progress.done}/${progress.total} ${t('节 · 保留全部观点做压缩')}`
      : progress.phase === 'cards'
        ? `${t('已提炼')} ${progress.cards} ${t('张核心卡片')}`
        : `${progress.done}/${progress.total} ${t('张卡片 · 共')} ${progress.cards} ${t('张')}`
    : null
  return (
    <div className="streaming-card">
      <div className="streaming-head">
        <span className="spinner" />
        <span>{phaseLabel}…</span>
        <button type="button" className="text-button muted" onClick={onCancel}>
          {t('取消')}
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
        <p className="streaming-hint">{t('正在拆解本章的论证结构…')}</p>
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

function NotesPanelImpl({
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
  generationMode,
  marks,
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
  onShare,
  onDeleteMark,
  onRevealMark,
}: NotesPanelProps): JSX.Element {
  // 单次扫描建索引；卡片渲染只做 Map 查找，不再对每条笔记做一次 allNotes.filter/includes。
  const noteIndex = useMemo(() => buildNoteIndex(allNotes), [allNotes])
  const openWikiLink = useCallback(
    (title: string) => {
      const target = allNotes.find((candidate) => candidate.title === title)
      if (target) onOpenNote(target)
    },
    [allNotes, onOpenNote],
  )
  const condensedNote = notes.find((note) => note.kind === 'condensed') ?? null
  const summaryNotes = notes.filter((note) => note.kind === 'summary')
  const pointNotes = notes.filter((note) => note.kind === 'point' || note.kind === 'claim')
  const questionNotes = notes.filter((note) => note.kind === 'question')
  const mineNotes = notes.filter((note) => note.kind === 'highlight' || note.kind === 'thought')
  const [verifyOnly, setVerifyOnly] = useState(false)
  const evidenceNotes = pointNotes.filter((note) => note.author === 'ai')
  const evidenceWithQuote = evidenceNotes.filter((note) => note.quote?.trim())
  const evidenceVerified = evidenceWithQuote.filter((note) => note.quoteVerified)
  const evidenceUnverified = evidenceWithQuote.filter((note) => !note.quoteVerified)
  const evidenceMissing = evidenceNotes.filter((note) => !note.quote?.trim())
  const pointNotesForDisplay = verifyOnly
    ? pointNotes.filter((note) => note.author === 'ai' && note.quote?.trim() && !note.quoteVerified)
    : pointNotes
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
        backlinks={backlinksFor(noteIndex, note)}
        allNotes={allNotes}
        focusKey={focusNoteId === note.id ? focusKey : 0}
        expanding={expandingNoteId === note.id}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onShare={onShare}
        onExpand={onExpand}
        onJumpQuote={onJumpQuote}
        onOpenNote={onOpenNote}
        onWikiLink={openWikiLink}
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
          <h2>{t('本章笔记')}</h2>
          <p>{chapter ? chapter.title : t('选择一章开始')}</p>
        </div>
        {generating ? (
          <button type="button" className="ghost-button small" onClick={onCancel}>
            {t('取消生成')}
          </button>
        ) : (
          <button type="button" className="primary-button small" onClick={() => onGenerate()} disabled={!chapter}>
            {t('✦ 读薄并提炼')}
          </button>
        )}
      </div>


      <p className="condense-hint">
        {t('AI 会把这一章重写成可直接发博客的读薄稿：只保留断言，并列改列表，删掉铺垫；压缩幅度由内容密度决定，保留断言优先。')}
      </p>

      {error ? <div className="inline-error" role="alert">{error}</div> : null}

      {generating ? <StreamingCard partial={partial} onCancel={onCancel} /> : null}

      {report && report.originalChars > 0 ? (
        <div className="condense-card">
          {report.degraded && report.degraded.length > 0 ? (
            <div className="degraded-banner" role="alert">
              <strong>{t('这次生成不完整')}</strong>
              <span>
                {degradedSummary(report)} {t('失败，失败的小节可能保留了原文，卡片可能退化成了本地兜底结果。建议重试，或换一个更稳定的模型。')}
              </span>
            </div>
          ) : null}
          <div className="condense-head">
            <span>{t('读薄')}</span>
            <span>
              {report.originalChars.toLocaleString()} → {report.condensedChars.toLocaleString()} {t('字')} ·{' '}
              {report.ratio > 0 ? `1/${report.ratio.toFixed(1)}` : '—'}
            </span>
          </div>
          <div
            className="condense-ratio-bar"
            title={`${t('读薄稿约为原文的')} ${Math.round((report.condensedChars / Math.max(1, report.originalChars)) * 100)}%`}
          >
            <span
              style={{
                width: `${Math.max(3, Math.min(100, (report.condensedChars / Math.max(1, report.originalChars)) * 100))}%`,
              }}
            />
          </div>
          <div className="condense-meta">
            {report.sections} {t('节')} · {report.cards} {t('张核心卡片')} · {report.divergences} {t('条延伸')}
            {report.fidelityMissing > 0 ? ` · ${t('审计补遗')} ${report.fidelityMissing} ${t('条')}` : ''}
            {report.omitted > 0 ? ` · ${t('未采纳')} ${report.omitted} ${t('处')}` : ''}
            {report.durationMs > 0
              ? ` · ${t('用时')} ${report.durationMs < 10000 ? (report.durationMs / 1000).toFixed(1) : Math.round(report.durationMs / 1000)}s`
              : ''}
            {report.mode === 'fast' ? ` · ${t('快速')}` : report.mode === 'deep' ? ` · ${t('精读')}` : report.mode === 'standard' ? ` · ${t('标准')}` : ''}
            {report.cached
              ? ` · ${t('缓存命中')}${report.cachedTokens ? ` · ${t('省')} ${report.cachedTokens.toLocaleString()} tokens` : ''}`
              : report.usage?.totalTokens
                ? ` · ${report.usage.totalTokens.toLocaleString()} tokens`
                : ''}
          </div>
          {report.cached ? (
            <div className="condense-cached">
              <span>{t('这次直接复用了同一章、同一模型的上次结果。')}</span>
              <button type="button" className="text-button" onClick={() => onGenerate(true)}>
                {t('强制重新生成')}
              </button>
            </div>
          ) : null}
          {report.omittedItems && report.omittedItems.length > 0 ? (
            <details className="omitted-details">
              <summary>{t('查看未采纳的')} {report.omittedItems.length} {t('处原文')}</summary>
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
          <p className="notes-empty-title">{t('这一章还没有读薄稿')}</p>
          <p>{t('AI 会先把这一章重写成可发博客的读薄稿（只保留断言、并列改列表，压缩幅度由内容密度决定），再从稿子里用「不知道它是否影响全文理解」的标准提炼 5–25 张核心卡片，最后做最多 3 条延伸。')}</p>
          <p className="field-hint">
            {t('当前档位')}：{generationMode === 'fast' ? t('快速（跳过回查和延伸）') : generationMode === 'deep' ? t('精读（额外细节回查）') : t('标准')}{t('，可在右上角设置里调整。')}
          </p>
          <div className="notes-empty-actions">
            <button type="button" className="primary-button" onClick={() => onGenerate()}>
              {t('✦ 读薄并提炼')}
            </button>
            <button type="button" className="ghost-button" onClick={() => void addNote()}>
              {t('自己写一条')}
            </button>
          </div>
        </div>
      ) : null}

      {condensedNote ? (
        <section className="condensed-section">
          <div className="note-group-head">
            <span>{t('读薄稿')}</span>
            <div className="condensed-tools">
              {report && report.ratio > 0 ? <span className="muted">约 1/{report.ratio.toFixed(1)}</span> : null}
              <Checkbox
                className="export-check"
                checked={includeCards}
                onChange={setIncludeCards}
                label={t('附卡片')}
              />
              <button type="button" className="text-button" onClick={() => onShare(condensedNote)}>
                {t('分享')}
              </button>
              <button type="button" className="text-button" onClick={() => onListen(condensedNote.content)}>
                {t('朗读')}
              </button>
              <button type="button" className="text-button" onClick={() => void copyDraft()}>
                {exportState === 'copied' ? t('已复制') : t('复制')}
              </button>
              <button type="button" className="text-button" onClick={() => void exportDraft()}>
                {exportState === 'saved' ? t('已导出') : t('导出 .md')}
              </button>
            </div>
          </div>
          {exportError ? <div className="inline-error" role="alert">{exportError}</div> : null}
          {renderCard(condensedNote, true)}
        </section>
      ) : null}

      {marks.length > 0 ? (
        <section className="reader-marks-section">
          <div className="note-group-head">
            <span>{t('划词标记')}</span>
            <span className="muted">{marks.length}</span>
          </div>
          <div className="reader-mark-list">
            {marks.map((mark) => (
              <div key={mark.id} className="reader-mark-row">
                <span className={`reader-mark-style style-${mark.style}`}>
                  {mark.style === 'highlight' ? t('高亮') : mark.style === 'underline' ? t('划线') : t('删除线')}
                </span>
                <button type="button" className="reader-mark-quote" onClick={() => onRevealMark(mark.quote)}>
                  {mark.quote}
                </button>
                <button type="button" className="text-button muted" onClick={() => onDeleteMark(mark.id)}>
                  {t('移除')}
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {renderGroup(t('摘要'), summaryNotes)}
      {evidenceNotes.length > 0 ? (
        <section className="evidence-summary" aria-label={t('原文依据核查')}>
          <div>
            <strong>{t('依据核查')}</strong>
            <span>
              {evidenceVerified.length}/{evidenceWithQuote.length} {t('已核对')} · {evidenceUnverified.length} {t('待核对')} · {evidenceMissing.length} {t('无依据')}
            </span>
          </div>
          <button type="button" className="text-button" aria-pressed={verifyOnly} onClick={() => setVerifyOnly((value) => !value)}>
            {verifyOnly ? t('显示全部卡片') : t('只看待核对')}
          </button>
        </section>
      ) : null}
      {renderGroup(t('核心知识点'), pointNotesForDisplay)}
      {verifyOnly && pointNotesForDisplay.length === 0 ? <p className="note-empty">{t('这张章节没有待核对的知识点。')}</p> : null}
      {renderGroup(t('问题'), questionNotes)}
      {renderGroup(t('我的笔记'), mineNotes)}

      {!generating && notes.length > 0 ? (
        <button type="button" className="add-note-button" onClick={() => void addNote()}>
          {t('＋ 添加一条自己的笔记')}
        </button>
      ) : null}

      {related.length > 0 ? (
        <section className="related-section">
          <div className="note-group-head">
            <span>{t('这本书里的相关笔记')}</span>
            <span className="muted">{related.length}</span>
          </div>
          {related.map((note) => (
            <button key={note.id} type="button" className="related-card" onClick={() => onOpenNote(note)}>
              <span className="related-chapter">{note.chapterId ? (chapterTitles[note.chapterId] ?? t('其他章节')) : t('其他章节')}</span>
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
            <span>{t('其他书里的相关笔记')}</span>
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

export const NotesPanel = memo(NotesPanelImpl)
