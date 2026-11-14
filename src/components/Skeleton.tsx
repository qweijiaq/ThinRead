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

export function ViewSkeleton(): JSX.Element {
  return (
    <div className="view-loading-shell" role="status" aria-busy="true">
      <span className="sr-only">{t('正在加载…')}</span>
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
