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
  voice?: boolean
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
  'voice-chat': ['用一分钟总结这一章。', '我读过的书里，关于专注有哪些观点？'],
}

function plain(value: string): string {
  return value
    .replace(/[#>*_`~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function LabChat({ tool, bookIds, chapterId, voice = false }: LabChatProps): JSX.Element {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState<number | null>(null)
  const [artifactId, setArtifactId] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const recognitionRef = useRef<{ stop(): void } | null>(null)

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
  }, [turns, busy])

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
    try {
      const answer = await window.api.labChat(request(text), history)
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
    try {
      const answer = await window.api.labChat(request(question), history)
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

  function startListening(): void {
    const Recognition =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition
    if (!Recognition) {
      setError('当前环境没有可用的语音识别。')
      return
    }
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const recognition = new Recognition()
    recognition.lang = 'zh-CN'
    recognition.interimResults = true
    recognition.continuous = false
    recognition.onresult = (event) => {
      let text = ''
      for (let index = event.resultIndex; index < event.results.length; index++) {
        text += event.results[index]?.[0]?.transcript ?? ''
      }
      setInput(text)
    }
    recognition.onerror = (event) => {
      setError(`语音识别失败：${event.error ?? '未知错误'}`)
      setListening(false)
    }
    recognition.onend = () => {
      setListening(false)
      recognitionRef.current = null
    }
    recognitionRef.current = recognition
    setError(null)
    setListening(true)
    recognition.start()
  }

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
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
            <div className="lab-chat-bubble lab-chat-thinking">
              <span className="spinner" />
              正在整理…
            </div>
          </div>
        ) : null}
      </div>
      {error ? <div className="inline-error">{error}</div> : null}
      <div className="lab-chat-input">
        {voice ? (
          <button
            type="button"
            className={`mic-button${listening ? ' is-listening' : ''}`}
            onClick={startListening}
            title={listening ? '停止录音' : '语音输入'}
            aria-label={listening ? '停止录音' : '语音输入'}
          >
            {listening ? '◉' : '🎙'}
          </button>
        ) : null}
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
          placeholder={voice ? '按住麦克风说话，或直接输入…' : '继续追问…'}
        />
        <button type="button" className="primary-button small" onClick={() => void ask(input)} disabled={!input.trim() || busy}>
          发送
        </button>
      </div>
    </div>
  )
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}
