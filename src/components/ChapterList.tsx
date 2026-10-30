import { useEffect, useState, type JSX } from 'react'

import type { ChapterMeta } from '../../shared/types.js'
import { confirmDialog } from './ConfirmDialog.js'

interface ChapterListProps {
  chapters: ChapterMeta[]
  currentId: string | null
  noteCounts: Record<string, number>
  progress: number
  onSelect(chapter: ChapterMeta): void
  onOrganize(): void
  onDelete(chapter: ChapterMeta): void
  onRename(chapter: ChapterMeta): void
  onRenamePart(partIndex: number, title: string): void
}

interface ChapterEntry {
  chapter: ChapterMeta
  number: number
}

type Block =
  | { type: 'chapter'; entry: ChapterEntry }
  | { type: 'group'; key: string; title: string; chapters: ChapterEntry[] }

function partKey(chapter: ChapterMeta): string {
  return `${chapter.partIndex ?? 0}:${chapter.partTitle ?? ''}`
}

function buildBlocks(visible: ChapterMeta[]): Block[] {
  const blocks: Block[] = []
  let current: Extract<Block, { type: 'group' }> | null = null

  visible.forEach((chapter, index) => {
    const entry = { chapter, number: index + 1 }
    if (chapter.partTitle) {
      const key = partKey(chapter)
      if (!current || current.key !== key) {
        current = { type: 'group', key, title: chapter.partTitle, chapters: [] }
        blocks.push(current)
      }
      current.chapters.push(entry)
    } else {
      current = null
      blocks.push({ type: 'chapter', entry })
    }
  })

  return blocks
}

export function ChapterList({
  chapters,
  currentId,
  noteCounts,
  progress,
  onSelect,
  onOrganize,
  onDelete,
  onRename,
  onRenamePart,
}: ChapterListProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const visible = chapters.filter((chapter) => !chapter.hidden)
  const hiddenCount = chapters.length - visible.length
  const blocks = buildBlocks(visible)

  useEffect(() => {
    if (!currentId) return
    const currentChapter = chapters.find((chapter) => chapter.id === currentId)
    if (!currentChapter?.partTitle) return
    const key = partKey(currentChapter)
    setCollapsed((previous) => {
      if (!previous.has(key)) return previous
      const next = new Set(previous)
      next.delete(key)
      return next
    })
  }, [currentId, chapters])

  function togglePart(key: string): void {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function renderChapter(entry: ChapterEntry): JSX.Element {
    const { chapter, number } = entry
    const count = noteCounts[chapter.id] ?? 0
    const displayTitle = chapter.isPart ? '篇首页' : chapter.title
    return (
      <div key={chapter.id} className={`chapter-row${chapter.id === currentId ? ' active' : ''}`}>
        <button type="button" className="chapter-item" onClick={() => onSelect(chapter)} title={chapter.title}>
          <span className="chapter-index">{String(number).padStart(2, '0')}</span>
          <span className="chapter-title">{displayTitle}</span>
          {count > 0 ? <span className="chapter-count">{count}</span> : null}
        </button>
        {chapter.isPart ? null : (
          <button
            type="button"
            className="chapter-rename"
            title="重命名本章"
            aria-label={`重命名 ${chapter.title}`}
            onClick={() => onRename(chapter)}
          >
            ✎
          </button>
        )}
        <button
          type="button"
          className="chapter-delete"
          title="删除本章"
          aria-label={`删除 ${chapter.title}`}
          onClick={() => {
            void confirmDialog({
              title: '删除章节',
              message: `删除「${chapter.title}」？这一章的笔记也会一并删除，且无法恢复。`,
              confirmLabel: '删除',
              danger: true,
            }).then((confirmed) => {
              if (confirmed) onDelete(chapter)
            })
          }}
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>目录</span>
        <button type="button" className="text-button" onClick={onOrganize}>
          整理
        </button>
      </div>
      <div className="sidebar-meta">
        <span>{visible.length} 节</span>
        {hiddenCount > 0 ? <span>已隐藏 {hiddenCount} 节</span> : null}
      </div>
      <div className="progress-track sidebar-progress">
        <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <nav className="chapter-list">
        {blocks.map((block) => {
          if (block.type === 'chapter') return renderChapter(block.entry)
          const isCollapsed = collapsed.has(block.key)
          return (
            <div key={block.key} className="part-block">
              <div className="part-row">
                <button type="button" className="part-header" onClick={() => togglePart(block.key)}>
                  <span className={`part-caret${isCollapsed ? ' collapsed' : ''}`}>▾</span>
                  <span className="part-title">{block.title}</span>
                  <span className="part-count">{block.chapters.length}</span>
                </button>
                <button
                  type="button"
                  className="chapter-rename part-rename"
                  title="重命名分篇"
                  aria-label={`重命名 ${block.title}`}
                  onClick={() => {
                    const partIndex = block.chapters[0]?.chapter.partIndex
                    if (partIndex != null) onRenamePart(partIndex, block.title)
                  }}
                >
                  ✎
                </button>
              </div>
              {isCollapsed ? null : <div className="part-chapters">{block.chapters.map(renderChapter)}</div>}
            </div>
          )
        })}
      </nav>
      {hiddenCount > 0 ? (
        <button type="button" className="hidden-chapters" onClick={onOrganize}>
          已隐藏 {hiddenCount} 节 · 管理
        </button>
      ) : null}
    </aside>
  )
}
