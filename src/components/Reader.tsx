import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'

import type { ChapterContent, ReaderMark, ReaderMarkStyle, ReaderStyle, RelatedNote } from '../../shared/types.js'
import { EchoDialog } from './EchoDialog.js'
import { PdfOriginalView } from './PdfOriginalView.js'

interface ReaderProps {
  chapter: ChapterContent | null
  loading: boolean
  style: ReaderStyle
  bookTitle: string
  scrollTarget: { quote: string; key: number } | null
  echoes: RelatedNote[]
  excerpt: string
  marks: ReaderMark[]
  onCreateMark(style: ReaderMarkStyle, text: string): void
  onClearMarks(ids: string[]): void
  onOpenFormat(): void
  onOpenEcho(echo: RelatedNote): void
  onListen(): void
  onRenameChapter(): void
  onMarginNote(text: string): void
  onAsk(text: string): void
  onShareQuote(text: string): void
  onListenSelection(text: string): void
  onOpenXhs(): void
  positionTarget: { chapterId: string; ratio: number; key: number } | null
  onCreateBookmark(input: {
    bookId: string
    chapterId: string
    scrollRatio: number
    scrollTop: number
    label: string
    quote: string | null
  }): void
  pdfBookId?: string
  pdfBookTitle?: string
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
  marks,
  onCreateMark,
  onClearMarks,
  onOpenFormat,
  onOpenEcho,
  onListen,
  onRenameChapter,
  onMarginNote,
  onAsk,
  onShareQuote,
  onListenSelection,
  onOpenXhs,
  positionTarget,
  onCreateBookmark,
  pdfBookId,
  pdfBookTitle,
}: ReaderProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const positionTimerRef = useRef<number | null>(null)
  const restoringRef = useRef(false)
  const [selection, setSelection] = useState<string>('')
  const [toolbar, setToolbar] = useState<{ x: number; y: number } | null>(null)
  const [echoOpen, setEchoOpen] = useState(false)
  const [pdfOpen, setPdfOpen] = useState(false)
  const html = useMemo(() => {
    const source = chapter?.formattedHtml ?? chapter?.html
    return source ? stripDuplicateTitle(source, chapter?.title ?? '') : null
  }, [chapter?.formattedHtml, chapter?.html, chapter?.title])

  const pdfPage = useMemo(() => {
    const match = chapter?.text.match(/\[第 (\d+) 页\]/)
    return match ? Math.max(1, Number(match[1])) : 1
  }, [chapter?.text])

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

  const selectedMarks = useMemo(() => {
    const selected = selection.replace(/\s+/g, '')
    if (selected.length < 4) return []
    return marks.filter((mark) => {
      const quote = mark.quote.replace(/\s+/g, '')
      return quote.includes(selected) || selected.includes(quote)
    })
  }, [marks, selection])

  useEffect(() => {
    setSelection('')
    setToolbar(null)
    setEchoOpen(false)
    setPdfOpen(false)
  }, [chapter?.id])

  useEffect(() => {
    const root = containerRef.current
    if (!root || !chapter || loading) return
    let cancelled = false
    restoringRef.current = true
    root.scrollTop = 0
    const apply = async (): Promise<void> => {
      let ratio = 0
      if (positionTarget && positionTarget.chapterId === chapter.id) ratio = positionTarget.ratio
      else {
        const position = await window.api.getReadingPosition(chapter.id).catch(() => null)
        ratio = position?.scrollRatio ?? 0
      }
      if (cancelled) return
      const max = Math.max(0, root.scrollHeight - root.clientHeight)
      root.scrollTop = Math.max(0, Math.min(max, ratio * max))
    }
    const timer = window.setTimeout(() => {
      void apply().finally(() => {
        window.setTimeout(() => {
          if (!cancelled) restoringRef.current = false
        }, 90)
      })
    }, 60)
    // 图片/字体可能稍后才撑开高度，再兜底恢复一次。
    const lateTimer = window.setTimeout(() => {
      if (!cancelled && (positionTarget?.ratio ?? 0) > 0) void apply()
    }, 700)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.clearTimeout(lateTimer)
    }
  }, [chapter?.id, loading, positionTarget?.chapterId, positionTarget?.key, positionTarget?.ratio])

  function handleReaderScroll(): void {
    setToolbar(null)
    const root = containerRef.current
    if (!root || !chapter || loading || restoringRef.current) return
    if (positionTimerRef.current) window.clearTimeout(positionTimerRef.current)
    const max = Math.max(0, root.scrollHeight - root.clientHeight)
    const scrollTop = root.scrollTop
    const ratio = max > 0 ? scrollTop / max : 0
    const bookId = chapter.bookId
    const chapterId = chapter.id
    positionTimerRef.current = window.setTimeout(() => {
      void window.api
        .saveReadingPosition({ bookId, chapterId, scrollRatio: ratio, scrollTop })
        .catch(() => undefined)
    }, 350)
  }

  function bookmarkHere(): void {
    const root = containerRef.current
    if (!root || !chapter) return
    const max = Math.max(0, root.scrollHeight - root.clientHeight)
    const ratio = max > 0 ? root.scrollTop / max : 0
    onCreateBookmark({
      bookId: chapter.bookId,
      chapterId: chapter.id,
      scrollRatio: ratio,
      scrollTop: root.scrollTop,
      label: `${chapter.title} · ${Math.round(ratio * 100)}%`,
      quote: selection.trim() || null,
    })
  }

  useEffect(
    () => () => {
      if (positionTimerRef.current) window.clearTimeout(positionTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    const root = containerRef.current
    const css = CSS as unknown as { highlights?: { delete(name: string): void; set(name: string, value: unknown): void } }
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (!root || !css.highlights || !HighlightCtor) return
    const names = ['reader-mark-highlight', 'reader-mark-underline', 'reader-mark-strikethrough']
    names.forEach((name) => css.highlights!.delete(name))
    const groups = new Map<ReaderMarkStyle, Range[]>()
    for (const mark of marks) {
      const range = findQuoteRange(root, mark.quote)
      if (!range) continue
      const list = groups.get(mark.style) ?? []
      list.push(range)
      groups.set(mark.style, list)
    }
    for (const [style, ranges] of groups) {
      if (ranges.length === 0) continue
      css.highlights.set(`reader-mark-${style}`, new HighlightCtor(...ranges))
    }
    return () => {
      names.forEach((name) => css.highlights!.delete(name))
    }
  }, [marks, html, chapter?.id, loading])

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
    setToolbar({
      x: Math.min(window.innerWidth - 500, Math.max(500, rect.left + rect.width / 2)),
      y: Math.max(60, rect.top - 10),
    })
  }

  return (
    <section className="reader-wrap">
      <div className="reader" ref={containerRef} onMouseUp={handleMouseUp} onScroll={handleReaderScroll}>
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
                  {pdfBookId ? (
                    <button type="button" className="ghost-button small" onClick={() => setPdfOpen(true)}>
                      原版 PDF
                    </button>
                  ) : null}
                  {echoes.length > 0 ? (
                    <button type="button" className="ghost-button small" onClick={() => setEchoOpen(true)}>
                      回声 · {echoes.length}
                    </button>
                  ) : null}
                  <button type="button" className="ghost-button small" onClick={onListen}>
                    听读
                  </button>
                  <button type="button" className="ghost-button small" onClick={onOpenXhs}>
                    小红书
                  </button>
                  <button type="button" className="ghost-button small" onClick={bookmarkHere}>
                    书签
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
        <div className="selection-toolbar" role="toolbar" aria-label="选中文本操作" style={{ left: toolbar.x, top: toolbar.y }}>
          <button
            type="button"
            onClick={() => {
              onCreateMark('highlight', selection)
              window.getSelection()?.removeAllRanges()
              setSelection('')
              setToolbar(null)
            }}
          >
            高亮
          </button>
          <button
            type="button"
            onClick={() => {
              onCreateMark('underline', selection)
              window.getSelection()?.removeAllRanges()
              setSelection('')
              setToolbar(null)
            }}
          >
            划线
          </button>
          <button
            type="button"
            title="给选中文字加删除线"
            onClick={() => {
              onCreateMark('strikethrough', selection)
              window.getSelection()?.removeAllRanges()
              setSelection('')
              setToolbar(null)
            }}
          >
            删除
          </button>
          {selectedMarks.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                onClearMarks(selectedMarks.map((mark) => mark.id))
                window.getSelection()?.removeAllRanges()
                setSelection('')
                setToolbar(null)
              }}
            >
              清除
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              onAsk(selection)
              setSelection('')
              setToolbar(null)
            }}
          >
            问 AI
          </button>
          <button
            type="button"
            onClick={() => {
              onMarginNote(selection)
              window.getSelection()?.removeAllRanges()
              setSelection('')
              setToolbar(null)
            }}
          >
            AI 边注
          </button>
          <button
            type="button"
            onClick={() => {
              onShareQuote(selection)
              setSelection('')
              setToolbar(null)
            }}
          >
            分享
          </button>
          <button
            type="button"
            onClick={() => {
              onListenSelection(selection)
              setSelection('')
              setToolbar(null)
            }}
          >
            朗读
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
      {pdfOpen && pdfBookId ? (
        <PdfOriginalView
          bookId={pdfBookId}
          chapterId={chapter?.id ?? null}
          title={pdfBookTitle ?? bookTitle}
          initialPage={pdfPage}
          onClose={() => setPdfOpen(false)}
        />
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
