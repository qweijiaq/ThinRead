import { bridge } from '../lib/bridge.js'
import { memo, useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { ChapterContent, GeneratePartial, GenerationMode, Note, NoteColor, NoteDraft, NotePatch, NoteReport, ReaderMark, RelatedNote } from '../../shared/types.js'
import { t, useLocale } from '../lib/i18n.js'
import { buildChapterMarkdown, markdownFilename, todayStamp } from '../lib/export.js'
import { backlinksFor, buildNoteIndex } from '../lib/note-index.js'
import { relatedNotes, snippet } from '../lib/links.js'
import { contentToMarkdown } from '../lib/content-view.js'
import { Checkbox } from './Checkbox.js'
import { CompareModelDialog } from './CompareModelDialog.js'
import { SparkleIcon } from './Icon.js'
import { NoteCard } from './NoteCard.js'
import { SkeletonBlock } from './Skeleton.js'
import { TextDiffDialog } from './TextDiffDialog.js'

interface NotesPanelProps {
  chapter: ChapterContent | null
  bookTitle: string
  author: string
  notes: Note[]
  allNotes: Note[]
  chapterTitles: Record<string, string>
  generating: boolean
  loading?: boolean
  partial: GeneratePartial | null
  error: string | null
  report: NoteReport | null
  generationMode: GenerationMode
  modelLabel?: string
  demo?: boolean
  coreMode?: boolean
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
  compareModels?: string[]
}

const STAGE_LABEL: Record<string, string> = {
  condense: t('读薄'),
  'audit-fidelity': t('保真回查'),
  'audit-details': t('细节回查'),
  'extract-cards': t('卡片提炼'),
  'refilter-cards': t('卡片筛选'),
  'expand-cards': t('卡片延伸'),
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
  loading = false,
  partial,
  error,
  report,
  generationMode,
  modelLabel = '',
  demo = false,
  coreMode = false,
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
  compareModels = [],
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
  const { condensedNote, summaryNotes, pointNotes, questionNotes, mineNotes } = useMemo(() => {
    return {
      condensedNote: notes.find((note) => note.kind === 'condensed') ?? null,
      summaryNotes: notes.filter((note) => note.kind === 'summary'),
      pointNotes: notes.filter((note) => note.kind === 'point' || note.kind === 'claim'),
      questionNotes: notes.filter((note) => note.kind === 'question'),
      mineNotes: notes.filter((note) => note.kind === 'highlight' || note.kind === 'thought'),
    }
  }, [notes])
  const [verifyOnly, setVerifyOnly] = useState(false)
  const [sentenceCheck, setSentenceCheck] = useState(false)
  const [compareOriginal, setCompareOriginal] = useState(false)
  const [panelTab, setPanelTab] = useState<'draft' | 'cards' | 'audit'>('draft')
  const [colorFilter, setColorFilter] = useState<NoteColor | 'all'>('all')
  const [colorBusy, setColorBusy] = useState(false)
  const [colorProgress, setColorProgress] = useState({ done: 0, total: 0 })
  const [colorStatus, setColorStatus] = useState<string | null>(null)
  const byColor = (list: Note[]): Note[] =>
    colorFilter === 'all' ? list : list.filter((note) => note.color === colorFilter)
  const colorForKind: Record<Note['kind'], NoteColor> = {
    summary: 'red',
    point: 'blue',
    claim: 'blue',
    question: 'yellow',
    highlight: 'green',
    thought: 'green',
    condensed: 'red',
  }
  async function colorByKind(): Promise<void> {
    if (colorBusy) return
    const pending = notes.filter((note) => !note.color)
    if (pending.length === 0) {
      setColorStatus(t('所有卡片都已有颜色。'))
      return
    }
    setColorBusy(true)
    setColorStatus(null)
    setColorProgress({ done: 0, total: pending.length })
    let done = 0
    try {
      for (let start = 0; start < pending.length; start += 6) {
        const chunk = pending.slice(start, start + 6)
        await Promise.all(chunk.map((note) => onUpdate(note.id, { color: colorForKind[note.kind] })))
        done += chunk.length
        setColorProgress({ done, total: pending.length })
      }
      setColorStatus(`${t('已为')} ${done} ${t('张卡片配色。')}`)
    } catch (err) {
      setColorStatus(`${t('配色失败')}：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setColorBusy(false)
    }
  }
  const { evidenceNotes, evidenceWithQuote, evidenceVerified, evidenceUnverified, evidenceMissing } = useMemo(() => {
    const notesWithQuote = pointNotes.filter((note) => note.author === 'ai')
    const withQuote = notesWithQuote.filter((note) => note.quote?.trim())
    return {
      evidenceNotes: notesWithQuote,
      evidenceWithQuote: withQuote,
      evidenceVerified: withQuote.filter((note) => note.quoteVerified),
      evidenceUnverified: withQuote.filter((note) => !note.quoteVerified),
      evidenceMissing: notesWithQuote.filter((note) => !note.quote?.trim()),
    }
  }, [pointNotes])
  const pointNotesForDisplay = useMemo(
    () =>
      verifyOnly
        ? pointNotes.filter((note) => note.author === 'ai' && note.quote?.trim() && !note.quoteVerified)
        : pointNotes,
    [pointNotes, verifyOnly],
  )
  const related = useMemo(
    () => relatedNotes(chapter?.id ?? null, notes, allNotes),
    [chapter?.id, notes, allNotes],
  )
  const [includeCards, setIncludeCards] = useState(false)
  const [exportState, setExportState] = useState<'idle' | 'copied' | 'saved'>('idle')
  const [exportError, setExportError] = useState<string | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareBusy, setCompareBusy] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [compareDiff, setCompareDiff] = useState<{ before: string; after: string } | null>(null)

  useEffect(() => {
    setExportState('idle')
    setExportError(null)
    setSentenceCheck(false)
    setColorStatus(null)
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
      await bridge.copyText(markdown())
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
      const result = await bridge.saveMarkdown(
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
        sentenceCheck={sentenceCheck}
        evidenceNotes={pointNotes}
        demo={demo}
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

  async function compareWithModel(model: string): Promise<void> {
    if (!chapter) return
    setCompareBusy(true)
    setCompareError(null)
    try {
      const result = await bridge.compareChapterNotes({ chapterId: chapter.id, model })
      setCompareOpen(false)
      setCompareDiff({
        before: contentToMarkdown(result.base),
        after: contentToMarkdown(result.compare),
      })
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : String(err))
    } finally {
      setCompareBusy(false)
    }
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
    <div className="notes-panel" data-active-tab={panelTab}>
      <div className="notes-head">
        <div>
          <h2>{t('本章笔记')}</h2>
          <p>{chapter ? chapter.title : t('选择一章开始')}</p>
        </div>
        {generating ? (
          <button type="button" className="ghost-button small" onClick={onCancel}>
            {t('取消生成')}
          </button>
        ) : null}
      </div>


      <p className="condense-hint">
        {t('AI 会把这一章重写成可直接发博客的读薄稿：保留断言，删掉铺垫，写成连贯行文；压缩幅度由内容密度决定。')}
      </p>
      {modelLabel ? (
        <p className="condense-hint">
          {t('将使用')} <strong>{modelLabel}</strong> · {generationMode === 'fast' ? t('快速') : generationMode === 'deep' ? t('精读') : t('标准')}
          {coreMode ? ` · ${t('推荐路径')}：${t('读')} → ${t('读薄')} → ${t('卡片')} → ${t('成书')}` : ''}
        </p>
      ) : null}
      {demo ? (
        <div className="demo-note-banner" role="status">
          <strong>{t('演示模式')}</strong>
          <span>{t('这里用示例结果展示效果；配置真实模型后会按你的书重新生成。')}</span>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <nav className="notes-jump" aria-label={t('跳到')}>
          <button
            type="button"
            className={panelTab === 'draft' ? 'is-active' : ''}
            aria-pressed={panelTab === 'draft'}
            onClick={() => setPanelTab('draft')}
          >
            {t('草稿')}
          </button>
          <button
            type="button"
            className={panelTab === 'cards' ? 'is-active' : ''}
            aria-pressed={panelTab === 'cards'}
            onClick={() => setPanelTab('cards')}
          >
            {t('卡片')}
          </button>
          <button
            type="button"
            className={panelTab === 'audit' ? 'is-active' : ''}
            aria-pressed={panelTab === 'audit'}
            onClick={() => setPanelTab('audit')}
          >
            {t('核对')}
          </button>
        </nav>
      ) : null}

      {chapter && compareModels.length > 0 ? (
        <div className="notes-compare-line">
          <button type="button" className="text-button" onClick={() => setCompareOpen(true)}>
            {t('模型对比')}
          </button>
          <span>{t('用另一个模型重跑本章，先不覆盖当前笔记。')}</span>
        </div>
      ) : null}

      {error ? <div className="inline-error" role="alert">{error}</div> : null}

      {generating ? <StreamingCard partial={partial} onCancel={onCancel} /> : null}

      {loading && !generating && notes.length === 0 ? (
        <div className="notes-loading" role="status" aria-busy="true">
          <span className="sr-only">{t('正在加载…')}</span>
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="sk-note-card" aria-hidden="true">
              <SkeletonBlock className="sk-w-30" />
              <SkeletonBlock className="sk-w-80 sk-note-title" />
              <SkeletonBlock className="sk-w-100" />
              <SkeletonBlock className="sk-w-85" />
              <SkeletonBlock className="sk-w-55" />
            </div>
          ))}
        </div>
      ) : null}

      {report && report.originalChars > 0 && report.degraded && report.degraded.length > 0 ? (
        <div className="degraded-banner" role="alert">
          <strong>{t('这次生成不完整')}</strong>
          <span>
            {degradedSummary(report)} {t('失败。已完成的小节会保留，再次生成只重试失败步骤，不会整章从头跑。')}
          </span>
          <button type="button" className="ghost-button small" onClick={() => onGenerate()} disabled={generating}>
            {t('重试失败步骤')}
          </button>
        </div>
      ) : null}

      {report && report.originalChars > 0 ? (
        <details className="condense-card condense-details">
          <summary className="condense-head">
            <span>{t('读薄')}</span>
            <span>
              {report.originalChars.toLocaleString()} → {report.condensedChars.toLocaleString()} {t('字')} ·{' '}
              {report.ratio > 0 ? `1/${report.ratio.toFixed(1)}` : '—'}
            </span>
            <span className="condense-details-toggle">{t('详情')}</span>
          </summary>
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
            {report.images ? ` · ${t('图片')} ${report.images} ${t('张')}${report.visionUsed ? t('（视觉）') : t('（仅图注）')}` : ''}
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
        </details>
      ) : null}

      {!generating && !loading && notes.length === 0 ? (
        <div className="notes-empty notes-tab-section" data-tab="draft">
          <p className="notes-empty-title">{t('这一章还没有读薄稿')}</p>
          <p>{t('AI 会先把这一章重写成可发博客的读薄稿（保留断言、写成连贯行文，压缩幅度由内容密度决定），再从稿子里按「不知道它是否影响全文理解」的标准提炼核心卡片，最后做最多 3 条延伸。')}</p>
          <p className="field-hint">
            {t('当前档位')}：{generationMode === 'fast' ? t('快速（跳过回查和延伸）') : generationMode === 'deep' ? t('精读（额外细节回查）') : t('标准')}{t('，可在右上角设置里调整。')}
          </p>
          <div className="notes-empty-actions">
            <button type="button" className="primary-button" onClick={() => onGenerate()}>
              <><SparkleIcon /> {t('改写成文章')}</>
            </button>
            <button type="button" className="ghost-button" onClick={() => void addNote()}>
              {t('自己写一条')}
            </button>
          </div>
        </div>
      ) : null}

      {condensedNote ? (
        <section className="condensed-section notes-tab-section" data-tab="draft">
          <div className="note-group-head condensed-head">
            <span className="condensed-title">{t('读薄稿')}</span>
            {report && report.ratio > 0 ? (
              <span className="condensed-ratio">
                {t('约 1/')}
                {report.ratio.toFixed(1)}
              </span>
            ) : null}
            <button type="button" className="text-button condensed-export" onClick={() => void exportDraft()}>
              {exportState === 'saved' ? t('已导出') : t('导出 .md')}
            </button>
            <div className="condensed-tools">
              <Checkbox
                className="export-check"
                checked={includeCards}
                onChange={setIncludeCards}
                label={t('附卡片')}
              />
              <button
                type="button"
                className={`text-button${sentenceCheck ? '' : ''}`}
                aria-pressed={sentenceCheck}
                onClick={() => setSentenceCheck((value) => !value)}
              >
                {sentenceCheck ? t('显示全文') : t('逐句核对')}
              </button>
              <button
                type="button"
                className="text-button"
                aria-pressed={compareOriginal}
                onClick={() => setCompareOriginal((value) => !value)}
              >
                {compareOriginal ? t('收起对照') : t('对比原文')}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => onShare(condensedNote)}
                disabled={demo}
                title={demo ? t('演示结果不能分享为真实内容') : undefined}
              >
                {t('分享')}
              </button>
              <button type="button" className="text-button" onClick={() => onListen(condensedNote.content)}>
                {t('朗读')}
              </button>
              <button type="button" className="text-button" onClick={() => void copyDraft()}>
                {exportState === 'copied' ? t('已复制') : t('复制全文')}
              </button>
            </div>
          </div>
          {exportError ? <div className="inline-error" role="alert">{exportError}</div> : null}
          {compareOriginal ? (
            <div className="draft-compare">
              <div>
                <span>{t('原文')}</span>
                <p>{chapter?.text ?? ''}</p>
              </div>
              <div>
                <span>{t('改写后')}</span>
                <p>{condensedNote.content.replace(/^#{1,4}\s+/gm, '')}</p>
              </div>
            </div>
          ) : null}
          {renderCard(condensedNote, true)}
        </section>
      ) : null}

      {marks.length > 0 ? (
        <section className="reader-marks-section notes-tab-section" data-tab="draft">
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

      <div className="notes-color-filter notes-tab-section" data-tab="cards" aria-label={t('按颜色筛选笔记')}>
        <button type="button" className={colorFilter === 'all' ? 'active' : ''} onClick={() => setColorFilter('all')}>
          {t('全部')}
        </button>
        {([
          ['red', '#d65345'],
          ['yellow', '#d8a53a'],
          ['green', '#4f8a63'],
          ['blue', '#4f7fa8'],
        ] as const).map(([color, hex]) => (
          <button
            key={color}
            type="button"
            className={colorFilter === color ? 'active' : ''}
            aria-label={color}
            onClick={() => setColorFilter(colorFilter === color ? 'all' : color)}
          >
            <span style={{ background: hex }} />
          </button>
        ))}
        <button
          type="button"
          className="notes-color-auto"
          title={t('只给未标色的卡片按类型自动配色')}
          disabled={colorBusy}
          aria-busy={colorBusy}
          onClick={() => void colorByKind()}
        >
          {colorBusy
            ? `${t('配色中')} ${colorProgress.done}/${colorProgress.total}`
            : t('按类型配色')}
        </button>
      </div>
      {colorStatus ? (
        <p className="notes-color-status" role="status">
          {colorStatus}
        </p>
      ) : null}
      <div className="notes-tab-section" data-tab="cards">{renderGroup(t('摘要'), byColor(summaryNotes))}</div>
      {evidenceNotes.length > 0 ? (
        <section className="evidence-summary" id="notes-audit" aria-label={t('原文依据核查')}>
          <div>
            <strong>{t('依据核查')}</strong>
            <span>
              {evidenceVerified.length}/{evidenceWithQuote.length} {t('已核对')} · {evidenceUnverified.length} {t('待核对')} · {evidenceMissing.length} {t('无依据')}
            </span>
          </div>
          <button type="button" className="text-button" aria-pressed={verifyOnly} onClick={() => { setVerifyOnly((value) => !value); setPanelTab('audit') }}>
            {verifyOnly ? t('显示全部卡片') : t('只看待核对')}
          </button>
        </section>
      ) : null}
      <div className="notes-tab-section" data-tab="cards audit">{renderGroup(t('核心观点'), byColor(pointNotesForDisplay))}</div>
      {verifyOnly && pointNotesForDisplay.length === 0 ? <p className="note-empty">{t('这张章节没有待核对的知识点。')}</p> : null}
      <div className="notes-tab-section" data-tab="cards">{renderGroup(t('问题'), byColor(questionNotes))}</div>
      <div className="notes-tab-section" data-tab="cards">{renderGroup(t('我的笔记'), byColor(mineNotes))}</div>

      {!generating && notes.length > 0 ? (
        <button type="button" className="add-note-button notes-tab-section" data-tab="cards" onClick={() => void addNote()}>
          {t('＋ 添加一条自己的笔记')}
        </button>
      ) : null}

      {related.length > 0 ? (
        <section className="related-section notes-tab-section" data-tab="draft">
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

      {compareOpen ? (
        <CompareModelDialog
          suggestions={compareModels}
          busy={compareBusy}
          error={compareError}
          onCompare={(model) => void compareWithModel(model)}
          onClose={() => {
            if (!compareBusy) setCompareOpen(false)
          }}
        />
      ) : null}
      {compareDiff ? (
        <TextDiffDialog
          title={t('模型对比')}
          before={compareDiff.before}
          after={compareDiff.after}
          onClose={() => setCompareDiff(null)}
        />
      ) : null}
    </div>
  )
}

export const NotesPanel = memo(NotesPanelImpl)
