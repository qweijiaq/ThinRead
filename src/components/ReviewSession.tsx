import { useEffect, useRef, useState, type JSX } from 'react'
import type { LibraryNote, ReviewRating } from '../../shared/types.js'
import { buildCloze, normalizeClozeAnswer } from '../lib/cloze.js'
import { Markdown } from './Markdown.js'

interface ReviewSessionProps {
  initialCards: LibraryNote[]
  onRate(noteId: string, rating: ReviewRating): Promise<void>
  onClose(): void
}

const RATINGS: Array<{ rating: ReviewRating; label: string; hint: string }> = [
  { rating: 'again', label: '忘记', hint: '10 分钟' },
  { rating: 'hard', label: '模糊', hint: '1 天' },
  { rating: 'good', label: '记得', hint: '按间隔' },
  { rating: 'easy', label: '简单', hint: '更长' },
]

const DIVERGENCE_LABEL: Record<string, string> = {
  boundary: '边界',
  crossbook: '跨书',
  transfer: '触类',
}

export function ReviewSession({ initialCards, onRate, onClose }: ReviewSessionProps): JSX.Element {
  const [cards, setCards] = useState<LibraryNote[]>(initialCards)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [clozeMode, setClozeMode] = useState(true)
  const [answer, setAnswer] = useState('')
  const [clozeChecked, setClozeChecked] = useState<boolean | null>(null)
  const unique = useRef(new Set<string>())
  const total = useRef(initialCards.length)

  const current = cards[0] ?? null
  const cloze = current && clozeMode ? buildCloze(current) : null

  useEffect(() => {
    setAnswer('')
    setClozeChecked(null)
    setRevealed(false)
  }, [current?.id])

  function checkCloze(): void {
    if (!cloze) return
    setClozeChecked(normalizeClozeAnswer(answer) === normalizeClozeAnswer(cloze.answer))
    setRevealed(true)
  }

  function toggleCloze(next: boolean): void {
    setClozeMode(next)
    setAnswer('')
    setClozeChecked(null)
    setRevealed(false)
  }

  async function rate(rating: ReviewRating): Promise<void> {
    if (!current || busy) return
    setBusy(true)
    setError(null)
    try {
      await onRate(current.id, rating)
      unique.current.add(current.id)
      setReviewed((value) => value + 1)
      setRevealed(false)
      setCards((items) => {
        const rest = items.slice(1)
        return rating === 'again' ? [...rest, current] : rest
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (busy) return
      if (!revealed && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault()
        setRevealed(true)
        return
      }
      const keys: Record<string, ReviewRating> = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' }
      const rating = keys[event.key]
      if (revealed && rating) {
        event.preventDefault()
        void rate(rating)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const progress = reviewed + cards.length > 0 ? Math.round((reviewed / (reviewed + cards.length)) * 100) : 100

  return (
    <div className="review-backdrop">
      <div className="review-panel" role="dialog" aria-modal="true" aria-label="复习">
        <div className="review-head">
          <div>
            <strong>复习</strong>
            <span className="muted">
              已复习 {reviewed} 次 · 剩余 {cards.length}
            </span>
          </div>
          <button type="button" className="text-button muted" onClick={onClose}>
            关闭
          </button>
        </div>
        {current ? (
          <div className="review-subhead">
            <label className="cloze-toggle">
              <input type="checkbox" checked={clozeMode} onChange={(event) => toggleCloze(event.target.checked)} />
              挖空回忆
            </label>
            <span className="muted">
              {cloze && !revealed ? '输入后回车检查' : '1–4 键评分'} · Esc 关闭
            </span>
          </div>
        ) : null}
        <div className="review-progress">
          <div className="review-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        {current ? (
          <article className={`review-card${revealed ? ' is-revealed' : ''}`}>
            <p className="review-meta">
              {current.bookTitle}
              {current.chapterTitle ? ` · ${current.chapterTitle}` : ''}
            </p>

            {revealed ? (
              <>
                {cloze && clozeChecked !== null ? (
                  <p className={`review-cloze-result ${clozeChecked ? 'ok' : 'miss'}`}>
                    {clozeChecked ? `填对了：${cloze.answer}` : `正确答案：${cloze.answer}`}
                  </p>
                ) : null}
                <h2>{current.title}</h2>
                {current.tags.length > 0 ? (
                  <div className="tag-row">
                    {current.tags.slice(0, 6).map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="review-answer">
                  <Markdown text={current.content} />
                </div>
                {current.role ? (
                  <p className="review-role">
                    <span>在文中的作用</span>
                    {current.role}
                  </p>
                ) : null}
                {current.quote ? (
                  <blockquote className="review-quote">{current.quote}</blockquote>
                ) : null}
                {current.divergences.length > 0 ? (
                  <div className="review-divergences">
                    {current.divergences.map((divergence, index) => (
                      <p key={index}>
                        <strong>{DIVERGENCE_LABEL[divergence.type] ?? divergence.type}</strong>
                        {divergence.text}
                      </p>
                    ))}
                  </div>
                ) : null}
                <div className="review-rate-hint">
                  <span>这张卡片记得怎么样？</span>
                  <em>1–4 键评分</em>
                </div>
                <div className="review-ratings">
                  {RATINGS.map((item) => (
                    <button
                      key={item.rating}
                      type="button"
                      className={`review-rating ${item.rating}`}
                      onClick={() => void rate(item.rating)}
                      disabled={busy}
                    >
                      <span>{item.label}</span>
                      <em>{item.hint}</em>
                    </button>
                  ))}
                </div>
              </>
            ) : cloze ? (
              <div className="review-cloze">
                <p className="review-prompt">补上横线处的词。</p>
                <p className="review-cloze-text">{cloze.text}</p>
                <form
                  className="review-cloze-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    checkCloze()
                  }}
                >
                  <input
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder="填入缺的词"
                    autoFocus
                    aria-label="填空答案"
                  />
                  <button type="submit" className="primary-button small" disabled={!answer.trim()}>
                    检查
                  </button>
                </form>
                <button type="button" className="text-button muted" onClick={() => setRevealed(true)}>
                  不会，直接看答案
                </button>
              </div>
            ) : (
              <div className="review-front">
                <p className="review-prompt">先在心里回忆这张卡片，再显示答案。</p>
                {current.quote ? <blockquote className="review-front-quote">“{current.quote}”</blockquote> : null}
                {!current.quote && current.section ? <p className="review-section">{current.section}</p> : null}
                {!current.quote && current.tags.length > 0 ? (
                  <div className="tag-row review-front-tags">
                    {current.tags.slice(0, 5).map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                {!current.quote && current.tags.length === 0 ? (
                  <h2 className="review-front-title">{current.title}</h2>
                ) : null}
                <div className="review-reveal">
                  <button type="button" className="primary-button" onClick={() => setRevealed(true)}>
                    显示答案
                  </button>
                  <span className="muted">空格 / 回车</span>
                </div>
              </div>
            )}
          </article>
        ) : (
          <div className="review-done">
            <h2>这一轮复习完成</h2>
            <p>
              共复习 {reviewed} 次，涉及 {unique.current.size} 张卡片
              {total.current > 0 ? ` · 本轮队列 ${total.current} 张` : ''}。
            </p>
            <button type="button" className="primary-button" onClick={onClose}>
              回到笔记库
            </button>
          </div>
        )}

        {error ? <div className="inline-error">{error}</div> : null}
      </div>
    </div>
  )
}
