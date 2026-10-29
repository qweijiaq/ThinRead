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
}

export function TopBar({ book, settings, importing, onLibrary, onImport, onSettings, onReparse }: TopBarProps): JSX.Element {
  const preset = PROVIDER_PRESETS.find((item) => item.id === settings?.provider)
  const modelLabel = settings?.demo ? '演示模式' : `${preset?.label ?? settings?.provider} · ${settings?.model}`
  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="wordmark" onClick={onLibrary} role="button" tabIndex={0} onKeyDown={onLibrary}>
          页边
        </span>
        {book ? (
          <>
            <span className="topbar-divider" />
            <span className="topbar-book" title={book.title}>
              {book.title}
            </span>
            <button type="button" className="ghost-button small" onClick={onLibrary}>
              书架
            </button>
            <button type="button" className="ghost-button small" onClick={onReparse} title="用新的解析器重新拆分章节">
              重新解析
            </button>
          </>
        ) : null}
      </div>
      <div className="topbar-right">
        <span className={`model-pill${settings?.demo ? ' demo' : ''}`} title="当前模型">
          {modelLabel}
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
