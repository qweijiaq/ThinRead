import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type JSX } from 'react'

import type { ChapterContent, ReaderMark, ReaderMarkStyle, ReaderStyle, RelatedNote } from '../../shared/types.js'
import { t, useLocale } from '../lib/i18n.js'
import { getAutoNext, getDailyGoal, setAutoNext as setAutoNextPreference, subscribePreferences } from '../lib/preferences.js'
import { addReadingSeconds, getReadingSummary } from '../lib/reading-stats.js'
import { EchoDialog } from './EchoDialog.js'
import { PdfOriginalView } from './PdfOriginalView.js'
import { ReadingSummaryDialog } from './ReadingSummaryDialog.js'

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
  chapterIndex?: number
  chapterTotal?: number
  onPrevChapter?(): void
  onNextChapter?(): void
  onAdjustStyle?(patch: Partial<ReaderStyle>): void
  focusMode?: boolean
  onToggleFocus?(): void
  onSaveSummary?(title: string, markdown: string): Promise<void>
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
  chapterIndex,
  chapterTotal,
  onPrevChapter,
  onNextChapter,
  onAdjustStyle,
  focusMode = false,
  onToggleFocus,
  onSaveSummary,
}: ReaderProps): JSX.Element {
  useLocale()
  const containerRef = useRef<HTMLDivElement>(null)
  const positionTimerRef = useRef<number | null>(null)
  const restoringRef = useRef(false)
  const [selection, setSelection] = useState<string>('')
  const [toolbar, setToolbar] = useState<{ x: number; y: number } | null>(null)
  const [echoOpen, setEchoOpen] = useState(false)
  const [pdfOpen, setPdfOpen] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [fullCopied, setFullCopied] = useState(false)
  const [readProgress, setReadProgress] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)
  const autoNext = useSyncExternalStore(subscribePreferences, getAutoNext, getAutoNext)
  const dailyGoal = useSyncExternalStore(subscribePreferences, getDailyGoal, getDailyGoal)
  const [celebration, setCelebration] = useState<string | null>(null)
  const celebrationTimerRef = useRef<number | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const autoNextSuppressed = useRef(false)
  const bookmarkRef = useRef<() => void>(() => undefined)
  const lastActivityRef = useRef(Date.now())
  const sessionSecondsRef = useRef(0)
  const sessionBookRef = useRef<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryMinutes, setSummaryMinutes] = useState(1)
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

  useEffect(() => {
    const mark = (): void => {
      lastActivityRef.current = Date.now()
    }
    window.addEventListener('pointerdown', mark, { passive: true })
    window.addEventListener('keydown', mark)
    window.addEventListener('wheel', mark, { passive: true })
    window.addEventListener('touchstart', mark, { passive: true })
    window.addEventListener('scroll', mark, { passive: true, capture: true })
    return () => {
      window.removeEventListener('pointerdown', mark)
      window.removeEventListener('keydown', mark)
      window.removeEventListener('wheel', mark)
      window.removeEventListener('touchstart', mark)
      window.removeEventListener('scroll', mark, { capture: true })
    }
  }, [])

  useEffect(() => {
    if (!chapter?.bookId || sessionBookRef.current === chapter.bookId) return
    sessionBookRef.current = chapter.bookId
    sessionSecondsRef.current = 0
  }, [chapter?.bookId])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'ArrowLeft' || event.key === 'k' || event.key === 'K') {
        event.preventDefault()
        onPrevChapter?.()
      } else if (event.key === 'ArrowRight' || event.key === 'j' || event.key === 'J') {
        event.preventDefault()
        onNextChapter?.()
      } else if (event.key === 'f' || event.key === 'F') {
        event.preventDefault()
        onToggleFocus?.()
      } else if (event.key === 'b' || event.key === 'B') {
        event.preventDefault()
        bookmarkRef.current()
      } else if (event.key === '?') {
        event.preventDefault()
        setHelpOpen((value) => !value)
      } else if (event.key === 'g') {
        event.preventDefault()
        containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      } else if (event.key === 'G') {
        event.preventDefault()
        const root = containerRef.current
        if (root) root.scrollTo({ top: root.scrollHeight, behavior: 'smooth' })
      } else if (event.key === 'Escape') {
        if (helpOpen) {
          event.preventDefault()
          setHelpOpen(false)
          return
        }
        if (focusMode) {
          event.preventDefault()
          onToggleFocus?.()
          return
        }
        setSelection('')
        setToolbar(null)
        setEchoOpen(false)
        setPdfOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusMode, helpOpen, onNextChapter, onPrevChapter, onToggleFocus])
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
    setReadProgress(ratio)
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

  bookmarkRef.current = bookmarkHere

  useEffect(() => () => {
    if (celebrationTimerRef.current !== null) window.clearTimeout(celebrationTimerRef.current)
  }, [])

  function celebrate(message: string): void {
    setCelebration(message)
    if (celebrationTimerRef.current !== null) window.clearTimeout(celebrationTimerRef.current)
    celebrationTimerRef.current = window.setTimeout(() => setCelebration(null), 6000)
  }

  useEffect(() => {
    const streak = getReadingSummary().currentStreak
    const milestone = [100, 30, 7].find((value) => streak >= value)
    if (!milestone) return
    const flag = `reading-notes-streak-${milestone}`
    try {
      if (localStorage.getItem(flag)) return
      localStorage.setItem(flag, '1')
    } catch {
      // 存储不可用时只提示一次本次会话。
    }
    celebrate(`${t('连续阅读')} ${milestone} ${t('天')}`)
    return () => {
      if (celebrationTimerRef.current !== null) window.clearTimeout(celebrationTimerRef.current)
    }
    // 只在打开章节时检查一次连续天数里程碑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id])

  useEffect(() => {
    if (!chapter) return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastActivityRef.current > 120_000) return
      addReadingSeconds(15, chapter.bookId)
      sessionSecondsRef.current += 15
      if (dailyGoal <= 0) return
      const now = new Date()
      const dayKey = `reading-notes-goal-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      try {
        if (localStorage.getItem(dayKey)) return
      } catch {
        // 存储不可用时仍然可以在本次会话提示。
      }
      if (getReadingSummary().todaySeconds < dailyGoal * 60) return
      try {
        localStorage.setItem(dayKey, '1')
      } catch {
        // 忽略。
      }
      celebrate(`${t('今日阅读目标达成')} · ${dailyGoal} ${t('分钟')}`)
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [chapter?.id, dailyGoal])

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
    setReadProgress(0)
    setCountdown(null)
    autoNextSuppressed.current = false
  }, [chapter?.id])

  useEffect(() => {
    if (!autoNext || !onNextChapter || chapterIndex == null || chapterTotal == null) return
    if (chapterIndex + 1 >= chapterTotal || readProgress < 0.995) return
    if (autoNextSuppressed.current || countdown !== null) return
    setCountdown(3)
  }, [autoNext, chapterIndex, chapterTotal, countdown, onNextChapter, readProgress])

  useEffect(() => {
    if (countdown === null) return
    if (countdown <= 0) {
      setCountdown(null)
      onNextChapter?.()
      return
    }
    const timer = window.setTimeout(() => setCountdown((value) => (value == null ? null : value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown, onNextChapter])

  function toggleAutoNext(enabled: boolean): void {
    setAutoNextPreference(enabled)
    autoNextSuppressed.current = !enabled
    setCountdown(null)
    if (
      enabled &&
      onNextChapter &&
      chapterIndex != null &&
      chapterTotal != null &&
      chapterIndex + 1 < chapterTotal &&
      readProgress >= 0.995
    ) {
      setCountdown(3)
    }
  }

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
      {focusMode ? (
        <button type="button" className="focus-exit" onClick={onToggleFocus} aria-label={t('退出专注')} title={t('退出专注')}>
          ×
        </button>
      ) : null}
      {helpOpen ? (
        <div className="reader-help-backdrop" onMouseDown={() => setHelpOpen(false)}>
          <div
            className="reader-help"
            role="dialog"
            aria-modal="true"
            aria-label={t('阅读快捷键')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="reader-help-head">
              <strong>{t('阅读快捷键')}</strong>
              <button type="button" className="icon-button" onClick={() => setHelpOpen(false)} aria-label={t('关闭')}>
                ×
              </button>
            </div>
            <dl>
              <div><dt>← / →</dt><dd>{t('上一章 / 下一章')}</dd></div>
              <div><dt>j / k</dt><dd>{t('下一章 / 上一章')}</dd></div>
              <div><dt>f</dt><dd>{t('进入 / 退出专注')}</dd></div>
              <div><dt>b</dt><dd>{t('在当前位置加书签')}</dd></div>
              <div><dt>g / G</dt><dd>{t('跳到章首 / 章尾')}</dd></div>
              <div><dt>Esc</dt><dd>{t('关闭弹层或退出专注')}</dd></div>
              <div><dt>?</dt><dd>{t('显示 / 隐藏本帮助')}</dd></div>
            </dl>
          </div>
        </div>
      ) : null}
      {countdown !== null ? (
        <div className="auto-next-toast" role="status" aria-live="polite">
          <span>{countdown} {t('秒后进入下一章')}</span>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              autoNextSuppressed.current = true
              setCountdown(null)
            }}
          >
            {t('取消')}
          </button>
        </div>
      ) : null}
      {celebration ? (
        <div className="goal-toast" role="status" aria-live="polite">
          {celebration}
        </div>
      ) : null}
      <div className="reader-progress" aria-hidden="true">
        <span style={{ width: `${Math.round(readProgress * 100)}%` }} />
      </div>
      <div className="reader" ref={containerRef} onMouseUp={handleMouseUp} onScroll={handleReaderScroll}>
        {loading || !chapter ? (
          <div className="reader-skeleton">
            <div className="skeleton-line wide" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
          </div>
        ) : (
          <article style={{ maxWidth: `${style.maxWidth}px` }}>
            <header className="chapter-head">
              <div className="chapter-kicker">
                {chapter.partTitle && !chapter.isPart ? (
                  <span className="chapter-part">{chapter.partTitle}</span>
                ) : null}
                {chapter.partTitle && !chapter.isPart ? ' · ' : null}
                {chapter.isPart ? `${t('篇首')} · ` : null}
                {t('约')} {chapter.chars.toLocaleString()} {t('字')}
                {chapterIndex != null && chapterTotal != null && chapterTotal > 0
                  ? ` · ${chapterIndex + 1} / ${chapterTotal} ${t('章')}`
                  : ''}
                {` · ${t('预计')} ${Math.max(1, Math.round(chapter.chars / 400))} ${t('分钟')}`}
              </div>
              <h1>{chapter.title}</h1>
              <div className="chapter-head-actions">
                {onToggleFocus ? (
                  <button type="button" className="ghost-button small" onClick={onToggleFocus} title={t('专注阅读')}>
                    {focusMode ? t('退出专注') : t('专注')}
                  </button>
                ) : null}
                {onAdjustStyle ? (
                  <span className="reader-font-controls">
                    <button
                      type="button"
                      className="ghost-button small"
                      title={t('减小字号')}
                      onClick={() => onAdjustStyle({ fontSize: Math.max(13, style.fontSize - 1) })}
                    >
                      A−
                    </button>
                    <button
                      type="button"
                      className="ghost-button small"
                      title={t('增大字号')}
                      onClick={() => onAdjustStyle({ fontSize: Math.min(28, style.fontSize + 1) })}
                    >
                      A+
                    </button>
                  </span>
                ) : null}
                <button type="button" className="ghost-button small" onClick={onListen}>
                  {t('听读')}
                </button>
                <button type="button" className="ghost-button small" onClick={bookmarkHere}>
                  {t('书签')}
                </button>
                <button type="button" className="ghost-button small" onClick={onOpenXhs}>
                  {t('小红书')}
                </button>
                <button type="button" className="ghost-button small" onClick={onOpenFormat}>
                  {t('排版')}
                </button>

                <div className="reader-more" ref={moreRef}>
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
                    <div className="reader-more-menu" role="menu" aria-label={t('更多操作')}>
                      {pdfBookId ? (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMoreOpen(false)
                            setPdfOpen(true)
                          }}
                        >
                          {t('原版 PDF')}
                        </button>
                      ) : null}
                      {echoes.length > 0 ? (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMoreOpen(false)
                            setEchoOpen(true)
                          }}
                        >
                          {t('回声')} · {echoes.length}
                        </button>
                      ) : null}
                      {onSaveSummary && chapter ? (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMoreOpen(false)
                            setSummaryMinutes(Math.max(1, Math.round(sessionSecondsRef.current / 60)))
                            setSummaryOpen(true)
                          }}
                        >
                          {t('阅读小结')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoreOpen(false)
                          void window.api.copyText(`${chapter.title}\n\n${chapter.text}`).then(() => {
                            setFullCopied(true)
                            window.setTimeout(() => setFullCopied(false), 1600)
                          })
                        }}
                      >
                        {fullCopied ? t('已复制') : t('复制全文')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoreOpen(false)
                          void window.api.copyText(`thinread://book/${chapter.bookId}/chapter/${chapter.id}`)
                          setLinkCopied(true)
                          window.setTimeout(() => setLinkCopied(false), 1600)
                        }}
                      >
                        {linkCopied ? t('已复制链接') : t('复制深链')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoreOpen(false)
                          onRenameChapter()
                        }}
                      >
                        {t('改名')}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
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
                        <div className="page-marker">{t('第')} {marker[1]} {t('页')}</div>
                        <p>{paragraph.slice(marker[0].length)}</p>
                      </div>
                    )
                  }
                  return <p key={index}>{paragraph}</p>
                })}
              </div>
            )}
            <div className="chapter-end">
              {onNextChapter && chapterIndex != null && chapterTotal != null && chapterIndex + 1 < chapterTotal ? (
                <button type="button" className="primary-button" onClick={onNextChapter}>
                  {t('下一章')}
                </button>
              ) : (
                <span className="muted">{t('已经是最后一章')}</span>
              )}
              {onNextChapter && chapterIndex != null && chapterTotal != null && chapterIndex + 1 < chapterTotal ? (
                <label className="auto-next-toggle">
                  <input type="checkbox" checked={autoNext} onChange={(event) => toggleAutoNext(event.target.checked)} />
                  {t('读到底自动进入下一章')}
                </label>
              ) : null}
            </div>
          </article>
        )}
      </div>
      {toolbar && selection ? (
        <div className="selection-toolbar" role="toolbar" aria-label={t('选中文本操作')} style={{ left: toolbar.x, top: toolbar.y }}>
          <button
            type="button"
            onClick={() => {
              onCreateMark('highlight', selection)
              window.getSelection()?.removeAllRanges()
              setSelection('')
              setToolbar(null)
            }}
          >
            {t('高亮')}
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
            {t('划线')}
          </button>
          <button
            type="button"
            title={t('给选中文字加删除线')}
            onClick={() => {
              onCreateMark('strikethrough', selection)
              window.getSelection()?.removeAllRanges()
              setSelection('')
              setToolbar(null)
            }}
          >
            {t('删除')}
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
              {t('清除')}
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
            {t('问 AI')}
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
            {t('AI 边注')}
          </button>
          <button
            type="button"
            onClick={() => {
              onShareQuote(selection)
              setSelection('')
              setToolbar(null)
            }}
          >
            {t('分享')}
          </button>
          <button
            type="button"
            onClick={() => {
              onListenSelection(selection)
              setSelection('')
              setToolbar(null)
            }}
          >
            {t('朗读')}
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(`“${selection}”`)
              setToolbar(null)
            }}
          >
            {t('复制')}
          </button>
        </div>
      ) : null}
      {summaryOpen && chapter && onSaveSummary ? (
        <ReadingSummaryDialog
          chapterId={chapter.id}
          bookTitle={bookTitle}
          chapterTitle={chapter.title}
          minutes={summaryMinutes}
          onSave={onSaveSummary}
          onClose={() => setSummaryOpen(false)}
        />
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
