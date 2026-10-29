import { useEffect, useRef, useState, type JSX } from 'react'
import type { ChapterContent, ChatCitation, ChatMode, ChatTurn } from '../../shared/types.js'
import { Markdown } from './Markdown.js'

interface ChatPanelProps {
  chapter: ChapterContent | null
  bookTitle: string
  onJumpQuote(quote: string): void
  onSave(text: string): Promise<void>
}

interface Turn {
  role: 'user' | 'assistant'
  content: string
  citations?: ChatCitation[]
}

const ANSWER_SUGGESTIONS = ['这一章最重要的三个观点是什么？', '作者反对了什么？', '这些结论在什么条件下会失效？']
const SOCRATIC_SUGGESTIONS = ['我觉得这一章主要在讲……', '这一章最容易被误解的地方是什么？', '作者最反对哪种做法？']

export function ChatPanel({ chapter, bookTitle, onJumpQuote, onSave }: ChatPanelProps): JSX.Element {
  const [mode, setMode] = useState<ChatMode>('answer')
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef(0)

  useEffect(() => {
    sessionRef.current += 1
    setTurns([])
    setInput('')
    setError(null)
    setSaved(null)
  }, [chapter?.id])

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [turns, busy])

  function switchMode(next: ChatMode): void {
    if (next === mode) return
    sessionRef.current += 1
    setMode(next)
    setTurns([])
    setSaved(null)
    setError(null)
  }

  async function ask(question: string): Promise<void> {
    if (!chapter || busy) return
    const text = question.trim()
    if (!text) return
    setError(null)
    setSaved(null)
    const history: ChatTurn[] = turns.map((turn) => ({ role: turn.role, content: turn.content }))
    const session = sessionRef.current
    setTurns((current) => [...current, { role: 'user', content: text }])
    setInput('')
    setBusy(true)
    try {
      const result = await window.api.askChapter(chapter.id, text, history, mode)
      if (session === sessionRef.current) {
        setTurns((current) => [...current, { role: 'assistant', content: result.answer, citations: result.citations }])
      }
    } catch (err) {
      if (session === sessionRef.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function save(index: number, turn: Turn): Promise<void> {
    const citations = turn.citations?.length
      ? `\n\n原文依据：\n${turn.citations.map((item) => `“${item.quote}”`).join('\n')}`
      : ''
    try {
      await onSave(`${turn.content}${citations}`)
      setSaved(index)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="qa-panel">
      <div className="qa-head">
        <div>
          <h2>问这一章</h2>
          <p>{bookTitle ? `${bookTitle} · ` : ''}{chapter?.title ?? '选择一章开始'}</p>
        </div>
        <div className="qa-modes" role="group" aria-label="问答模式">
          <button type="button" className={mode === 'answer' ? 'active' : ''} onClick={() => switchMode('answer')}>
            问答
          </button>
          <button type="button" className={mode === 'socratic' ? 'active' : ''} onClick={() => switchMode('socratic')}>
            考考我
          </button>
        </div>
      </div>
      <p className="qa-hint">
        {mode === 'answer'
          ? '只根据当前章节回答，每条回答尽量给出原文依据。'
          : '不直接给答案：先问你怎么想，再顺着你的回答追问。'}
      </p>

      <div className="qa-messages" ref={scrollRef}>
        {turns.length === 0 ? (
          <div className="qa-empty">
            <p>{mode === 'answer' ? '读到哪里卡住了，就直接问。' : '试着把这一章讲清楚，看看会被问到哪里。'}</p>
            <div className="qa-suggestions">
              {(mode === 'socratic' ? SOCRATIC_SUGGESTIONS : ANSWER_SUGGESTIONS).map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => void ask(suggestion)} disabled={!chapter || busy}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((turn, index) => (
          <div key={index} className={`qa-turn ${turn.role}`}>
            <span className="qa-role">{turn.role === 'user' ? '我' : mode === 'socratic' ? '教练' : '页边'}</span>
            <div className="qa-bubble">
              {turn.role === 'assistant' ? <Markdown text={turn.content} /> : <p>{turn.content}</p>}
              {turn.citations && turn.citations.length > 0 ? (
                <div className="qa-citations">
                  {turn.citations.map((citation, citationIndex) => (
                    <button
                      key={citationIndex}
                      type="button"
                      className="qa-citation"
                      onClick={() => onJumpQuote(citation.quote)}
                      title="回到原文"
                    >
                      <span className={`qa-verify ${citation.verified ? 'ok' : 'warn'}`}>
                        {citation.verified ? '原文' : '待核对'}
                      </span>
                      “{citation.quote}”
                    </button>
                  ))}
                </div>
              ) : turn.role === 'assistant' ? (
                <p className="qa-no-citation">这一轮没有给出原文依据。</p>
              ) : null}
              {turn.role === 'assistant' ? (
                <button
                  type="button"
                  className="text-button muted qa-save"
                  onClick={() => void save(index, turn)}
                  disabled={saved === index}
                >
                  {saved === index ? '已存为笔记' : '存为笔记'}
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="qa-turn assistant">
            <span className="qa-role">{mode === 'socratic' ? '教练' : '页边'}</span>
            <div className="qa-bubble qa-thinking">
              <span className="spinner" />
              正在读这一章…
            </div>
          </div>
        ) : null}
      </div>

      {error ? <div className="inline-error">{error}</div> : null}

      <div className="qa-input-row">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void ask(input)
            }
          }}
          placeholder={mode === 'socratic' ? '写下你的理解，教练会接着问…' : '问这一章的任何问题…'}
          rows={2}
          disabled={!chapter || busy}
        />
        <button type="button" className="primary-button small" onClick={() => void ask(input)} disabled={!chapter || busy || !input.trim()}>
          发送
        </button>
      </div>
    </div>
  )
}
