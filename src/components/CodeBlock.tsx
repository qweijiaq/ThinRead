import { useEffect, useRef, useState, type JSX } from 'react'

import { detectCodeLanguage, shouldCollapseCode } from '../lib/code-language.js'
import { highlightCode } from '../lib/highlight.js'
import { t } from '../lib/i18n.js'

interface CodeBlockProps {
  code: string
  className?: string | null
}

/** Markdown 代码块：语言标签、折叠、复制；样式与正文 HTML 里的代码块共用。 */
export function CodeBlock({ code, className }: CodeBlockProps): JSX.Element {
  const source = code.replace(/\n$/, '')
  const language = detectCodeLanguage(source, className)
  const collapsible = shouldCollapseCode(source)
  const [collapsed, setCollapsed] = useState(() => collapsible)
  const [copied, setCopied] = useState(false)
  const [highlighted, setHighlighted] = useState('')
  const resetTimer = useRef<number | null>(null)

  useEffect(() => {
    setCollapsed(collapsible)
  }, [collapsible, source])

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    setHighlighted('')
    void highlightCode(source, language).then((result) => {
      if (!cancelled) setHighlighted(result.html)
    })
    return () => {
      cancelled = true
    }
  }, [language, source])

  async function copy(): Promise<void> {
    try {
      const copyText = window.api?.copyText
      if (!copyText) return
      await copyText(source)
      setCopied(true)
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => setCopied(false), 1_400)
    } catch {
      // 复制失败不打断阅读。
    }
  }

  return (
    <div className={`code-block${collapsed ? ' is-collapsed' : ''}`} data-language={language ?? undefined}>
      <div className="code-block-head">
        {language ? <span className="code-block-lang">{language}</span> : <span />}
        <span className="code-block-actions">
          {collapsible ? (
            <button
              type="button"
              className="code-block-action"
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((value) => !value)}
            >
              {collapsed ? t('展开') : t('收起')}
            </button>
          ) : null}
          <button type="button" className="code-block-action" onClick={() => void copy()}>
            {copied ? t('已复制') : t('复制')}
          </button>
        </span>
      </div>
      <div className="code-block-body">
        <pre>
          {highlighted ? (
            <code
              className={`hljs ${className ?? ''}`.trim()}
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          ) : (
            <code className={className ?? undefined}>{source}</code>
          )}
        </pre>
      </div>
    </div>
  )
}
