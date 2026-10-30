import { useEffect, useRef, useState, type JSX } from 'react'
import type { ChapterContent, FeynmanResult } from '../../shared/types.js'

interface FeynmanPanelProps {
  chapter: ChapterContent | null
  bookTitle: string
  hasNotes: boolean
  onSave(text: string): Promise<void>
}

export function FeynmanPanel({ chapter, bookTitle, hasNotes, onSave }: FeynmanPanelProps): JSX.Element {
  const [explanation, setExplanation] = useState('')
  const [result, setResult] = useState<FeynmanResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const chapterRef = useRef<string | null>(chapter?.id ?? null)

  useEffect(() => {
    chapterRef.current = chapter?.id ?? null
    setExplanation('')
    setResult(null)
    setError(null)
    setSaved(false)
    setHydrated(false)
    if (!chapter) return
    let cancelled = false
    void window.api.getLabArtifact('feynman', chapter.id).then((artifact) => {
      if (cancelled) return
      if (artifact) {
        try {
          const parsed = JSON.parse(artifact.content) as { explanation?: string; result?: FeynmanResult }
          if (typeof parsed.explanation === 'string') setExplanation(parsed.explanation)
          if (parsed.result) setResult(parsed.result)
        } catch {
          // 忽略旧格式。
        }
      }
      setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [chapter?.id])

  useEffect(() => {
    if (!hydrated || !chapter) return
    const timer = window.setTimeout(() => {
      void window.api
        .saveLabArtifact({
          tool: 'feynman',
          scope: chapter.id,
          title: '讲给我听',
          content: JSON.stringify({ explanation, result }),
        })
        .catch(() => undefined)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [hydrated, chapter?.id, explanation, result])

  async function evaluate(): Promise<void> {
    if (!chapter || busy) return
    const chapterId = chapter.id
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      const next = await window.api.evaluateExplanation(chapterId, explanation)
      if (chapterRef.current === chapterId) setResult(next)
    } catch (err) {
      if (chapterRef.current === chapterId) setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function save(): Promise<void> {
    if (!result) return
    const content = [
      '我的解释：',
      explanation.trim(),
      '',
      `反馈：${result.feedback}`,
      result.covered.length ? `已覆盖：${result.covered.join('；')}` : '',
      result.missing.length ? `还缺：${result.missing.join('；')}` : '',
      result.misconceptions.length ? `理解偏差：${result.misconceptions.join('；')}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    try {
      await onSave(content)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const totalPoints = result ? result.covered.length + result.missing.length : 0
  const coverage = result && totalPoints > 0 ? Math.round((result.covered.length / totalPoints) * 100) : null

  return (
    <div className="feynman-panel">
      <div className="feynman-head">
        <div>
          <h2>讲给我听</h2>
          <p>{bookTitle ? `${bookTitle} · ` : ''}{chapter?.title ?? '选择一章开始'}</p>
        </div>
        <button
          type="button"
          className="ghost-button small"
          onClick={() => {
            setExplanation('')
            setResult(null)
            setSaved(false)
          }}
          disabled={busy}
        >
          清空
        </button>
      </div>
      <p className="feynman-hint">
        不看笔记，用自己的话把这一章讲清楚。AI 会对照读薄稿和卡片，指出讲对、漏掉和理解偏的地方。
      </p>
      {!hasNotes ? <p className="feynman-warning">这一章还没有读薄稿。先生成笔记，检查会更准确；也可以先凭记忆试一次。</p> : null}

      <textarea
        className="feynman-input"
        value={explanation}
        onChange={(event) => setExplanation(event.target.value)}
        placeholder="例如：这一章主要讲了三件事……"
        rows={7}
        disabled={!chapter || busy}
      />
      <div className="feynman-actions">
        <span className="muted">{explanation.trim().length} 字</span>
        <button
          type="button"
          className="primary-button small"
          onClick={() => void evaluate()}
          disabled={!chapter || busy || explanation.trim().length < 12}
        >
          {busy ? '正在对照…' : '检查我的理解'}
        </button>
      </div>

      {error ? <div className="inline-error">{error}</div> : null}

      {result ? (
        <div className="feynman-result">
          <div className="feynman-score">
            <div>
              <span>覆盖度</span>
              <strong>{coverage == null ? '—' : `${coverage}%`}</strong>
            </div>
            <div className="feynman-meter">
              <span style={{ width: `${coverage ?? 0}%` }} />
            </div>
          </div>
          <p className="feynman-feedback">{result.feedback}</p>
          {result.covered.length > 0 ? (
            <section className="feynman-group covered">
              <h3>讲到了</h3>
              <ul>
                {result.covered.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {result.missing.length > 0 ? (
            <section className="feynman-group missing">
              <h3>还缺</h3>
              <ul>
                {result.missing.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {result.misconceptions.length > 0 ? (
            <section className="feynman-group wrong">
              <h3>需要纠正</h3>
              <ul>
                {result.misconceptions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <div className="feynman-result-actions">
            <button type="button" className="ghost-button small" onClick={() => setResult(null)}>
              再讲一次
            </button>
            <button type="button" className="primary-button small" onClick={() => void save()} disabled={saved}>
              {saved ? '已存为笔记' : '存为笔记'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
