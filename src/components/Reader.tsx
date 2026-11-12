import { bridge } from '../lib/bridge.js'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type JSX } from 'react'

import type {
  BookTranslationInfo,
  BookTranslationProgress,
  ChapterContent,
  ReaderMark,
  ReaderMarkStyle,
  ReaderStyle,
  RelatedNote,
} from '../../shared/types.js'
import { t, useLocale } from '../lib/i18n.js'
import { messageOf } from '../lib/errors.js'
import { enhanceCodeBlocks, handleCodeAssistClick, handleCodeBlockClick } from '../lib/enhance-code-blocks.js'
import { enhanceImages, handleImageCopyClick, handleImageUnderstandClick } from '../lib/enhance-images.js'
import { getAutoNext, getDailyGoal, setAutoNext as setAutoNextPreference, subscribePreferences } from '../lib/preferences.js'
import { addReadingSeconds, getReadingSummary } from '../lib/reading-stats.js'
import { focusSentenceAt, unwrapSentences, wrapSentences } from '../lib/sentence-focus.js'
import { CitationDialog } from './CitationDialog.js'
import { CodeReviewDialog } from './CodeReviewDialog.js'
import { EchoDialog } from './EchoDialog.js'
import { PdfOriginalView } from './PdfOriginalView.js'
import { ReadingSummaryDialog } from './ReadingSummaryDialog.js'

interface ReaderProps {
  chapter: ChapterContent | null
  loading: boolean
  style: ReaderStyle
  bookTitle: string
  bookAuthor: string
  scrollTarget: { quote: string; key: number } | null
  echoes: RelatedNote[]
  excerpt: string
  translatedText: string | null
  translatedHtml: string | null
  hasTranslation: boolean
  showTranslation: boolean
  translationBusy: boolean
  translationProgress: { done: number; total: number } | null
  onToggleTranslation(): void
  onRetranslateTranslation(): void
  bookForeign: boolean
  bookTranslation: BookTranslationInfo | null
  bookTranslationRunning: boolean
  bookTranslationProgress: BookTranslationProgress | null
  onTranslateBook(): void
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
  onNotify?(toast: { kind: 'error' | 'info'; text: string }): void
}

/** 旧版本解析出的章节会把标题重复放进正文；渲染时去掉与章节标题相同的前导标题文本。 */
import { ReaderSelectionToolbar } from './ReaderSelectionToolbar.js'

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

type MoreMenuIcon = 'pdf' | 'echo' | 'summary' | 'copy' | 'link' | 'cite' | 'focus' | 'rename' | 'translate'

function MoreMenuGlyph({ kind }: { kind: MoreMenuIcon }): JSX.Element {
  const paths: Record<MoreMenuIcon, JSX.Element> = {
    pdf: (
      <>
        <path d="M5 2.75h6.5L15 6.25v11H5z" />
        <path d="M11.5 2.75v3.5H15" />
        <path d="M7.5 10h5M7.5 13h5" />
      </>
    ),
    echo: (
      <>
        <path d="M4 8c2-2.5 3 2.5 5 0s3 2.5 5 0 2 2.5 2 2.5" />
        <path d="M4 13c2-2.5 3 2.5 5 0s3 2.5 5 0 2 2.5 2 2.5" />
      </>
    ),
    summary: (
      <>
        <path d="M5 3h10v14H5z" />
        <path d="M8 7h4M8 10h4M8 13h2" />
      </>
    ),
    copy: (
      <>
        <rect x="7" y="7" width="8" height="9" rx="1.5" />
        <path d="M12 7V4.5A1.5 1.5 0 0 0 10.5 3H5.5A1.5 1.5 0 0 0 4 4.5v8A1.5 1.5 0 0 0 5.5 14H7" />
      </>
    ),
    link: (
      <>
        <path d="M8 12l4-4" />
        <path d="M7 14H6a3 3 0 0 1 0-6h2" />
        <path d="M13 6h1a3 3 0 0 1 0 6h-2" />
      </>
    ),
    cite: (
      <>
        <path d="M5 8h4v5H5zM11 8h4v5h-4z" />
        <path d="M7 8V6.5A1.5 1.5 0 0 1 8.5 5M13 8V6.5A1.5 1.5 0 0 1 14.5 5" />
      </>
    ),
    focus: (
      <>
        <circle cx="10" cy="10" r="5.5" />
        <circle cx="10" cy="10" r="1.5" />
        <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2" />
      </>
    ),
    rename: (
      <>
        <path d="M4 16l1-4 8-8 3 3-8 8z" />
        <path d="M11.5 5.5l3 3" />
      </>
    ),
    translate: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="M3 10h14" />
        <path d="M10 3c2 2.5 3 4.8 3 7s-1 4.5-3 7c-2-2.5-3-4.8-3-7s1-4.5 3-7z" />
      </>
    ),
  }
  return (
    <svg
      viewBox="0 0 20 20"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  )
}

export function Reader({
  chapter,
  loading,
  style,
  bookTitle,
  bookAuthor,
  scrollTarget,
  echoes,
  excerpt,
  translatedText,
  translatedHtml,
  hasTranslation,
  showTranslation,
  translationBusy,
  translationProgress,
  onToggleTranslation,
  onRetranslateTranslation,
  bookForeign,
  bookTranslation,
  bookTranslationRunning,
  bookTranslationProgress,
  onTranslateBook,
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
  onNotify,
}: ReaderProps): JSX.Element {
  const locale = useLocale()
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const positionTimerRef = useRef<number | null>(null)
  const progressTimerRef = useRef<number | null>(null)
  const latestProgressRef = useRef(0)
  const pendingRatioRef = useRef<number | null>(null)
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
  const [citationOpen, setCitationOpen] = useState(false)
  const [sentenceFocus, setSentenceFocus] = useState(false)
  const [summaryMinutes, setSummaryMinutes] = useState(1)
  const [moreOpen, setMoreOpen] = useState(false)
  const [localHtml, setLocalHtml] = useState<string | null>(null)
  const [understandingImages, setUnderstandingImages] = useState(false)
  const [imageStatus, setImageStatus] = useState<string | null>(null)
  const [imageStatusError, setImageStatusError] = useState(false)
  const understandingRef = useRef(false)
  const codeAssistRef = useRef(false)
  const [editing, setEditing] = useState(false)
  const [savingBody, setSavingBody] = useState(false)
  const [codeReview, setCodeReview] = useState<{
    open: boolean
    loading: boolean
    code: string
    language: string
    review: string
    error: string | null
    model: string
  } | null>(null)
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
    const source = localHtml ?? chapter?.formattedHtml ?? chapter?.html
    return source ? stripDuplicateTitle(source, chapter?.title ?? '') : null
  }, [localHtml, chapter?.formattedHtml, chapter?.html, chapter?.title])

  const imageCount = useMemo(() => (html?.match(/<img\b/gi) ?? []).length, [html])

  async function understandImages(single?: string): Promise<void> {
    const root = containerRef.current
    if (!root || !chapter || understandingRef.current) return
    const all = [...root.querySelectorAll('img')]
      .filter((img) => img.dataset.imageUnderstood !== '1')
      .map((img) => img.currentSrc || img.src)
      .filter(Boolean)
    const targets = single ? [single] : [...new Set(all)]
    if (targets.length === 0) {
      const message = t('这一章没有需要理解的图片')
      setImageStatus(message)
      setImageStatusError(false)
      onNotify?.({ kind: 'info', text: message })
      return
    }
    understandingRef.current = true
    setUnderstandingImages(true)
    setImageStatusError(false)
    let understood = 0
    let usedModel = ''
    try {
      for (let index = 0; index < targets.length; index++) {
        setImageStatus(
          targets.length > 1
            ? `${t('理解图片中')} ${index + 1}/${targets.length}`
            : t('理解图片中…'),
        )
        const result = await bridge.understandChapterImage(chapter.id, targets[index]!)
        if (result.html) setLocalHtml(result.html)
        usedModel = result.model || usedModel
        understood += result.understood
      }
      const message = `${t('已理解')} ${understood} ${t('张图片')}${usedModel ? ` · ${usedModel}` : ''}`
      setImageStatus(message)
      if (understood > 0) onNotify?.({ kind: 'info', text: message })
      window.setTimeout(() => setImageStatus(null), 2200)
    } catch (error) {
      const message = messageOf(error)
      setImageStatus(message)
      setImageStatusError(true)
      onNotify?.({ kind: 'error', text: message })
    } finally {
      understandingRef.current = false
      setUnderstandingImages(false)
    }
  }

  async function runCodeAssist(input: { action: 'review' | 'explain' | 'fix'; code: string; language: string }): Promise<void> {
    if (!chapter || codeAssistRef.current) return
    codeAssistRef.current = true
    if (input.action === 'review') {
      setCodeReview({
        open: true,
        loading: true,
        code: input.code,
        language: input.language,
        review: '',
        error: null,
        model: '',
      })
      try {
        const result = await bridge.codeAssist(chapter.id, input.code, 'review', input.language)
        setCodeReview((current) =>
          current
            ? { ...current, loading: false, review: result.text, model: result.model ?? '' }
            : current,
        )
      } catch (error) {
        const message = messageOf(error)
        setCodeReview((current) => (current ? { ...current, loading: false, error: message } : current))
      } finally {
        codeAssistRef.current = false
      }
      return
    }

    if (input.action === 'fix') {
      try {
        const result = await bridge.codeAssist(chapter.id, input.code, 'fix', input.language)
        if (result.html) setLocalHtml(result.html)
        onNotify?.({
          kind: 'info',
          text: result.changed
            ? `${t('已修复代码')}${result.model ? ` · ${result.model}` : ''}`
            : t('代码没有需要修复的地方'),
        })
      } catch (error) {
        onNotify?.({ kind: 'error', text: messageOf(error) })
      } finally {
        codeAssistRef.current = false
      }
      return
    }

    try {
      const result = await bridge.codeAssist(chapter.id, input.code, 'explain', input.language)
      if (result.html) setLocalHtml(result.html)
      onNotify?.({
        kind: 'info',
        text: `${t('已理解代码')}${result.model ? ` · ${result.model}` : ''}`,
      })
    } catch (error) {
      onNotify?.({ kind: 'error', text: messageOf(error) })
    } finally {
      codeAssistRef.current = false
    }
  }

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

  // 译文和原文长度不同，切换视图时字数与预计时间要跟着当前显示的内容走。
  const displayChars =
    showTranslation && (translatedHtml || translatedText)
      ? (translatedText?.length ?? chapter?.chars ?? 0)
      : (chapter?.chars ?? 0)

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
    setLocalHtml(null)
    setImageStatus(null)
    setImageStatusError(false)
    setEditing(false)
  }, [chapter?.id, chapter?.formattedHtml])

  // 正文 HTML 是原生节点；在 DOM 层补上代码块的语言标签、折叠和复制。
  useEffect(() => {
    const root = containerRef.current
    if (!root || editing) return
    const enhance = (): void => {
      enhanceCodeBlocks(root)
      enhanceImages(root)
    }
    enhance()
    const observer = new MutationObserver(enhance)
    observer.observe(root, { childList: true, subtree: true })
    const onClick = (event: MouseEvent): void => {
      const codeAssist = handleCodeAssistClick(event, root)
      if (codeAssist) {
        void runCodeAssist(codeAssist)
        return
      }
      if (handleCodeBlockClick(event, root)) return
      const imageSrc = handleImageUnderstandClick(event, root)
      if (imageSrc) {
        void understandImages(imageSrc)
        return
      }
      handleImageCopyClick(event, root)
    }
    root.addEventListener('click', onClick)
    return () => {
      observer.disconnect()
      root.removeEventListener('click', onClick)
    }
  }, [chapter?.id, locale, showTranslation, editing])

  // 逐句专注：把纯文本段落拆成句子，点击某句时只保留这一句。
  useEffect(() => {
    const root = containerRef.current
    if (!root || !sentenceFocus || editing) return
    wrapSentences(root)
    const onClick = (event: MouseEvent): void => {
      if (focusSentenceAt(event, root)) event.stopPropagation()
    }
    root.addEventListener('click', onClick, true)
    return () => {
      root.removeEventListener('click', onClick, true)
      unwrapSentences(root)
    }
  }, [chapter?.id, locale, sentenceFocus, showTranslation, editing])

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
        const position = await bridge.getReadingPosition(chapter.id).catch(() => null)
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

  function toggleTranslationView(): void {
    const root = containerRef.current
    if (root) {
      const max = Math.max(0, root.scrollHeight - root.clientHeight)
      pendingRatioRef.current = max > 0 ? root.scrollTop / max : 0
    }
    onToggleTranslation()
  }

  useEffect(() => {
    const ratio = pendingRatioRef.current
    if (ratio === null) return
    pendingRatioRef.current = null
    const root = containerRef.current
    if (!root) return
    const frame = window.requestAnimationFrame(() => {
      const max = Math.max(0, root.scrollHeight - root.clientHeight)
      root.scrollTop = Math.max(0, Math.min(max, ratio * max))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [showTranslation])

  function handleReaderScroll(): void {
    setToolbar((current) => (current ? null : current))
    const root = containerRef.current
    if (!root || !chapter || loading || restoringRef.current) return
    if (positionTimerRef.current) window.clearTimeout(positionTimerRef.current)
    const max = Math.max(0, root.scrollHeight - root.clientHeight)
    const scrollTop = root.scrollTop
    const ratio = max > 0 ? scrollTop / max : 0
    // 滚动事件非常密集；进度条只需要约 10fps，避免整章反复重渲染。
    latestProgressRef.current = ratio
    if (progressTimerRef.current === null) {
      progressTimerRef.current = window.setTimeout(() => {
        progressTimerRef.current = null
        setReadProgress(latestProgressRef.current)
      }, 100)
    }
    const bookId = chapter.bookId
    const chapterId = chapter.id
    positionTimerRef.current = window.setTimeout(() => {
      void bridge
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
      if (progressTimerRef.current) window.clearTimeout(progressTimerRef.current)
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
  }, [marks, html, chapter?.id, loading, sentenceFocus, showTranslation])

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

  async function saveBody(): Promise<void> {
    if (!chapter || !contentRef.current || savingBody) return
    setSavingBody(true)
    try {
      const result = await bridge.saveChapterContent(chapter.id, contentRef.current.innerHTML)
      setLocalHtml(result.html)
      setEditing(false)
      onNotify?.({ kind: 'info', text: t('已保存正文') })
    } catch (error) {
      onNotify?.({ kind: 'error', text: messageOf(error) })
    } finally {
      setSavingBody(false)
    }
  }

  useEffect(() => {
    if (!editing) return
    function onKey(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveBody()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setEditing(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editing, savingBody, chapter?.id])

  function handleMouseUp(): void {
    if (editing) return
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
      <div
        className={`reader${sentenceFocus ? ' is-sentence-focus' : ''}`}
        ref={containerRef}
        onMouseUp={handleMouseUp}
        onScroll={handleReaderScroll}
      >
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
                {t('约')} {displayChars.toLocaleString()} {t('字')}
                {chapterIndex != null && chapterTotal != null && chapterTotal > 0
                  ? ` · ${chapterIndex + 1} / ${chapterTotal} ${t('章')}`
                  : ''}
                {` · ${t('预计')} ${Math.max(1, Math.round(displayChars / 400))} ${t('分钟')}`}
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

                {bookForeign ? (
                  <button
                    type="button"
                    className={`ghost-button small${showTranslation && translatedHtml ? ' is-active' : ''}`}
                    onClick={() => {
                      if (hasTranslation && !translatedHtml) onRetranslateTranslation()
                      else toggleTranslationView()
                    }}
                    disabled={(translationBusy || bookTranslationRunning) && !translatedHtml}
                    title={
                      hasTranslation && !translatedHtml
                        ? t('用新格式重新翻译，保留标题和表格')
                        : hasTranslation
                          ? showTranslation
                            ? t('切回原文')
                            : t('查看 AI 译文')
                          : t('把这章原文翻译成简体中文')
                    }
                  >
                    {translationBusy && !translatedHtml
                      ? translationProgress
                        ? `${t('翻译中')} ${translationProgress.done}/${translationProgress.total}`
                        : t('翻译中…')
                      : !hasTranslation
                        ? t('翻译')
                        : !translatedHtml
                          ? t('重新翻译')
                          : showTranslation
                            ? t('原文')
                            : t('译文')}
                  </button>
                ) : null}

                {html ? (
                  editing ? (
                    <>
                      <button
                        type="button"
                        className="primary-button small"
                        onClick={() => void saveBody()}
                        disabled={savingBody}
                      >
                        {savingBody ? t('保存中…') : t('保存正文')}
                      </button>
                      <button
                        type="button"
                        className="ghost-button small"
                        onClick={() => setEditing(false)}
                        disabled={savingBody}
                      >
                        {t('取消')}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="ghost-button small" onClick={() => setEditing(true)}>
                      {t('编辑正文')}
                    </button>
                  )
                ) : null}
                {!editing && imageCount > 0 ? (
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={() => void understandImages()}
                    disabled={understandingImages}
                    title={t('理解本章图片，并把说明插入正文')}
                  >
                    {understandingImages ? t('理解图片中…') : t('理解图片')}
                  </button>
                ) : null}
                {imageStatus ? (
                  <span className={`reader-image-status${imageStatusError ? ' is-error' : ''}`} title={imageStatus}>{imageStatus}</span>
                ) : null}

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
                          <span className="reader-more-icon"><MoreMenuGlyph kind="pdf" /></span>
                          <span>{t('原版 PDF')}</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoreOpen(false)
                          setEchoOpen(true)
                        }}
                      >
                        <span className="reader-more-icon"><MoreMenuGlyph kind="echo" /></span>
                        <span>{t('相关笔记')}{echoes.length > 0 ? ` · ${echoes.length}` : ''}</span>
                      </button>
                      {bookForeign ? (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={bookTranslationRunning}
                          onClick={() => {
                            setMoreOpen(false)
                            onTranslateBook()
                          }}
                        >
                          <span className="reader-more-icon"><MoreMenuGlyph kind="translate" /></span>
                          <span>
                            {bookTranslationRunning
                              ? bookTranslationProgress
                                ? `${t('翻译全书中')} ${bookTranslationProgress.done}/${bookTranslationProgress.total}`
                                : t('翻译全书中…')
                              : bookTranslation && bookTranslation.translated < bookTranslation.total
                                ? `${t('翻译全书')}${
                                    bookTranslation.translated > 0
                                      ? ` · ${t('剩余')} ${bookTranslation.total - bookTranslation.translated} ${t('章')}`
                                      : ''
                                  }`
                                : t('重新翻译全书')}
                          </span>
                        </button>
                      ) : null}
                      {bookForeign && hasTranslation ? (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={translationBusy}
                          onClick={() => {
                            setMoreOpen(false)
                            onRetranslateTranslation()
                          }}
                        >
                          <span className="reader-more-icon"><MoreMenuGlyph kind="translate" /></span>
                          <span>{t('重新翻译')}</span>
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
                          <span className="reader-more-icon"><MoreMenuGlyph kind="summary" /></span>
                          <span>{t('阅读小结')}</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoreOpen(false)
                          void bridge.copyText(`${chapter.title}\n\n${chapter.text}`).then(() => {
                            setFullCopied(true)
                            window.setTimeout(() => setFullCopied(false), 1600)
                          })
                        }}
                      >
                        <span className="reader-more-icon"><MoreMenuGlyph kind="copy" /></span>
                        <span>{fullCopied ? t('已复制') : t('复制全文')}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoreOpen(false)
                          void bridge.copyText(`thinread://book/${chapter.bookId}/chapter/${chapter.id}`)
                          setLinkCopied(true)
                          window.setTimeout(() => setLinkCopied(false), 1600)
                        }}
                      >
                        <span className="reader-more-icon"><MoreMenuGlyph kind="link" /></span>
                        <span>{linkCopied ? t('已复制链接') : t('复制深链')}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoreOpen(false)
                          setCitationOpen(true)
                        }}
                      >
                        <span className="reader-more-icon"><MoreMenuGlyph kind="cite" /></span>
                        <span>{t('导出引用')}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        aria-pressed={sentenceFocus}
                        onClick={() => {
                          setMoreOpen(false)
                          setSentenceFocus((value) => !value)
                        }}
                      >
                        <span className="reader-more-icon"><MoreMenuGlyph kind="focus" /></span>
                        <span>{sentenceFocus ? t('退出逐句') : t('逐句专注')}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoreOpen(false)
                          onRenameChapter()
                        }}
                      >
                        <span className="reader-more-icon"><MoreMenuGlyph kind="rename" /></span>
                        <span>{t('改名')}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </header>
            {showTranslation && (translatedHtml || translatedText) ? (
              translatedHtml ? (
                <div
                  className="chapter-html translated-text"
                  style={contentStyle}
                  dangerouslySetInnerHTML={{ __html: translatedHtml }}
                />
              ) : (
                <div className="chapter-plain translated-text" style={contentStyle}>
                  {(translatedText ?? '').split(/\n{2,}/).map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
              )
            ) : html ? (
              <div
                key={editing ? 'editing' : 'viewing'}
                ref={contentRef}
                className={`chapter-html${editing ? ' is-editing' : ''}`}
                style={contentStyle}
                contentEditable={editing}
                suppressContentEditableWarning
                spellCheck={false}
                dangerouslySetInnerHTML={{ __html: html }}
              />
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
        <ReaderSelectionToolbar
          x={toolbar.x}
          y={toolbar.y}
          selection={selection}
          selectedMarkIds={selectedMarks.map((mark) => mark.id)}
          onCreateMark={onCreateMark}
          onClearMarks={onClearMarks}
          onAsk={onAsk}
          onMarginNote={onMarginNote}
          onShareQuote={onShareQuote}
          onListenSelection={onListenSelection}
          onDismiss={() => {
            setSelection('')
            setToolbar(null)
          }}
        />
      ) : null}
      <CodeReviewDialog
        open={Boolean(codeReview?.open)}
        loading={codeReview?.loading ?? false}
        code={codeReview?.code ?? ''}
        language={codeReview?.language ?? ''}
        review={codeReview?.review ?? ''}
        error={codeReview?.error ?? null}
        model={codeReview?.model ?? ''}
        onClose={() => setCodeReview(null)}
      />

      {citationOpen ? (
        <CitationDialog
          open={citationOpen}
          title={bookTitle}
          author={bookAuthor}
          onClose={() => setCitationOpen(false)}
        />
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
