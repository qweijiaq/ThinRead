import { useEffect, useRef, useState, type JSX } from 'react'
import type { ChatTurn, LabToolId } from '../../shared/types.js'
import { loadLabArtifact, saveLabArtifact } from '../lib/lab-artifacts.js'
import { onContentCurrent } from '../lib/content-events.js'
import { labChatScope } from '../lib/lab-scope.js'
import { Markdown } from './Markdown.js'

interface LabChatProps {
  tool: LabToolId
  bookIds: string[]
  chapterId: string
}

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS: Partial<Record<LabToolId, string[]>> = {
  'library-research': ['我读过的书里，关于习惯有哪些不同看法？', '哪些书对「意志力」的解释互相矛盾？'],
  'author-roundtable': ['作者会怎么反驳「靠意志力就能改变」？', '两位作者最大的分歧是什么？'],
  'devils-advocate': ['请挑战这一章最核心的主张。', '如果作者错了，最可能错在哪里？'],
  'book-club': ['请三位读者聊聊这一章最值得实践的一点。', '怀疑者会质疑什么？'],
}

function plain(value: string): string {
  return value
    .replace(/[#>*_`~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function LabChat({ tool, bookIds, chapterId }: LabChatProps): JSX.Element {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [streamingAnswer, setStreamingAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState<number | null>(null)
  const [artifactId, setArtifactId] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const scope = labChatScope(tool, bookIds, chapterId)

  useEffect(() => {
    let cancelled = false
    setTurns([])
    void loadLabArtifact(tool, scope).then((artifact) => {
      if (cancelled || !artifact) return
      try {
        const parsed = JSON.parse(artifact.content) as { turns?: Turn[] }
        if (Array.isArray(parsed.turns)) setTurns(parsed.turns)
        setArtifactId(artifact.id)
      } catch {
        // 忽略旧格式。
      }
    })
    return () => {
      cancelled = true
    }
  }, [tool, scope, refreshTick])

  useEffect(
    () =>
      onContentCurrent((detail) => {
        if (detail.tool === tool && detail.scope === scope) setRefreshTick((value) => value + 1)
      }),
    [tool, scope],
  )

  function clearChat(): void {
    setTurns([])
    setInput('')
    setError(null)
    setSpeaking(null)
    setArtifactId(null)
    setStreamingAnswer('')
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    void saveLabArtifact(tool, '对话', JSON.stringify({ turns: [] }), { sourceKey: scope }, scope)
      .then((artifact) => setArtifactId(artifact.id))
      .catch(() => undefined)
  }

  function saveTurns(finalTurns: Turn[]): void {
    const content = JSON.stringify({ turns: finalTurns })
    const task = artifactId
      ? window.api.updateLabArtifact(artifactId, { title: '对话', content })
      : saveLabArtifact(tool, '对话', content, { sourceKey: scope }, scope).then((artifact) => {
          setArtifactId(artifact.id)
          return artifact
        })
    void task.catch(() => undefined)
  }

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [turns, busy, streamingAnswer])

  function request(question: string) {
    const usesChapter = tool === 'devils-advocate' || tool === 'book-club'
    const usesBooks = tool === 'author-roundtable'
    return {
      tool,
      bookIds: usesBooks && bookIds.length > 0 ? bookIds : undefined,
      chapterId: usesChapter ? chapterId || undefined : undefined,
      question,
    }
  }

  async function ask(question: string): Promise<void> {
    const text = question.trim()
    if (!text || busy) return
    const history: ChatTurn[] = turns.map((turn) => ({ role: turn.role, content: turn.content }))
    setTurns((current) => [...current, { role: 'user', content: text }])
    setInput('')
    setBusy(true)
    setError(null)
    setStreamingAnswer('')
    try {
      const answer = await window.api.labChatStream(request(text), history, (delta) => setStreamingAnswer(delta))
      const finalTurns: Turn[] = [
        ...turns,
        { role: 'user', content: text },
        { role: 'assistant', content: answer.answer },
      ]
      setTurns(finalTurns)
      saveTurns(finalTurns)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStreamingAnswer('')
      setBusy(false)
    }
  }

  async function regenerateLast(): Promise<void> {
    if (busy) return
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
    setBusy(true)
    setError(null)
    setStreamingAnswer('')
    try {
      const answer = await window.api.labChatStream(request(question), history, (delta) => setStreamingAnswer(delta))
      const finalTurns: Turn[] = [
        ...before,
        { role: 'user', content: question },
        { role: 'assistant', content: answer.answer },
      ]
      setTurns(finalTurns)
      saveTurns(finalTurns)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStreamingAnswer('')
      setBusy(false)
    }
  }

  function speak(index: number, text: string): void {
    if (!('speechSynthesis' in window)) return
    if (speaking === index) {
      window.speechSynthesis.cancel()
      setSpeaking(null)
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(plain(text).slice(0, 1200))
    utterance.lang = 'zh-CN'
    utterance.rate = 1
    utterance.onend = () => setSpeaking((current) => (current === index ? null : current))
    window.speechSynthesis.speak(utterance)
    setSpeaking(index)
  }

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    }
  }, [])

  return (
    <div className="lab-chat">
      {turns.length > 0 ? (
        <div className="lab-chat-toolbar">
          <button type="button" className="text-button muted" onClick={clearChat}>
            新对话
          </button>
        </div>
      ) : null}
      <div className="lab-chat-messages" ref={scrollRef}>
        {turns.length === 0 ? (
          <div className="lab-chat-empty">
            <p>从一句话开始。AI 会基于你选中的书和笔记回答。</p>
            <div className="qa-suggestions">
              {(SUGGESTIONS[tool] ?? ['我该从哪里开始？']).map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => void ask(suggestion)} disabled={busy}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {turns.map((turn, index) => (
          <div key={index} className={`lab-chat-turn ${turn.role}`}>
            <span className="lab-chat-role">{turn.role === 'user' ? '我' : '页边'}</span>
            <div className="lab-chat-bubble">
              {turn.role === 'assistant' ? <Markdown text={turn.content} /> : <p>{turn.content}</p>}
              {turn.role === 'assistant' ? (
                <div className="lab-chat-actions">
                  <button type="button" className="text-button muted" onClick={() => speak(index, turn.content)}>
                    {speaking === index ? '停止朗读' : '朗读'}
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
          <div className="lab-chat-turn assistant">
            <span className="lab-chat-role">页边</span>
            <div className={`lab-chat-bubble${streamingAnswer ? '' : ' lab-chat-thinking'}`}>
              {streamingAnswer ? <Markdown text={streamingAnswer} /> : <span className="spinner" />}
              {streamingAnswer ? null : '正在整理…'}
              <button type="button" className="text-button lab-chat-cancel" onClick={() => void window.api.cancelLab()}>
                取消
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      <div className="lab-chat-input">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void ask(input)
            }
          }}
          rows={2}
          placeholder="继续追问…"
        />
        <button type="button" className="primary-button small" onClick={() => void ask(input)} disabled={!input.trim() || busy}>
          发送
        </button>
      </div>
    </div>
  )
}
