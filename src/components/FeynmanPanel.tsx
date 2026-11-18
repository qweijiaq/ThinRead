import { t } from '../lib/i18n.js'
import { bridge } from '../lib/bridge.js'
import { useEffect, useRef, useState, type JSX } from 'react'
import type { ChapterContent, FeynmanResult } from '../../shared/types.js'
import { onContentCurrent } from '../lib/content-events.js'
import { Markdown } from './Markdown.js'

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
  const [streamingFeedback, setStreamingFeedback] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [artifactId, setArtifactId] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
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
    void bridge.getLabArtifact('feynman', chapter.id).then((artifact) => {
      if (cancelled) return
      if (artifact) {
        try {
          const parsed = JSON.parse(artifact.content) as { explanation?: string; result?: FeynmanResult }
          if (typeof parsed.explanation === 'string') setExplanation(parsed.explanation)
          if (parsed.result) setResult(parsed.result)
          setArtifactId(artifact.id)
        } catch {
          // 忽略旧格式。
        }
      }
      setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [chapter?.id, refreshTick])

  useEffect(
    () =>
      onContentCurrent((detail) => {
        if (detail.tool === 'feynman' && detail.scope === chapter?.id) setRefreshTick((value) => value + 1)
      }),
    [chapter?.id],
  )

  useEffect(() => {
    if (!hydrated || !chapter) return
    const timer = window.setTimeout(() => {
      const content = JSON.stringify({ explanation, result })
      const task = artifactId
        ? bridge.updateLabArtifact(artifactId, { title: t('讲给我听'), content })
        : bridge
            .saveLabArtifact({
              tool: 'feynman',
              scope: chapter.id,
              title: t('讲给我听'),
              content,
              kind: 'chat',
            })
            .then((saved) => {
              setArtifactId(saved.id)
              return saved
            })
      void task.catch(() => undefined)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [hydrated, artifactId, chapter?.id, explanation, result])

  async function evaluate(): Promise<void> {
    if (!chapter || busy) return
    const chapterId = chapter.id
    setError(null)
    setSaved(false)
    setBusy(true)
    setStreamingFeedback('')
    try {
      const next = await bridge.evaluateExplanationStream(chapterId, explanation, (text) => {
        if (chapterRef.current === chapterId) setStreamingFeedback(text)
      })
      if (chapterRef.current === chapterId) {
        // 每次评估留一版，旧结果可以在内容库里切回。
        const saved = await bridge
          .saveLabArtifact({
            tool: 'feynman',
            scope: chapterId,
            title: t('讲给我听'),
            content: JSON.stringify({ explanation, result: next }),
            kind: 'chat',
          })
          .catch(() => null)
        if (chapterRef.current === chapterId) {
          if (saved) setArtifactId(saved.id)
          setResult(next)
        }
      }
    } catch (err) {
      if (chapterRef.current === chapterId) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (chapterRef.current === chapterId) setStreamingFeedback('')
      setBusy(false)
    }
  }

  async function save(): Promise<void> {
    if (!result) return
    const content = [
      t('我的解释：'),
      explanation.trim(),
      '',
      `${t('反馈：')}${result.feedback}`,
      result.covered.length ? `${t('已覆盖：')}${result.covered.join('；')}` : '',
      result.missing.length ? `${t('还缺：')}${result.missing.join('；')}` : '',
      result.misconceptions.length ? `${t('理解偏差：')}${result.misconceptions.join('；')}` : '',
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
          <h2>{t('讲给我听')}</h2>
          <p>{bookTitle ? `${bookTitle} · ` : ''}{chapter?.title ?? t('选择一章开始')}</p>
        </div>
        <button
          type="button"
          className="ghost-button small"
          onClick={() => {
            setExplanation('')
            setResult(null)
            setSaved(false)
            setArtifactId(null)
          }}
          disabled={busy}
        >
          {t('清空')}
        </button>
      </div>
      <p className="feynman-hint">
        {t('不看笔记，用自己的话把这一章讲清楚。讲完会对照读薄稿和卡片，指出讲对、漏掉和理解偏的地方。')}
      </p>
      {!hasNotes ? <p className="feynman-warning">{t('这一章还没有读薄稿。先生成笔记，检查会更准确；也可以先凭记忆试一次。')}</p> : null}

      <textarea
        className="feynman-input"
        value={explanation}
        onChange={(event) => setExplanation(event.target.value)}
        placeholder={t('例如：这一章主要讲了三件事……')}
        rows={7}
        disabled={!chapter || busy}
      />
      <div className="feynman-actions">
        <span className="muted">{explanation.trim().length} {t('字')}</span>
        <button
          type="button"
          className="primary-button small"
          onClick={() => void evaluate()}
          disabled={!chapter || busy || explanation.trim().length < 12}
        >
          {busy ? t('正在对照…') : t('检查我的理解')}
        </button>
      </div>

      {error ? <div className="inline-error" role="alert">{error}</div> : null}

      {busy && streamingFeedback ? (
        <div className="feynman-result feynman-streaming">
          <div className="lab-markdown">
            <Markdown text={streamingFeedback} />
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="feynman-result">
          <div className="feynman-score">
            <div>
              <span>{t('覆盖度')}</span>
              <strong>{coverage == null ? '—' : `${coverage}%`}</strong>
            </div>
            <div className="feynman-meter">
              <span style={{ width: `${coverage ?? 0}%` }} />
            </div>
          </div>
          <p className="feynman-feedback">{result.feedback}</p>
          {result.covered.length > 0 ? (
            <section className="feynman-group covered">
              <h3>{t('讲到了')}</h3>
              <ul>
                {result.covered.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {result.missing.length > 0 ? (
            <section className="feynman-group missing">
              <h3>{t('还缺')}</h3>
              <ul>
                {result.missing.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {result.misconceptions.length > 0 ? (
            <section className="feynman-group wrong">
              <h3>{t('需要纠正')}</h3>
              <ul>
                {result.misconceptions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <div className="feynman-result-actions">
            <button
              type="button"
              className="text-button"
              onClick={() => {
                const text = [
                  `# ${chapter?.title ?? ''} · ${t('费曼检查')}`,
                  '',
                  result.feedback,
                  '',
                  result.covered.length > 0 ? `## ${t('讲到了')}\n${result.covered.map((item) => `- ${item}`).join('\n')}` : '',
                  result.missing.length > 0 ? `## ${t('还缺')}\n${result.missing.map((item) => `- ${item}`).join('\n')}` : '',
                  result.misconceptions.length > 0
                    ? `## ${t('需要纠正')}\n${result.misconceptions.map((item) => `- ${item}`).join('\n')}`
                    : '',
                ]
                  .filter((part) => part !== '')
                  .join('\n')
                void bridge.copyText(text).then(() => {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1600)
                })
              }}
            >
              {copied ? t('已复制') : t('复制全文')}
            </button>
            <button type="button" className="ghost-button small" onClick={() => setResult(null)}>
              {t('再讲一次')}
            </button>
            <button type="button" className="primary-button small" onClick={() => void save()} disabled={saved}>
              {saved ? t('已存为笔记') : t('存为笔记')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
