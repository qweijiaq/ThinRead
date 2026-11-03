import { useEffect, useMemo, useState, type JSX } from 'react'

import { t, useLocale } from '../lib/i18n.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import { Checkbox } from './Checkbox.js'
import { confirmDialog } from './ConfirmDialog.js'
import type {
  ChapterFlag,
  ChapterKind,
  ChapterMeta,
  ChapterSuggestion,
  ClassifyResult,
} from '../../shared/types.js'

const KIND_LABEL: Record<ChapterKind, string> = {
  content: '正文',
  front: '前言/序',
  nav: '目录',
  cover: '封面',
  copyright: '版权页',
  ad: '广告',
  index: '索引',
  unknown: '无法识别',
}

interface OrganizeDialogProps {
  open: boolean
  chapters: ChapterMeta[]
  suggestions: ChapterSuggestion[]
  mode: ClassifyResult['mode'] | null
  error: string | null
  busy: boolean
  onClose(): void
  onClassify(): void
  onApply(flags: ChapterFlag[]): Promise<void>
  onDelete(chapterIds: string[]): Promise<void>
  onOpenTrash(): void
}

function formatChars(chars: number): string {
  return chars >= 10_000 ? `${(chars / 10_000).toFixed(1)} 万字` : `${chars} 字`
}

export function OrganizeDialog({
  open,
  chapters,
  suggestions,
  mode,
  error,
  busy,
  onClose,
  onClassify,
  onApply,
  onDelete,
  onOpenTrash,
}: OrganizeDialogProps): JSX.Element | null {
  useLocale()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)

  const suggestionById = useMemo(() => {
    const map = new Map<string, ChapterSuggestion>()
    for (const suggestion of suggestions) map.set(suggestion.chapterId, suggestion)
    return map
  }, [suggestions])

  useEffect(() => {
    if (!open) return
    setSelected(new Set(suggestions.filter((item) => item.hidden).map((item) => item.chapterId)))
  }, [open, suggestions])

  const dialogRef = useDialogFocus<HTMLDivElement>(open, () => { if (!busy && !applying) onClose() }, 'button')

  if (!open) return null

  const ordered = [...chapters].sort((a, b) => a.idx - b.idx)
  const allSelected = ordered.length > 0 && ordered.every((chapter) => selected.has(chapter.id))

  function toggle(chapterId: string): void {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(chapterId)) next.delete(chapterId)
      else next.add(chapterId)
      return next
    })
  }

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(ordered.map((chapter) => chapter.id)))
  }

  async function applySelected(hidden: boolean): Promise<void> {
    if (selected.size === 0) return
    setApplying(true)
    try {
      const flags: ChapterFlag[] = [...selected].map((chapterId) => {
        const suggestion = suggestionById.get(chapterId)
        return suggestion
          ? {
              chapterId,
              hidden,
              kind: suggestion.kind,
              reason: suggestion.reason,
              classifiedBy: mode === 'ai' ? 'ai' : 'heuristic',
            }
          : { chapterId, hidden, classifiedBy: 'user' }
      })
      await onApply(flags)
      setSelected(new Set())
    } finally {
      setApplying(false)
    }
  }

  async function deleteSelected(): Promise<void> {
    if (selected.size === 0) return
    const confirmed = await confirmDialog({
      title: t('删除章节'),
      message: `${t('删除选中的')} ${selected.size} ${t('节？这些章节的笔记也会一并删除，无法恢复。')}`,
      confirmLabel: t('删除'),
      danger: true,
    })
    if (!confirmed) return
    setApplying(true)
    try {
      await onDelete([...selected])
      setSelected(new Set())
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal organize-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('整理目录')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{t('整理目录')}</h2>
            <p className="modal-subtitle">{t('识别目录、版权页、广告和乱码页；隐藏可恢复，删除会进入章节回收站。')}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        <div className="organize-toolbar">
          <button type="button" className="ghost-button" onClick={onClassify} disabled={busy || applying}>
            {busy ? t('识别中…') : t('✦ 识别无关章节')}
          </button>
          <span className="organize-mode">
            {busy
              ? t('正在判断每一节的内容…')
              : mode === 'ai'
                ? t('已用 AI 判断，结果仅作建议')
                : mode === 'demo'
                  ? t('演示模式使用本地规则识别')
                  : mode === 'heuristic'
                    ? t('使用本地规则识别')
                    : t('尚未识别，可直接手动勾选')}
          </span>
        </div>

        {error ? <div className="inline-error" role="alert">{error}</div> : null}

        <div className="organize-list">
          <div className="organize-row organize-row-head" onClick={toggleAll}>
            <Checkbox checked={allSelected} onChange={toggleAll} ariaLabel={t('全选章节')} />
            <span className="organize-title">{t('全部章节')}</span>
            <span className="organize-chars">{chapters.length} {t('节')}</span>
          </div>
          {ordered.map((chapter, index) => {
            const suggestion = suggestionById.get(chapter.id)
            const kind = suggestion?.kind ?? chapter.kind
            return (
              <div
                key={chapter.id}
                className={`organize-row${chapter.hidden ? ' is-hidden' : ''}`}
                onClick={() => toggle(chapter.id)}
              >
                <Checkbox
                  checked={selected.has(chapter.id)}
                  onChange={() => toggle(chapter.id)}
                  ariaLabel={`${t('选择')} ${chapter.title}`}
                />
                <span className="organize-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="organize-main">
                  <span className="organize-title">{chapter.title}</span>
                  <span className="organize-sub">
                    {chapter.isPart ? `${t('篇首')} · ` : chapter.partTitle ? `${chapter.partTitle} · ` : ''}
                    {formatChars(chapter.chars)}
                    {suggestion ? (
                      <>
                        {' · '}
                        {suggestion.reason || t(KIND_LABEL[suggestion.kind])}
                        {' · '}
                        {Math.round(suggestion.confidence * 100)}%
                      </>
                    ) : null}
                  </span>
                </span>
                <span className={`kind-tag kind-${kind}`}>{t(KIND_LABEL[kind])}</span>
                <span className={`organize-status${chapter.hidden ? ' hidden' : ''}`}>
                  {chapter.hidden ? t('已隐藏') : t('可见')}
                </span>
              </div>
            )
          })}
          {ordered.length === 0 ? <p className="organize-empty">{t('这本书没有可整理的章节。')}</p> : null}
        </div>

        <div className="organize-footer">
          <span className="muted">{t('已选')} {selected.size} {t('节')}</span>
          <div className="organize-actions">
            <button
              type="button"
              className="text-button danger"
              onClick={() => void deleteSelected()}
              disabled={selected.size === 0 || applying}
            >
              {t('删除选中')}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void applySelected(false)}
              disabled={selected.size === 0 || applying}
            >
              {t('恢复选中')}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => void applySelected(true)}
              disabled={selected.size === 0 || applying}
            >
              {applying ? t('处理中…') : t('隐藏选中')}
            </button>
            <button type="button" className="text-button muted" onClick={onOpenTrash}>
              {t('章节回收站')}
            </button>
            <button type="button" className="text-button muted" onClick={onClose}>
              {t('关闭')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
