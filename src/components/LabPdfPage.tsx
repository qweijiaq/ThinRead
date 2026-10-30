import { useEffect, useState, type JSX } from 'react'
import type { BookSummary, LabReport } from '../../shared/types.js'
import { Markdown } from './Markdown.js'
import { Select } from './Select.js'

interface LabPdfPageProps {
  books: BookSummary[]
}

export function LabPdfPage({ books }: LabPdfPageProps): JSX.Element {
  const pdfs = books.filter((book) => book.format === 'pdf' || book.format === 'pdf-ocr')
  const [bookId, setBookId] = useState(pdfs[0]?.id ?? '')
  const [page, setPage] = useState('1')
  const [result, setResult] = useState<LabReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.getLabArtifact('lab-pdf-page').then((artifact) => {
      if (cancelled || !artifact) {
        return
      }
      try {
        const parsed = JSON.parse(artifact.content) as { bookId?: string; page?: number; result?: LabReport }
        if (parsed.bookId && pdfs.some((book) => book.id === parsed.bookId)) setBookId(parsed.bookId)
        if (parsed.page) setPage(String(parsed.page))
        if (parsed.result) setResult(parsed.result)
      } catch {
        // 忽略旧格式。
      }
    })
    return () => {
      cancelled = true
    }
  }, [pdfs.length])

  useEffect(() => {
    if (!pdfs.some((book) => book.id === bookId)) setBookId(pdfs[0]?.id ?? '')
  }, [pdfs, bookId])

  useEffect(() => {
    if (!bookId) return
    const pageNumber = Number(page)
    if (!Number.isFinite(pageNumber) || pageNumber < 1) return
    let cancelled = false
    void window.api
      .getLabArtifact('lab-pdf-page', `pdf:${bookId}:${pageNumber}`)
      .then((artifact) => {
        if (cancelled) return
        if (!artifact) {
          setResult(null)
          return
        }
        try {
          const parsed = JSON.parse(artifact.content) as { result?: LabReport }
          setResult(parsed.result ?? { title: artifact.title, markdown: artifact.content })
        } catch {
          setResult({ title: artifact.title, markdown: artifact.content })
        }
      })
    return () => {
      cancelled = true
    }
  }, [bookId, page])

  async function analyze(): Promise<void> {
    const pageNumber = Number(page)
    if (!bookId || !Number.isFinite(pageNumber) || pageNumber < 1 || busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const next = await window.api.analyzePdfPage(bookId, pageNumber)
      setResult(next)
      void window.api
        .saveLabArtifact({
          tool: 'lab-pdf-page',
          scope: `pdf:${bookId}:${pageNumber}`,
          title: next.title,
          content: JSON.stringify({ bookId, page: pageNumber, result: next }),
        })
        .catch(() => undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (pdfs.length === 0) {
    return <p className="lab-empty">书库里还没有 PDF。导入一本扫描版或带图表的 PDF 后，可以在这里按页理解。</p>
  }

  return (
    <div className="lab-pdf">
      <div className="lab-pdf-form">
        <label>
          选择 PDF
          <Select
            value={bookId}
            onChange={setBookId}
            ariaLabel="选择 PDF"
            options={pdfs.map((book) => ({ value: book.id, label: book.title }))}
          />
        </label>
        <label>
          页码
          <input value={page} onChange={(event) => setPage(event.target.value)} inputMode="numeric" />
        </label>
        <button type="button" className="primary-button small" onClick={() => void analyze()} disabled={busy || !bookId}>
          {busy ? '识别中…' : result ? '重新识别' : '理解这一页'}
        </button>
      </div>
      <p className="lab-run-hint">用 macOS Vision 在本机渲染并识别这一页；图表会按坐标轴、关键数据和趋势解释。</p>
      {error ? <div className="inline-error">{error}</div> : null}
      {result ? (
        <div className="lab-result">
          <div className="lab-result-head">
            <h3>{result.title}</h3>
            <button type="button" className="text-button" onClick={() => void window.api.copyText(result.markdown)}>
              复制
            </button>
          </div>
          <div className="lab-markdown">
            <Markdown text={result.markdown} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
