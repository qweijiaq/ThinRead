import { useEffect, useRef, useState, type JSX } from 'react'
import type { ChapterContent, ChatCitation, ChatMode, ChatTurn } from '../../shared/types.js'
import { onContentCurrent } from '../lib/content-events.js'
import { Markdown } from './Markdown.js'

interface ChatPanelProps {
  chapter: ChapterContent | null
  bookTitle: string
  seed?: { text: string; key: number } | null
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

export function ChatPanel({ chapter, bookTitle, seed, onJumpQuote, onSave }: ChatPanelProps): JSX.Element {
  const [mode, setMode] = useState<ChatMode>('answer')
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [streamingAnswer, setStreamingAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<number | null>(null)
  const [artifactId, setArtifactId] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef(0)

  useEffect(() => {
    sessionRef.current += 1
    setTurns([])
    setInput('')
    setError(null)
    setSaved(null)
    if (!chapter) return
    let cancelled = false
    void window.api.getLabArtifact('chapter-chat', chapter.id).then((artifact) => {
      if (cancelled || !artifact) return
      try {
        const parsed = JSON.parse(artifact.content) as { turns?: Turn[]; mode?: ChatMode }
        if (Array.isArray(parsed.turns)) setTurns(parsed.turns)
        if (parsed.mode === 'answer' || parsed.mode === 'socratic') setMode(parsed.mode)
        setArtifactId(artifact.id)
      } catch {
        // 忽略旧格式。
      }
    })
    return () => {
      cancelled = true
    }
  }, [chapter?.id, refreshTick])

  useEffect(() => {
    if (!seed?.text.trim()) return
    setInput(`请解释这段原文：\n\n> ${seed.text.replace(/\n/g, '\n> ')}\n\n`)
  }, [seed?.key, chapter?.id])

  useEffect(
    () =>
      onContentCurrent((detail) => {
        if (detail.tool === 'chapter-chat' && detail.scope === chapter?.id) setRefreshTick((value) => value + 1)
      }),
    [chapter?.id],
  )

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
    if (chapter) {
      setArtifactId(null)
      void window.api
        .saveLabArtifact({
          tool: 'chapter-chat',
          scope: chapter.id,
          title: '章节问答',
          content: JSON.stringify({ turns: [], mode: next }),
          kind: 'chat',
        })
        .then((artifact) => setArtifactId(artifact.id))
        .catch(() => undefined)
    }
  }

  function saveTurns(finalTurns: Turn[], chatMode: ChatMode): void {
    if (!chapter) return
    const content = JSON.stringify({ turns: finalTurns, mode: chatMode })
    const task = artifactId
      ? window.api.updateLabArtifact(artifactId, { title: '章节问答', content })
      : window.api
          .saveLabArtifact({
            tool: 'chapter-chat',
            scope: chapter.id,
            title: '章节问答',
            content,
            kind: 'chat',
          })
          .then((artifact) => {
            setArtifactId(artifact.id)
            return artifact
          })
    void task.catch(() => undefined)
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
    setStreamingAnswer('')
    try {
      const result = await window.api.askChapterStream(chapter.id, text, history, mode, (delta) => {
        if (session === sessionRef.current) setStreamingAnswer(delta)
      })
      if (session === sessionRef.current) {
        const finalTurns: Turn[] = [
          ...turns,
          { role: 'user', content: text },
          { role: 'assistant', content: result.answer, citations: result.citations },
        ]
        setTurns(finalTurns)
        saveTurns(finalTurns, mode)
      }
    } catch (err) {
      if (session === sessionRef.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (session === sessionRef.current) setStreamingAnswer('')
      setBusy(false)
    }
  }

  async function regenerateLast(): Promise<void> {
    if (!chapter || busy) return
    let lastUser = -1
    for (let index = turns.length - 1; index >= 0; index--) {
      if (turns[index]?.role === 'user') {
        lastUser = index
        break
      }
    }
    if (lastUser < 0) return
    const question = turns[lastUser]!.content
    const before = turns.slice(0, lastUser)
    const history: ChatTurn[] = before.map((turn) => ({ role: turn.role, content: turn.content }))
    const session = ++sessionRef.current
    setBusy(true)
    setError(null)
    setStreamingAnswer('')
    try {
      const result = await window.api.askChapterStream(chapter.id, question, history, mode, (delta) => {
        if (session === sessionRef.current) setStreamingAnswer(delta)
      })
      if (session !== sessionRef.current) return
      const finalTurns: Turn[] = [
        ...before,
        { role: 'user', content: question },
        { role: 'assistant', content: result.answer, citations: result.citations },
      ]
      setTurns(finalTurns)
      saveTurns(finalTurns, mode)
    } catch (err) {
      if (session === sessionRef.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (session === sessionRef.current) setStreamingAnswer('')
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
                <div className="qa-turn-actions">
                  <button
                    type="button"
                    className="text-button muted"
                    onClick={() => void save(index, turn)}
                    disabled={saved === index}
                  >
                    {saved === index ? '已存为笔记' : '存为笔记'}
                  </button>
                  {index === turns.length - 1 ? (
                    <button type="button" className="text-button" onClick={() => void regenerateLast()} disabled={busy}>
                      重新生成
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="qa-turn assistant">
            <span className="qa-role">{mode === 'socratic' ? '教练' : '页边'}</span>
            <div className={`qa-bubble${streamingAnswer ? '' : ' qa-thinking'}`}>
              {streamingAnswer ? <Markdown text={streamingAnswer} /> : <span className="spinner" />}
              {streamingAnswer ? null : '正在读这一章…'}
            </div>
          </div>
        ) : null}
      </div>

      {error ? <div className="inline-error" role="alert">{error}</div> : null}

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
