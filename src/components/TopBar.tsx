import { useEffect, useRef, useState, type JSX } from 'react'

import { PROVIDER_PRESETS } from '../../shared/types.js'
import type { BookSummary, SettingsView } from '../../shared/types.js'
import { t, useLocale } from '../lib/i18n.js'

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
  onLab(): void
  onCompose(): void
  onContent(): void
  onManual(): void
  notesActive?: boolean
  mapActive?: boolean
  labActive?: boolean
  composeActive?: boolean
  contentActive?: boolean
  onRenameBook?: () => void
  coreMode: boolean
  onToggleCoreMode(value: boolean): void
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
  onLab,
  onCompose,
  onContent,
  onManual,
  notesActive = false,
  mapActive = false,
  labActive = false,
  composeActive = false,
  contentActive = false,
  coreMode,
  onToggleCoreMode,
  onRenameBook,
}: TopBarProps): JSX.Element {
  useLocale()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!moreOpen) return
    function onPointerDown(event: PointerEvent): void {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false)
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])
  const preset = PROVIDER_PRESETS.find((item) => item.id === settings?.provider)
  const modelLabel = settings?.demo ? t('演示模式') : `${preset?.label ?? settings?.provider} · ${settings?.model}`
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
          {t('页边')}
        </span>
        {book || notesActive || mapActive || labActive || composeActive || contentActive ? (
          <>
            <span className="topbar-divider" />
            {book && !notesActive && !mapActive && !labActive && !composeActive && !contentActive && onRenameBook ? (
              <button
                type="button"
                className="topbar-book topbar-book-button"
                onClick={onRenameBook}
                title={t('重命名书名')}
              >
                {book.title}
              </button>
            ) : null}
            <button type="button" className="ghost-button small" onClick={onLibrary}>
              {t('书架')}
            </button>
            {book && !notesActive && !mapActive && !labActive && !composeActive && !contentActive ? (
              <button
                type="button"
                className="ghost-button small"
                onClick={onReparse}
                title={t('用新的解析器重新拆分章节')}
              >
                {t('重新解析')}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      <nav className="topbar-nav" aria-label={t('主要导航')}>
        {!coreMode ? (
          <button
            type="button"
            className={`ghost-button small${contentActive ? ' is-active' : ''}`}
            onClick={onContent}
            title={t('生成内容库')}
          >
            {t('AI 内容库')}
          </button>
        ) : null}
        {book ? (
          <button
            type="button"
            className={`ghost-button small${composeActive ? ' is-active' : ''}`}
            onClick={onCompose}
            title={t('整本成稿')}
          >
            {t('成书')}
          </button>
        ) : null}
        <button
          type="button"
          className={`ghost-button small${notesActive ? ' is-active' : ''}`}
          onClick={onNotes}
          title={t('全库笔记')}
        >
          {t('笔记库')}
        </button>
        {!coreMode ? (
          <button
            type="button"
            className={`ghost-button small${mapActive ? ' is-active' : ''}`}
            onClick={onMap}
            title={t('知识地图')}
          >
            {t('知识地图')}
          </button>
        ) : null}
        {!coreMode ? (
          <button
            type="button"
            className={`ghost-button small${labActive ? ' is-active' : ''}`}
            onClick={onLab}
            title={t('AI 工作台')}
          >
            {t('AI 工具')}
          </button>
        ) : null}
        {coreMode ? (
          <div className="topbar-more" ref={moreRef}>
            <button
              type="button"
              className={`ghost-button small${moreOpen ? ' is-active' : ''}`}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((value) => !value)}
            >
              {t('更多')}
            </button>
            {moreOpen ? (
              <div className="topbar-more-menu" role="menu" aria-label={t('更多功能')}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false)
                    onToggleCoreMode(false)
                  }}
                >
                  {t('显示全部功能')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </nav>
      <div className="topbar-right">
        <button type="button" className="ghost-button small" onClick={onSearch} title={t('搜索（⌘K）')}>
          {t('搜索')}
        </button>
        <span className="topbar-divider" />
        <button
          type="button"
          className={`model-pill${settings?.demo ? ' demo' : ''}`}
          title={settings?.demo ? t('当前是演示模式，点击配置真实模型') : t('当前模型，点击配置')}
          onClick={onSettings}
        >
          <span className="model-dot" />
          <span className="model-label">{modelLabel}</span>
        </button>
        <button type="button" className="ghost-button" onClick={onImport} disabled={importing}>
          {importing ? t('导入中…') : t('导入')}
        </button>
        <button type="button" className="icon-button" onClick={onManual} title={t('使用手册')} aria-label={t('使用手册')}>
          <svg className="od-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.6 9.3a2.5 2.5 0 1 1 3.3 2.4c-.6.24-.9.68-.9 1.3v.5" />
            <path d="M12 17h.01" />
          </svg>
        </button>
        <button type="button" className="icon-button" onClick={onSettings} title={t('设置')} aria-label={t('设置')}>
          <svg className="od-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h8M16 7h4M4 12h4M12 12h8M4 17h10M18 17h2" />
            <circle cx="14" cy="7" r="2" />
            <circle cx="10" cy="12" r="2" />
            <circle cx="16" cy="17" r="2" />
          </svg>
        </button>
      </div>
    </header>
  )
}
