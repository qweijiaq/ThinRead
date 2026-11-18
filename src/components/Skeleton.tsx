import type { JSX } from 'react'

import { t } from '../lib/i18n.js'

export function SkeletonBlock({ className = '' }: { className?: string }): JSX.Element {
  return <span className={`sk-block${className ? ` ${className}` : ''}`} aria-hidden="true" />
}

export function SkeletonRows({ rows = 3, className = '' }: { rows?: number; className?: string }): JSX.Element {
  return (
    <div className={`sk-rows${className ? ` ${className}` : ''}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="sk-row">
          <SkeletonBlock className="sk-row-title" />
          <SkeletonBlock className="sk-row-line" />
        </div>
      ))}
    </div>
  )
}

function LoadingLabel(): JSX.Element {
  return <span className="sr-only">{t('正在加载…')}</span>
}

function ChartBars({ count = 14 }: { count?: number }): JSX.Element {
  const heights = [34, 58, 26, 72, 44, 86, 54, 30, 64, 40, 76, 48, 22, 56]
  return (
    <div className="sk-chart">
      {Array.from({ length: count }).map((_, index) => (
        <span key={index} className="sk-chart-bar" style={{ height: `${heights[index % heights.length]}%` }} />
      ))}
    </div>
  )
}

function RankRows({ rows = 4 }: { rows?: number }): JSX.Element {
  return (
    <div className="sk-rank-list">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="sk-rank-row">
          <SkeletonBlock className="sk-rank-name" />
          <SkeletonBlock className="sk-rank-track" />
        </div>
      ))}
    </div>
  )
}

/** 统计页：标题 + 四张指标卡 + 柱状图 + 排行。 */
export function StatsSkeleton(): JSX.Element {
  return (
    <main className="stats-view" role="status" aria-busy="true">
      <LoadingLabel />
      <div className="stats-view-head" aria-hidden="true">
        <SkeletonBlock className="sk-back" />
        <div className="stats-view-title-row">
          <SkeletonBlock className="sk-title" />
          <div className="stats-view-actions">
            {Array.from({ length: 3 }).map((_, index) => (
              <SkeletonBlock key={index} className="sk-text-btn" />
            ))}
          </div>
        </div>
        <SkeletonBlock className="sk-sub" />
      </div>
      <div className="stats-grid" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="stats-card sk-card">
            <SkeletonBlock className="sk-label" />
            <SkeletonBlock className="sk-value" />
          </div>
        ))}
      </div>
      <section className="stats-section" aria-hidden="true">
        <SkeletonBlock className="sk-section-title" />
        <ChartBars />
      </section>
      <section className="stats-section" aria-hidden="true">
        <SkeletonBlock className="sk-section-title" />
        <RankRows />
      </section>
    </main>
  )
}

/** 周复盘列表：标题 + 年份筛选 + 折叠条目。 */
export function WeeklySkeleton(): JSX.Element {
  return (
    <main className="weekly-view" role="status" aria-busy="true">
      <LoadingLabel />
      <div className="stats-view-head" aria-hidden="true">
        <SkeletonBlock className="sk-back" />
        <SkeletonBlock className="sk-title" />
        <SkeletonBlock className="sk-sub" />
      </div>
      <div className="weekly-filters" aria-hidden="true">
        <SkeletonBlock className="sk-select" />
      </div>
      <div className="weekly-list" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="weekly-item is-skeleton">
            <div className="weekly-item-head">
              <SkeletonBlock className="sk-week" />
              <SkeletonBlock className="sk-item-title" />
              <SkeletonBlock className="sk-item-snippet" />
              <SkeletonBlock className="sk-item-time" />
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}

/** 笔记库：标题与操作 + 筛选工具条 + 单列笔记卡。 */
export function NotesSkeleton(): JSX.Element {
  return (
    <main className="notes-library" role="status" aria-busy="true">
      <LoadingLabel />
      <div className="notes-library-head" aria-hidden="true">
        <div>
          <SkeletonBlock className="sk-title" />
          <SkeletonBlock className="sk-sub" />
        </div>
        <div className="notes-library-actions">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonBlock key={index} className="sk-button" />
          ))}
        </div>
      </div>
      <div className="notes-toolbar" aria-hidden="true">
        <SkeletonBlock className="sk-input" />
        <SkeletonBlock className="sk-select" />
        <SkeletonBlock className="sk-select" />
        {Array.from({ length: 3 }).map((_, index) => (
          <SkeletonBlock key={index} className="sk-chip" />
        ))}
      </div>
      <div className="notes-library-list" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="library-note sk-note">
            <div className="library-note-top">
              <SkeletonBlock className="sk-note-title" />
              <SkeletonBlock className="sk-note-date" />
            </div>
            <SkeletonBlock className="sk-note-meta" />
            <SkeletonBlock className="sk-note-snippet" />
            <SkeletonBlock className="sk-note-snippet is-short" />
          </div>
        ))}
      </div>
    </main>
  )
}

/** 知识地图：标题与模式切换 + 工具条 + 画布。 */
export function MapSkeleton(): JSX.Element {
  return (
    <main className="map-view" role="status" aria-busy="true">
      <LoadingLabel />
      <div className="map-header" aria-hidden="true">
        <div>
          <SkeletonBlock className="sk-title" />
          <SkeletonBlock className="sk-sub" />
        </div>
        <div className="map-actions">
          <SkeletonBlock className="sk-pill" />
          <SkeletonBlock className="sk-pill" />
        </div>
      </div>
      <div className="map-toolbar" aria-hidden="true">
        <SkeletonBlock className="sk-input" />
        {Array.from({ length: 3 }).map((_, index) => (
          <SkeletonBlock key={index} className="sk-chip" />
        ))}
        <SkeletonBlock className="sk-pill" />
      </div>
      <div className="map-stage">
        <div className="map-skeleton" aria-hidden="true">
          <span className="map-skeleton-node n1" />
          <span className="map-skeleton-node n2" />
          <span className="map-skeleton-node n3" />
          <span className="map-skeleton-node n4" />
          <span className="map-skeleton-node n5" />
        </div>
      </div>
    </main>
  )
}

/** 生成内容库：标题 + 筛选条 + 左列表右预览。 */
export function ContentSkeleton(): JSX.Element {
  return (
    <main className="content-view" role="status" aria-busy="true">
      <LoadingLabel />
      <div className="content-head" aria-hidden="true">
        <div>
          <SkeletonBlock className="sk-title" />
          <SkeletonBlock className="sk-sub" />
        </div>
        <SkeletonBlock className="sk-button" />
      </div>
      <div className="content-toolbar" aria-hidden="true">
        <SkeletonBlock className="sk-input" />
        <SkeletonBlock className="sk-select" />
        <SkeletonBlock className="sk-select" />
        <SkeletonBlock className="sk-select" />
        <SkeletonBlock className="sk-chip" />
      </div>
      <div className="content-layout" aria-hidden="true">
        <div className="content-list">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="content-row sk-content-row">
              <SkeletonBlock className="sk-w-25" />
              <SkeletonBlock className="sk-w-70" />
              <SkeletonBlock className="sk-w-90" />
            </div>
          ))}
        </div>
        <div className="content-preview">
          <div className="sk-article">
            <SkeletonBlock className="sk-article-title" />
            <SkeletonBlock className="sk-article-line" />
            <SkeletonBlock className="sk-article-line" />
            <SkeletonBlock className="sk-article-line is-narrow" />
            <SkeletonBlock className="sk-article-gap" />
            <SkeletonBlock className="sk-article-line" />
            <SkeletonBlock className="sk-article-line is-narrow" />
          </div>
        </div>
      </div>
    </main>
  )
}

/** AI 工作台：标题栏 + 左侧工具轨道 + 中间任务面板。 */
export function LabSkeleton(): JSX.Element {
  return (
    <main className="lab-view" role="status" aria-busy="true">
      <LoadingLabel />
      <header className="lab-header" aria-hidden="true">
        <div>
          <SkeletonBlock className="sk-title" />
          <SkeletonBlock className="sk-sub" />
        </div>
        <div className="lab-header-actions">
          <SkeletonBlock className="sk-button" />
          <SkeletonBlock className="sk-button" />
        </div>
      </header>
      <div className="lab-layout" aria-hidden="true">
        <nav className="lab-rail">
          {Array.from({ length: 3 }).map((_, group) => (
            <div key={group} className="lab-rail-group">
              <SkeletonBlock className="sk-rail-label" />
              {Array.from({ length: 4 }).map((_, index) => (
                <SkeletonBlock key={index} className="sk-rail-item" />
              ))}
            </div>
          ))}
        </nav>
        <section className="lab-main">
          <div className="lab-tool-head">
            <div>
              <SkeletonBlock className="sk-section-title" />
              <SkeletonBlock className="sk-sub" />
            </div>
          </div>
          <div className="lab-sources">
            <div className="lab-source-block">
              <SkeletonBlock className="sk-label" />
              <SkeletonBlock className="sk-select" />
            </div>
            <div className="lab-source-block">
              <SkeletonBlock className="sk-label" />
              <SkeletonBlock className="sk-select" />
            </div>
          </div>
          <div className="sk-panel">
            <SkeletonBlock className="sk-w-40" />
            <SkeletonBlock className="sk-w-85" />
            <SkeletonBlock className="sk-w-70" />
            <SkeletonBlock className="sk-w-90" />
            <SkeletonBlock className="sk-w-60" />
          </div>
        </section>
      </div>
    </main>
  )
}

/** 整本生成：标题栏 + 左章节列表 + 右成稿。 */
export function ComposeSkeleton(): JSX.Element {
  return (
    <main className="compose-view" role="status" aria-busy="true">
      <LoadingLabel />
      <div className="compose-head" aria-hidden="true">
        <div>
          <SkeletonBlock className="sk-back" />
          <SkeletonBlock className="sk-title is-tall" />
          <SkeletonBlock className="sk-sub" />
        </div>
        <div className="compose-head-actions">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonBlock key={index} className="sk-button" />
          ))}
        </div>
      </div>
      <div className="compose-grid" aria-hidden="true">
        <section className="compose-chapters">
          <div className="compose-section-head">
            <div>
              <SkeletonBlock className="sk-section-title" />
              <SkeletonBlock className="sk-sub" />
            </div>
            <SkeletonBlock className="sk-stat" />
          </div>
          <div className="compose-generate-actions">
            <SkeletonBlock className="sk-button" />
            <SkeletonBlock className="sk-button" />
          </div>
          <div className="compose-chapter-list">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="compose-chapter-row is-skeleton">
                <SkeletonBlock className="sk-chapter-index" />
                <div className="sk-chapter-main">
                  <SkeletonBlock className="sk-chapter-title" />
                  <SkeletonBlock className="sk-chapter-meta" />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="compose-article">
          <div className="compose-section-head">
            <div>
              <SkeletonBlock className="sk-section-title" />
              <SkeletonBlock className="sk-sub" />
            </div>
          </div>
          <div className="sk-article">
            {Array.from({ length: 8 }).map((_, index) => (
              <SkeletonBlock key={index} className={`sk-article-line${index % 3 === 2 ? ' is-narrow' : ''}`} />
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

/** 通用兜底：未知视图或嵌入面板的加载占位。 */
export function ViewSkeleton(): JSX.Element {
  return (
    <div className="view-loading-shell" role="status" aria-busy="true">
      <LoadingLabel />
      <div className="view-skeleton" aria-hidden="true">
        <SkeletonBlock className="sk-title" />
        <SkeletonBlock className="sk-sub" />
        <div className="view-skeleton-grid">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="view-skeleton-card">
              <SkeletonBlock className="sk-w-40" />
              <SkeletonBlock className="sk-w-85" />
              <SkeletonBlock className="sk-w-65" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
