import { useEffect, useState, type JSX } from 'react'
import type { LabReport as LabReportData, LabRequest, LabToolId } from '../../shared/types.js'
import { listLabArtifacts, loadLabArtifact, parseArtifactMeta, saveLabArtifact } from '../lib/lab-artifacts.js'
import { labReportScope } from '../lib/lab-scope.js'
import { Markdown } from './Markdown.js'

interface LabReportProps {
  tool: LabToolId
  bookIds: string[]
  bookId: string
  chapterId: string
  question: string
  sourceLabel: string
  onSave(title: string, markdown: string, bookId: string, chapterId: string): Promise<void>
  onListen(title: string, text: string): void
}

const QUESTION_TOOLS = new Set<LabToolId>(['cross-book-synthesis', 'reading-path', 'view-timeline', 'margin-note'])
const CHAPTER_TOOLS = new Set<LabToolId>([
  'argument-map',
  'chapter-annotations',
  'margin-note',
  'fact-check',
  'podcast',
  'adaptive-quiz',
  'devils-advocate',
  'book-club',
])
const BOOK_TOOLS = new Set<LabToolId>(['cross-book-synthesis', 'reading-path'])
const SINGLE_BOOK_TOOLS = new Set<LabToolId>(['entity-network'])

export function LabReport({ tool, bookIds, bookId, chapterId, question, sourceLabel, onSave, onListen }: LabReportProps): JSX.Element {
  const [result, setResult] = useState<LabReportData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'copied' | 'saved'>('idle')
  const [storedRequest, setStoredRequest] = useState<LabRequest | null>(null)
  const [history, setHistory] = useState<Awaited<ReturnType<typeof listLabArtifacts>>>([])
  const [selectedId, setSelectedId] = useState('')
  const scopeKey = labReportScope(tool, bookIds, bookId, chapterId, question)

  useEffect(() => {
    let cancelled = false
    setResult(null)
    setError(null)
    setStatus('idle')
    setStoredRequest(null)
    setSelectedId('')
    void loadLabArtifact(tool, scopeKey).then((artifact) => {
      if (cancelled || !artifact) return
      setResult({ title: artifact.title, markdown: artifact.content })
      setSelectedId(artifact.id)
      const meta = parseArtifactMeta(artifact)
      if (meta.request) setStoredRequest(meta.request)
    })
    void listLabArtifacts(tool).then((items) => {
      if (!cancelled) setHistory(items)
    })
    return () => {
      cancelled = true
    }
  }, [tool, scopeKey])

  const needsQuestion = QUESTION_TOOLS.has(tool)
  const needsChapter = CHAPTER_TOOLS.has(tool)
  const ready = (!needsQuestion || question.trim().length > 0) && (!needsChapter || chapterId.trim().length > 0)

  async function run(requestOverride?: LabRequest): Promise<void> {
    if (busy) return
    if (!requestOverride && !ready) return
    const request = requestOverride ?? {
      tool,
      bookIds:
        !needsChapter && (BOOK_TOOLS.has(tool) || SINGLE_BOOK_TOOLS.has(tool))
          ? SINGLE_BOOK_TOOLS.has(tool)
            ? bookId ? [bookId] : undefined
            : bookIds.length > 0
              ? bookIds
              : undefined
          : undefined,
      chapterId: needsChapter ? chapterId || undefined : undefined,
      question: question.trim() || undefined,
    }
    setBusy(true)
    setError(null)
    setStatus('idle')
    try {
      let next: LabReportData
      if (request.tool === 'margin-note') {
        next = await window.api.marginNote(request.chapterId ?? '', request.question ?? '')
      } else {
        next = await window.api.runLab(request)
      }
      setResult(next)
      setStoredRequest(request)
      const saveScope = requestOverride
        ? labReportScope(request.tool, request.bookIds ?? [], bookId, request.chapterId ?? '', request.question ?? '')
        : scopeKey
      void saveLabArtifact(tool, next.title, next.markdown, { request, label: sourceLabel }, saveScope)
        .then((saved) => {
          setSelectedId(saved.id)
          return listLabArtifacts(tool)
        })
        .then(setHistory)
        .catch(() => undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function copy(): Promise<void> {
    if (!result) return
    await window.api.copyText(result.markdown)
    setStatus('copied')
    window.setTimeout(() => setStatus('idle'), 1600)
  }

  async function save(): Promise<void> {
    if (!result) return
    try {
      await onSave(result.title, result.markdown, bookId || bookIds[0] || '', needsChapter ? chapterId : '')
      setStatus('saved')
      window.setTimeout(() => setStatus('idle'), 1600)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function exportFile(): Promise<void> {
    if (!result) return
    try {
      await window.api.saveMarkdown(`${result.title}.md`, result.markdown)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="lab-report">
      <div className="lab-run-row">
        <span className="lab-run-hint">
          {needsQuestion && !question.trim() ? '先填写主题或原文' : needsChapter && !chapterId ? '先选择章节' : '准备好后运行'}
        </span>
        <button type="button" className="primary-button small" onClick={() => void run()} disabled={!ready || busy}>
          {busy ? '生成中…' : '运行'}
        </button>
      </div>
      {error ? <div className="inline-error">{error}</div> : null}
      {result ? (
        <div className="lab-result">
          {history.length > 1 ? (
            <label className="lab-history">
              历史
              <select
                value={selectedId}
                onChange={(event) => {
                  const artifact = history.find((item) => item.id === event.target.value)
                  if (!artifact) return
                  setResult({ title: artifact.title, markdown: artifact.content })
                  setSelectedId(artifact.id)
                  const meta = parseArtifactMeta(artifact)
                  setStoredRequest(meta.request ?? null)
                }}
                aria-label="历史生成结果"
              >
                {history.map((artifact) => {
                  const meta = parseArtifactMeta(artifact)
                  return (
                    <option key={artifact.id} value={artifact.id}>
                      {(meta.label || artifact.scope).slice(0, 24)} · {artifact.createdAt.slice(5, 16).replace('T', ' ')}
                    </option>
                  )
                })}
              </select>
            </label>
          ) : null}
          <div className="lab-result-head">
            <h3>{result.title}</h3>
            <div className="lab-result-actions">
              {tool === 'podcast' ? (
                <button type="button" className="text-button" onClick={() => onListen(result.title, result.markdown)}>
                  听
                </button>
              ) : null}
              <button type="button" className="text-button" onClick={() => void copy()}>
                {status === 'copied' ? '已复制' : '复制'}
              </button>
              <button type="button" className="text-button" onClick={() => void exportFile()}>
                导出
              </button>
              <button type="button" className="text-button" onClick={() => void run(storedRequest ?? undefined)} disabled={busy}>
                重新生成
              </button>
              <button type="button" className="text-button" onClick={() => void save()}>
                {status === 'saved' ? '已存为笔记' : '存为笔记'}
              </button>
            </div>
          </div>
          <div className="lab-markdown">
            <Markdown text={result.markdown} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
