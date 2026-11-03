import type { JSX } from 'react'

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
  onRenameBook,
}: TopBarProps): JSX.Element {
  useLocale()
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
            ) : (
              <span
                className="topbar-book"
                title={
                  labActive
                    ? t('AI 工作台')
                    : mapActive
                      ? t('知识地图')
                      : composeActive
                        ? t('整本成稿')
                        : contentActive
                          ? t('生成内容库')
                          : notesActive
                            ? t('全库笔记')
                            : book?.title
                }
              >
                {labActive
                  ? t('AI 工作台')
                  : mapActive
                    ? t('知识地图')
                    : composeActive
                      ? t('整本成稿')
                      : contentActive
                        ? t('生成内容库')
                        : notesActive
                          ? t('全库笔记')
                          : book?.title}
              </span>
            )}
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
      <div className="topbar-right">
        <button
          type="button"
          className={`ghost-button small${contentActive ? ' is-active' : ''}`}
          onClick={onContent}
          title={t('生成内容库')}
        >
          {t('内容库')}
        </button>
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
          {t('笔记')}
        </button>
        <button
          type="button"
          className={`ghost-button small${mapActive ? ' is-active' : ''}`}
          onClick={onMap}
          title={t('知识地图')}
        >
          {t('地图')}
        </button>
        <button
          type="button"
          className={`ghost-button small${labActive ? ' is-active' : ''}`}
          onClick={onLab}
          title={t('AI 工作台')}
        >
          {t('工作台')}
        </button>
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
          ?
        </button>
        <button type="button" className="icon-button" onClick={onSettings} title={t('设置')} aria-label={t('设置')}>
          ⚙
        </button>
      </div>
    </header>
  )
}
