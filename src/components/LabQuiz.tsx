import { useEffect, useState, type JSX } from 'react'
import type { LabAnswerCheck, LabArtifact, LabQuiz as LabQuizData } from '../../shared/types.js'
import { onContentCurrent } from '../lib/content-events.js'
import { Select } from './Select.js'

interface LabQuizProps {
  chapterId: string
  bookTitle: string
  chapterTitle: string
}

const VERDICT_LABEL: Record<LabAnswerCheck['verdict'], string> = {
  good: '讲清楚了',
  partial: '还差一点',
  off: '需要重想',
}

export function LabQuiz({ chapterId, bookTitle, chapterTitle }: LabQuizProps): JSX.Element {
  const [quiz, setQuiz] = useState<LabQuizData | null>(null)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [checks, setChecks] = useState<Record<number, LabAnswerCheck>>({})
  const [checking, setChecking] = useState<number | null>(null)
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [artifactId, setArtifactId] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [history, setHistory] = useState<LabArtifact[]>([])
  const [selectedHistoryId, setSelectedHistoryId] = useState('')

  useEffect(() => {
    let cancelled = false
    setHydrated(false)
    setQuiz(null)
    setAnswers({})
    setChecks({})
    setRevealed(new Set())
    void window.api.listLabArtifacts('adaptive-quiz', 50).then((items) => {
      if (cancelled) return
      setHistory(items.filter((item) => item.scope === chapterId))
    })
    void window.api.getLabArtifact('adaptive-quiz', chapterId).then((artifact) => {
      if (cancelled) return
      if (artifact) {
        try {
          const parsed = JSON.parse(artifact.content) as {
            quiz?: LabQuizData
            answers?: Record<number, string>
            checks?: Record<number, LabAnswerCheck>
            revealed?: number[]
          }
          if (parsed.quiz) setQuiz(parsed.quiz)
          setArtifactId(artifact.id)
          setSelectedHistoryId(artifact.id)
          if (parsed.answers) setAnswers(parsed.answers)
          if (parsed.checks) setChecks(parsed.checks)
          if (Array.isArray(parsed.revealed)) setRevealed(new Set(parsed.revealed))
        } catch {
          // 忽略旧格式。
        }
      }
      setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [chapterId, refreshTick])

  useEffect(() => {
    if (!hydrated || !quiz) return
    const timer = window.setTimeout(() => {
      const content = JSON.stringify({ quiz, answers, checks, revealed: [...revealed] })
      const title = chapterTitle ? `自适应出题 · ${chapterTitle}` : '自适应出题'
      const task = artifactId
        ? window.api.updateLabArtifact(artifactId, { title, content }).then((updated) => {
            setHistory((current) => current.map((item) => (item.id === updated.id ? updated : item)))
            return updated
          })
        : window.api
            .saveLabArtifact({
              tool: 'adaptive-quiz',
              scope: chapterId,
              title,
              content,
              kind: 'quiz',
            })
            .then((saved) => {
              setArtifactId(saved.id)
              setSelectedHistoryId(saved.id)
              setHistory((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
              return saved
            })
      void task.catch(() => undefined)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [hydrated, artifactId, chapterId, chapterTitle, quiz, answers, checks, revealed])

  useEffect(
    () =>
      onContentCurrent((detail) => {
        if (detail.tool === 'adaptive-quiz' && detail.scope === chapterId) setRefreshTick((value) => value + 1)
      }),
    [chapterId],
  )

  async function generate(): Promise<void> {
    setBusy(true)
    setError(null)
    setAnswers({})
    setChecks({})
    setRevealed(new Set())
    setArtifactId(null)
    setSelectedHistoryId('')
    try {
      setQuiz(await window.api.generateQuiz(chapterId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function check(index: number): Promise<void> {
    const question = quiz?.questions[index]
    const answer = answers[index]?.trim()
    if (!question || !answer) return
    setChecking(index)
    setError(null)
    try {
      const result = await window.api.checkQuizAnswer(chapterId, question.question, answer)
      setChecks((current) => ({ ...current, [index]: result }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(null)
    }
  }

  return (
    <div className="lab-quiz">
      <div className="lab-run-row">
        <span className="lab-run-hint">
          {chapterTitle ? `《${bookTitle}》 · ${chapterTitle} · ` : ''}
          生成 5 道需要理解才能回答的问题，不考死记硬背。
        </span>
        <button type="button" className="primary-button small" onClick={() => void generate()} disabled={busy}>
          {busy ? '出题中…' : quiz ? '重新生成' : '开始出题'}
        </button>
      </div>
      {history.length > 1 ? (
        <div className="lab-history">
          <span>历史题目</span>
          <Select
            value={selectedHistoryId}
            onChange={(value) => {
              const artifact = history.find((item) => item.id === value)
              if (!artifact) return
              try {
                const parsed = JSON.parse(artifact.content) as {
                  quiz?: LabQuizData
                  answers?: Record<number, string>
                  checks?: Record<number, LabAnswerCheck>
                  revealed?: number[]
                }
                if (!parsed.quiz) return
                setQuiz(parsed.quiz)
                setAnswers(parsed.answers ?? {})
                setChecks(parsed.checks ?? {})
                setRevealed(new Set(parsed.revealed ?? []))
                setArtifactId(artifact.id)
                setSelectedHistoryId(artifact.id)
                setError(null)
              } catch {
                setError('这组旧题目无法读取。')
              }
            }}
            ariaLabel="历史题目"
            options={history.map((artifact) => {
              let label = artifact.createdAt.slice(5, 16).replace('T', ' ')
              try {
                const parsed = JSON.parse(artifact.content) as { quiz?: LabQuizData }
                const first = parsed.quiz?.questions[0]?.question
                if (first) label = `${label} · ${first.slice(0, 24)}`
              } catch {
                // 使用时间。
              }
              return { value: artifact.id, label }
            })}
          />
        </div>
      ) : null}
      {error ? <div className="inline-error">{error}</div> : null}
      {!quiz && !busy ? (
        <p className="lab-empty">
          {chapterTitle ? `当前章节：${chapterTitle}。` : '选好章节后点「开始出题」。'}
        </p>
      ) : null}
      {quiz ? (
        <div className="lab-quiz-list">
          {quiz.questions.map((question, index) => {
            const checkResult = checks[index]
            return (
              <article key={index} className="lab-quiz-card">
                <div className="lab-quiz-head">
                  <span className="kind-badge">{question.kind}</span>
                  <span className="lab-quiz-index">第 {index + 1} 题</span>
                </div>
                <h3>{question.question}</h3>
                <textarea
                  value={answers[index] ?? ''}
                  onChange={(event) => {
                    setAnswers((current) => ({ ...current, [index]: event.target.value }))
                    setChecks((current) => {
                      if (!current[index]) return current
                      const next = { ...current }
                      delete next[index]
                      return next
                    })
                  }}
                  placeholder="先不看答案，用自己的话回答…"
                  rows={3}
                />
                <div className="lab-quiz-actions">
                  <button type="button" className="text-button" onClick={() => void check(index)} disabled={!answers[index]?.trim() || checking === index}>
                    {checking === index ? '检查中…' : '检查'}
                  </button>
                  <button
                    type="button"
                    className="text-button muted"
                    onClick={() =>
                      setRevealed((current) => {
                        const next = new Set(current)
                        if (next.has(index)) next.delete(index)
                        else next.add(index)
                        return next
                      })
                    }
                  >
                    {revealed.has(index) ? '收起答案' : '显示答案'}
                  </button>
                </div>
                {checkResult ? (
                  <div className={`lab-quiz-check ${checkResult.verdict}`}>
                    <strong>{VERDICT_LABEL[checkResult.verdict]}</strong>
                    <p>{checkResult.feedback}</p>
                    {checkResult.missing.length > 0 ? (
                      <span>还缺：{checkResult.missing.join('、')}</span>
                    ) : null}
                  </div>
                ) : null}
                {revealed.has(index) ? (
                  <div className="lab-quiz-answer">
                    <p>{question.answer}</p>
                    {question.source ? <span>依据：{question.source}</span> : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
