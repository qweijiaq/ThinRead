import { useEffect, useMemo, useRef, useState, type JSX } from 'react'

interface ListenPanelProps {
  title: string
  text: string
  onClose(): void
}

function plainText(source: string): string {
  return source
    .replace(/\[第 \d+ 页\]/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\s*\-+]+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\r/g, '')
    .trim()
}

export function ListenPanel({ title, text, onClose }: ListenPanelProps): JSX.Element {
  const sentences = useMemo(() => {
    const clean = plainText(text).slice(0, 30_000)
    return clean
      .split(/\n+|(?<=[。！？!?；;])/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  }, [text])
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const currentRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [index])

  useEffect(() => {
    if (!playing) return
    if (!('speechSynthesis' in window)) {
      setError('当前环境没有可用的语音合成。')
      setPlaying(false)
      return
    }
    const sentence = sentences[index]
    if (!sentence) {
      setPlaying(false)
      return
    }
    let cancelled = false
    const utterance = new SpeechSynthesisUtterance(sentence)
    utterance.lang = /[一-鿿]/.test(sentence) ? 'zh-CN' : 'en-US'
    utterance.rate = speed
    const voices = window.speechSynthesis.getVoices()
    const voice = voices.find((item) => item.lang.toLowerCase().startsWith(utterance.lang.toLowerCase().slice(0, 2)))
    if (voice) utterance.voice = voice
    utterance.onend = () => {
      if (cancelled) return
      if (index + 1 < sentences.length) setIndex(index + 1)
      else {
        setPlaying(false)
        setPaused(false)
      }
    }
    utterance.onerror = (event) => {
      if (cancelled || event.error === 'interrupted' || event.error === 'canceled') return
      setError('朗读中断了，可以再点一次播放。')
      setPlaying(false)
    }
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    return () => {
      cancelled = true
      window.speechSynthesis.cancel()
    }
  }, [playing, index, sentences, speed])

  useEffect(
    () => () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    },
    [],
  )

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function toggle(): void {
    setError(null)
    if (!('speechSynthesis' in window)) {
      setError('当前环境没有可用的语音合成。')
      return
    }
    if (!playing) {
      setPaused(false)
      setPlaying(true)
      return
    }
    if (paused) {
      window.speechSynthesis.resume()
      setPaused(false)
    } else {
      window.speechSynthesis.pause()
      setPaused(true)
    }
  }

  function jump(next: number): void {
    if (next < 0 || next >= sentences.length) return
    if (next === index) {
      if (paused) {
        window.speechSynthesis.resume()
        setPaused(false)
      } else if (!playing) {
        setPlaying(true)
      }
      return
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    setPaused(false)
    setIndex(next)
    setPlaying(true)
  }

  return (
    <div className="listen-backdrop" onMouseDown={onClose}>
      <div className="listen-panel" role="dialog" aria-modal="true" aria-label="听读" onMouseDown={(event) => event.stopPropagation()}>
        <div className="listen-head">
          <div>
            <h2>听读</h2>
            <p>{title}</p>
          </div>
          <div className="listen-controls">
            <button type="button" className="ghost-button small" onClick={() => jump(index - 1)} disabled={index === 0}>
              上一句
            </button>
            <button type="button" className="primary-button small" onClick={toggle}>
              {!playing ? '播放' : paused ? '继续' : '暂停'}
            </button>
            <button
              type="button"
              className="ghost-button small"
              onClick={() => jump(index + 1)}
              disabled={index >= sentences.length - 1}
            >
              下一句
            </button>
            <select className="listen-speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="语速">
              <option value={0.8}>0.8×</option>
              <option value={1}>1×</option>
              <option value={1.2}>1.2×</option>
              <option value={1.5}>1.5×</option>
            </select>
            <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
              ×
            </button>
          </div>
        </div>

        {error ? <div className="inline-error">{error}</div> : null}

        <div className="listen-body">
          {sentences.length === 0 ? (
            <p className="listen-empty">这一章没有可朗读的文字。</p>
          ) : (
            sentences.map((sentence, sentenceIndex) => (
              <button
                key={sentenceIndex}
                ref={sentenceIndex === index ? currentRef : undefined}
                type="button"
                className={`listen-sentence${sentenceIndex === index ? ' is-current' : ''}`}
                onClick={() => jump(sentenceIndex)}
              >
                {sentence}
              </button>
            ))
          )}
        </div>
        <p className="listen-foot">使用系统语音 · 点击任意一句从这里开始 · {index + 1}/{sentences.length}</p>
      </div>
    </div>
  )
}
