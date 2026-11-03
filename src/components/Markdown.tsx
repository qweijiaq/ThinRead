import { isValidElement, memo, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownProps {
  text: string
  onWikiLink?(title: string): void
}

function preprocess(text: string): string {
  return text.replace(/\[\[([^\]\n]+)\]\]/g, (_match, title: string) => `[${title}](#wiki:${encodeURIComponent(title)})`)
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((child) => nodeText(child)).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children)
  return ''
}

/** 从 <pre> 的子节点里识别 mermaid 代码块，返回原始语法。 */
function mermaidSource(children: ReactNode): string | null {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) return null
  const className = children.props.className ?? ''
  if (!className.split(/\s+/).includes('language-mermaid')) return null
  return nodeText(children.props.children)
}

/**
 * 异步加载 mermaid，避免把图表引擎塞进首屏包。
 * 渲染完成前（以及渲染失败时）显示原始代码块，导出的静态 HTML 也复用同一份回退标记。
 */
function MermaidDiagram({ source }: { source: string }): JSX.Element {
  const [svg, setSvg] = useState('')

  useEffect(() => {
    let cancelled = false
    setSvg('')
    void import('../lib/mermaid.js')
      .then(({ renderMermaidSvg }) => renderMermaidSvg(source))
      .then((next) => {
        if (!cancelled) setSvg(next)
      })
      .catch(() => {
        // 解析失败时保留代码块，不打断整篇笔记的阅读。
      })
    return () => {
      cancelled = true
    }
  }, [source])

  if (!svg) {
    return (
      <pre>
        <code className="language-mermaid">{source}</code>
      </pre>
    )
  }
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
}

const REMARK_PLUGINS = [remarkGfm]

function MarkdownImpl({ text, onWikiLink }: MarkdownProps): JSX.Element {
  // 预处理和组件表都必须稳定，否则每次父组件渲染都会重新解析整篇 Markdown。
  const processed = useMemo(() => preprocess(text), [text])
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
        if (href?.startsWith('#wiki:')) {
          const title = decodeURIComponent(href.slice('#wiki:'.length))
          return (
            <button type="button" className="wiki-link" onClick={() => onWikiLink?.(title)}>
              {children}
            </button>
          )
        }
        if (href?.startsWith('#')) {
          return (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault()
                const id = decodeURIComponent(href.slice(1))
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              {children}
            </a>
          )
        }
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        )
      },
      pre: ({ children }) => {
        const source = mermaidSource(children)
        if (source !== null) return <MermaidDiagram source={source.trimEnd()} />
        return <pre>{children}</pre>
      },
    }),
    [onWikiLink],
  )

  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  )
}

export const Markdown = memo(MarkdownImpl)
