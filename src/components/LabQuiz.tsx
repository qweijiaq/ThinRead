import { useEffect, useState, type JSX } from 'react'
import type { LabAnswerCheck, LabQuiz as LabQuizData } from '../../shared/types.js'

interface LabQuizProps {
  chapterId: string
}

const VERDICT_LABEL: Record<LabAnswerCheck['verdict'], string> = {
  good: '讲清楚了',
  partial: '还差一点',
  off: '需要重想',
}

export function LabQuiz({ chapterId }: LabQuizProps): JSX.Element {
  const [quiz, setQuiz] = useState<LabQuizData | null>(null)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [checks, setChecks] = useState<Record<number, LabAnswerCheck>>({})
  const [checking, setChecking] = useState<number | null>(null)
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let cancelled = false
    setHydrated(false)
    setQuiz(null)
    setAnswers({})
    setChecks({})
    setRevealed(new Set())
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
  }, [chapterId])

  useEffect(() => {
    if (!hydrated) return
    const timer = window.setTimeout(() => {
      void window.api
        .saveLabArtifact({
          tool: 'adaptive-quiz',
          scope: chapterId,
          title: '自适应出题',
          content: JSON.stringify({ quiz, answers, checks, revealed: [...revealed] }),
        })
        .catch(() => undefined)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [hydrated, chapterId, quiz, answers, checks, revealed])

  async function generate(): Promise<void> {
    setBusy(true)
    setError(null)
    setAnswers({})
    setChecks({})
    setRevealed(new Set())
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
        <span className="lab-run-hint">生成 5 道需要理解才能回答的问题，不考死记硬背。</span>
        <button type="button" className="primary-button small" onClick={() => void generate()} disabled={busy}>
          {busy ? '出题中…' : quiz ? '重新生成' : '开始出题'}
        </button>
      </div>
      {error ? <div className="inline-error">{error}</div> : null}
      {!quiz && !busy ? <p className="lab-empty">选好章节后点「开始出题」。</p> : null}
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
