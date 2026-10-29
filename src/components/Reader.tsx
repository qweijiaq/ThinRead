import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'

import type { ChapterContent, ReaderStyle, RelatedNote } from '../../shared/types.js'
import { EchoDialog } from './EchoDialog.js'

interface ReaderProps {
  chapter: ChapterContent | null
  loading: boolean
  style: ReaderStyle
  bookTitle: string
  scrollTarget: { quote: string; key: number } | null
  echoes: RelatedNote[]
  excerpt: string
  onQuote(text: string): void
  onOpenFormat(): void
  onOpenEcho(echo: RelatedNote): void
  onListen(): void
  onRenameChapter(): void
}

/** 旧版本解析出的章节会把标题重复放进正文；渲染时去掉与章节标题相同的前导标题文本。 */
function stripDuplicateTitle(html: string, title: string): string {
  try {
    const doc = new DOMParser().parseFromString(`<div id="__root">${html}</div>`, 'text/html')
    const root = doc.getElementById('__root')
    if (!root) return html
    const normalizedTitle = title.replace(/\s+/g, ' ').trim()
    const isTitleText = (text: string): boolean => text.replace(/\s+/g, ' ').trim() === normalizedTitle

    const dropLeadingTitleText = (): void => {
      for (let index = 0; index < 4; index++) {
        const node = root.firstChild
        if (!node || node.nodeType !== Node.TEXT_NODE) return
        const text = node.textContent ?? ''
        if (text.trim() && !isTitleText(text)) return
        node.remove()
      }
    }

    dropLeadingTitleText()
    const first = root.firstElementChild
    if (
      first &&
      (/^H[1-6]$/.test(first.tagName) || first.tagName === 'P') &&
      isTitleText(first.textContent ?? '')
    ) {
      first.remove()
    }
    dropLeadingTitleText()
    return root.innerHTML
  } catch {
    return html
  }
}

interface TextPoint {
  node: Text
  offset: number
}

function findQuoteRange(root: HTMLElement, quote: string): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const points: TextPoint[] = []
  let normalized = ''
  let node = walker.nextNode()
  while (node) {
    const text = node.textContent ?? ''
    for (let index = 0; index < text.length; index++) {
      const char = text[index]!
      if (/\s/.test(char)) continue
      points.push({ node: node as Text, offset: index })
      normalized += char.toLowerCase()
    }
    node = walker.nextNode()
  }
  const needle = quote.replace(/\s+/g, '').toLowerCase().slice(0, 40)
  if (needle.length < 4) return null
  const at = normalized.indexOf(needle)
  if (at < 0) return null
  const start = points[at]
  const end = points[at + needle.length - 1]
  if (!start || !end) return null
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset + 1)
  return range
}

export function Reader({
  chapter,
  loading,
  style,
  bookTitle,
  scrollTarget,
  echoes,
  excerpt,
  onQuote,
  onOpenFormat,
  onOpenEcho,
  onListen,
  onRenameChapter,
}: ReaderProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<string>('')
  const [toolbar, setToolbar] = useState<{ x: number; y: number } | null>(null)
  const [echoOpen, setEchoOpen] = useState(false)
  const html = useMemo(() => {
    const source = chapter?.formattedHtml ?? chapter?.html
    return source ? stripDuplicateTitle(source, chapter?.title ?? '') : null
  }, [chapter?.formattedHtml, chapter?.html, chapter?.title])

  const contentStyle: CSSProperties = {
    fontFamily:
      style.fontFamily === 'sans'
        ? '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        : '"Songti SC", "STSong", "Noto Serif CJK SC", "SimSun", Georgia, serif',
    fontSize: `${style.fontSize}px`,
    lineHeight: style.lineHeight,
    '--reader-indent': style.indent ? '2em' : '0',
    '--reader-paragraph-gap': `${style.paragraphSpacing}em`,
  } as CSSProperties

  useEffect(() => {
    setSelection('')
    setToolbar(null)
    setEchoOpen(false)
  }, [chapter?.id])

  useEffect(() => {
    if (!scrollTarget || !containerRef.current) return
    const range = findQuoteRange(containerRef.current, scrollTarget.quote)
    if (!range) return
    const element = range.startContainer.parentElement
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const current = window.getSelection()
    current?.removeAllRanges()
    current?.addRange(range)
  }, [scrollTarget])

  function handleMouseUp(): void {
    const current = window.getSelection()
    if (!current || current.isCollapsed) {
      setSelection('')
      setToolbar(null)
      return
    }
    const text = current.toString().replace(/\s+/g, ' ').trim()
    if (text.length < 4) {
      setSelection('')
      setToolbar(null)
      return
    }
    const range = current.getRangeAt(0)
    if (!containerRef.current?.contains(range.commonAncestorContainer)) return
    const rect = range.getBoundingClientRect()
    setSelection(text)
    setToolbar({ x: Math.min(window.innerWidth - 180, Math.max(180, rect.left + rect.width / 2)), y: rect.top - 10 })
  }

  function takeQuote(): void {
    if (!selection) return
    onQuote(selection)
    window.getSelection()?.removeAllRanges()
    setSelection('')
    setToolbar(null)
  }

  return (
    <section className="reader-wrap">
      <div className="reader" ref={containerRef} onMouseUp={handleMouseUp} onScroll={() => setToolbar(null)}>
        {loading || !chapter ? (
          <div className="reader-skeleton">
            <div className="skeleton-line wide" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
          </div>
        ) : (
          <article>
            <header className="chapter-head">
              <div className="chapter-head-row">
                <div className="chapter-kicker">
                  {chapter.partTitle && !chapter.isPart ? (
                    <span className="chapter-part">{chapter.partTitle}</span>
                  ) : null}
                  {chapter.partTitle && !chapter.isPart ? ' · ' : null}
                  {chapter.isPart ? '篇首 · ' : null}
                  约 {chapter.chars.toLocaleString()} 字
                </div>
                <div className="chapter-head-actions">
                  {echoes.length > 0 ? (
                    <button type="button" className="ghost-button small" onClick={() => setEchoOpen(true)}>
                      回声 · {echoes.length}
                    </button>
                  ) : null}
                  <button type="button" className="ghost-button small" onClick={onListen}>
                    听读
                  </button>
                  <button type="button" className="ghost-button small" onClick={onRenameChapter}>
                    改名
                  </button>
                  <button type="button" className="ghost-button small" onClick={onOpenFormat}>
                    排版
                  </button>
                </div>
              </div>
              <h1>{chapter.title}</h1>
            </header>
            {html ? (
              <div className="chapter-html" style={contentStyle} dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <div className="chapter-plain" style={contentStyle}>
                {chapter.text.split(/\n{2,}/).map((paragraph, index) => {
                  const marker = paragraph.match(/^\[第 (\d+) 页\]\n?/)
                  if (marker) {
                    return (
                      <div key={index}>
                        <div className="page-marker">第 {marker[1]} 页</div>
                        <p>{paragraph.slice(marker[0].length)}</p>
                      </div>
                    )
                  }
                  return <p key={index}>{paragraph}</p>
                })}
              </div>
            )}
          </article>
        )}
      </div>
      {toolbar && selection ? (
        <div className="selection-toolbar" style={{ left: toolbar.x, top: toolbar.y }}>
          <button type="button" onClick={takeQuote}>
            记笔记
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(`“${selection}”`)
              setToolbar(null)
            }}
          >
            复制
          </button>
        </div>
      ) : null}
      {echoOpen && chapter ? (
        <EchoDialog
          bookTitle={bookTitle}
          chapterTitle={chapter.title}
          excerpt={excerpt}
          echoes={echoes}
          onOpen={(echo) => {
            setEchoOpen(false)
            onOpenEcho(echo)
          }}
          onClose={() => setEchoOpen(false)}
        />
      ) : null}
    </section>
  )
}
