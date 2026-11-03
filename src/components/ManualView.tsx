import { useMemo, useRef, useState, type JSX } from 'react'

import manual from '../assets/user-manual.md?raw'
import { t, useLocale } from '../lib/i18n.js'
import { Markdown } from './Markdown.js'

interface ManualViewProps {
  onBack(): void
}

function tocFrom(markdown: string): string[] {
  return [...markdown.matchAll(/^##\s+(.+)$/gm)]
    .map((match) => match[1]!.trim())
    .filter((title) => title !== '目录')
}

export function ManualView({ onBack }: ManualViewProps): JSX.Element {
  useLocale()
  const contentRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const headings = useMemo(() => tocFrom(manual), [])
  const visible = useMemo(
    () => (query.trim() ? headings.filter((heading) => heading.includes(query.trim())) : headings),
    [headings, query],
  )

  function jump(heading: string): void {
    const nodes = contentRef.current?.querySelectorAll('h2')
    if (!nodes) return
    for (const node of nodes) {
      if (node.textContent?.trim() === heading) {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
    }
  }

  return (
    <main className="manual-view">
      <header className="manual-header">
        <button type="button" className="ghost-button small" onClick={onBack}>
          ← {t('返回')}
        </button>
        <div className="manual-heading">
          <span className="manual-kicker">THINREAD / FIELD MANUAL</span>
          <h1>{t('用户手册')}</h1>
          <p>{t('从导入一本书到生成分享卡，按步骤查功能；API Key 申请和边界说明也在里面。')}</p>
        </div>
        <span className="manual-version">v1.0 · 2026-11</span>
      </header>

      <div className="manual-layout">
        <aside className="manual-toc" aria-label={t('手册目录')}>
          <label className="manual-search">
            <span>{t('搜索章节')}</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('例如：API Key')} />
          </label>
          <nav>
            {visible.map((heading, index) => (
              <button key={heading} type="button" onClick={() => jump(heading)}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                {heading.replace(/^\d+\.\s*/, '')}
              </button>
            ))}
            {visible.length === 0 ? <p className="manual-empty">{t('没有匹配的章节')}</p> : null}
          </nav>
        </aside>

        <div className="manual-content" ref={contentRef}>
          <Markdown text={manual} />
        </div>
      </div>
    </main>
  )
}
