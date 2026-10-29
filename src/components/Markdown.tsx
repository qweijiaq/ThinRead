import type { JSX } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownProps {
  text: string
  onWikiLink?(title: string): void
}

function preprocess(text: string): string {
  return text.replace(/\[\[([^\]\n]+)\]\]/g, (_match, title: string) => `[${title}](#wiki:${encodeURIComponent(title)})`)
}

export function Markdown({ text, onWikiLink }: MarkdownProps): JSX.Element {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('#wiki:')) {
              const title = decodeURIComponent(href.slice('#wiki:'.length))
              return (
                <button type="button" className="wiki-link" onClick={() => onWikiLink?.(title)}>
                  {children}
                </button>
              )
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            )
          },
        }}
      >
        {preprocess(text)}
      </ReactMarkdown>
    </div>
  )
}
