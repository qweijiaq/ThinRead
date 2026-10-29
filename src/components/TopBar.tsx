import type { JSX } from 'react'
import { PROVIDER_PRESETS } from '../../shared/types.js'
import type { BookSummary, SettingsView } from '../../shared/types.js'

interface TopBarProps {
  book: BookSummary | null
  settings: SettingsView | null
  importing: boolean
  onLibrary(): void
  onImport(): void
  onSettings(): void
  onReparse(): void
  onSearch(): void
  onNotes(): void
  onMap(): void
  notesActive?: boolean
  mapActive?: boolean
  onRenameBook?: () => void
}

export function TopBar({
  book,
  settings,
  importing,
  onLibrary,
  onImport,
  onSettings,
  onReparse,
  onSearch,
  onNotes,
  onMap,
  notesActive = false,
  mapActive = false,
  onRenameBook,
}: TopBarProps): JSX.Element {
  const preset = PROVIDER_PRESETS.find((item) => item.id === settings?.provider)
  const modelLabel = settings?.demo ? '演示模式' : `${preset?.label ?? settings?.provider} · ${settings?.model}`
  return (
    <header className="topbar">
      <div className="topbar-left">
        <span
          className="wordmark"
          onClick={onLibrary}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onLibrary()
            }
          }}
        >
          页边
        </span>
        {book || notesActive || mapActive ? (
          <>
            <span className="topbar-divider" />
            {book && !notesActive && !mapActive && onRenameBook ? (
              <button
                type="button"
                className="topbar-book topbar-book-button"
                onClick={onRenameBook}
                title="重命名书名"
              >
                {book.title}
              </button>
            ) : (
              <span className="topbar-book" title={mapActive ? '知识地图' : notesActive ? '全库笔记' : book?.title}>
                {mapActive ? '知识地图' : notesActive ? '全库笔记' : book?.title}
              </span>
            )}
            <button type="button" className="ghost-button small" onClick={onLibrary}>
              书架
            </button>
            {book && !notesActive && !mapActive ? (
              <button type="button" className="ghost-button small" onClick={onReparse} title="用新的解析器重新拆分章节">
                重新解析
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="topbar-right">
        <button
          type="button"
          className={`ghost-button small${notesActive ? ' is-active' : ''}`}
          onClick={onNotes}
          title="全库笔记"
        >
          笔记
        </button>
        <button
          type="button"
          className={`ghost-button small${mapActive ? ' is-active' : ''}`}
          onClick={onMap}
          title="知识地图"
        >
          地图
        </button>
        <button type="button" className="ghost-button small" onClick={onSearch} title="搜索（⌘K）">
          搜索
        </button>
        <span className="topbar-divider" />
        <span className={`model-pill${settings?.demo ? ' demo' : ''}`} title="当前模型">
          <span className="model-dot" />
          <span className="model-label">{modelLabel}</span>
        </span>
        <button type="button" className="ghost-button" onClick={onImport} disabled={importing}>
          {importing ? '导入中…' : '导入'}
        </button>
        <button type="button" className="icon-button" onClick={onSettings} title="设置" aria-label="设置">
          ⚙
        </button>
      </div>
    </header>
  )
}
