import { useEffect, useMemo, useRef, useState, type JSX } from 'react'

import type { TtsEngine, TtsStatus, TtsVoice } from '../../shared/types.js'
import { combineAudioSegments } from '../lib/audio-export.js'
import { t, useLocale } from '../lib/i18n.js'
import { parseListenScript, pickPodcastVoices, voiceLabel } from '../lib/listen-script.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import { BeatraGuideDialog } from './BeatraGuideDialog.js'
import { confirmDialog } from './ConfirmDialog.js'
import { Select } from './Select.js'

interface ListenPanelProps {
  title: string
  text: string
  onClose(): void
}

const TTS_ENGINE_KEY = 'reading-notes-tts-engine'
const EDGE_DEFAULT_A = 'zh-CN-XiaoxiaoNeural'
const EDGE_DEFAULT_B = 'zh-CN-YunxiNeural'

function loadEngine(): TtsEngine {
  try {
    const value = localStorage.getItem(TTS_ENGINE_KEY)
    return value === 'edge' || value === 'beatra' || value === 'openai' ? value : 'system'
  } catch {
    return 'system'
  }
}

function engineHint(engine: TtsEngine, status: TtsStatus | null): string {
  if (engine === 'edge') return t('免费在线音色，接近播客自然度；需要联网，文本会发到 Microsoft，接口非官方，可能限流。')
  if (engine === 'beatra') {
    return status?.beatra.configured
      ? t('付费 AI 配音，自然度高；按字符计费，每次播放会发起一次付费合成，首次播放前会再次确认。')
      : t('付费 AI 配音，自然度高；需要先在设置里配置 Beatra Device Token。')
  }
  if (engine === 'openai') {
    return status?.openai.configured
      ? t('OpenAI 兼容 TTS，支持 gpt-4o-mini-tts 等模型；按字符计费，文本会发到你配置的服务。')
      : t('OpenAI 兼容 TTS；需要先在设置里填写 Base URL、模型、音色和 API Key。')
  }
  return t('离线、零依赖；音色取决于系统，机械感较明显。')
}

function voiceName(voices: Array<{ id: string; label: string }> | undefined, id: string): string {
  return voices?.find((voice) => voice.id === id)?.label ?? id
}

export function ListenPanel({ title, text, onClose }: ListenPanelProps): JSX.Element {
  useLocale()
  const segments = useMemo(() => parseListenScript(text.slice(0, 50_000)), [text])
  const dialogue = segments.some((segment) => segment.speaker !== null)
  const chineseScript = segments.some((segment) => /[一-鿿]/.test(segment.text))
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [engine, setEngine] = useState<TtsEngine>(loadEngine)
  const engineTouched = useRef(false)
  const [ttsStatus, setTtsStatus] = useState<TtsStatus | null>(null)
  const [edgeVoiceA, setEdgeVoiceA] = useState(EDGE_DEFAULT_A)
  const [edgeVoiceB, setEdgeVoiceB] = useState(EDGE_DEFAULT_B)
  const [beatraVoices, setBeatraVoices] = useState<TtsVoice[]>([])
  const [beatraVoiceA, setBeatraVoiceA] = useState('')
  const [beatraVoiceB, setBeatraVoiceB] = useState('')
  const [beatraLoadError, setBeatraLoadError] = useState<string | null>(null)
  const [openaiVoiceA, setOpenaiVoiceA] = useState('alloy')
  const [openaiVoiceB, setOpenaiVoiceB] = useState('verse')
  const [audioLoading, setAudioLoading] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [fullAudioUrl, setFullAudioUrl] = useState<string | null>(null)
  const [fullAudioBase64, setFullAudioBase64] = useState<string | null>(null)
  const [fullAudioDuration, setFullAudioDuration] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const exportCancelRef = useRef(false)
  const currentRef = useRef<HTMLButtonElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioCache = useRef(new Map<string, string>())
  const audioInFlight = useRef(new Map<string, Promise<string>>())
  const beatraConfirmed = useRef(false)
  const userPausedRef = useRef(false)
  const voicePlan = useMemo(
    () => pickPodcastVoices(voices.map((voice) => ({ name: voice.name, lang: voice.lang }))),
    [voices],
  )
  const voiceA = voicePlan.a ? voices.find((voice) => voice.name === voicePlan.a?.name) ?? null : null
  const voiceB = voicePlan.b ? voices.find((voice) => voice.name === voicePlan.b?.name) ?? null : null
  const remoteVoice = (segmentSpeaker: 'A' | 'B' | null): string => {
    if (engine === 'edge') return segmentSpeaker === 'B' ? edgeVoiceB : edgeVoiceA
    if (engine === 'beatra') return segmentSpeaker === 'B' ? beatraVoiceB : beatraVoiceA
    if (engine === 'openai') return segmentSpeaker === 'B' ? openaiVoiceB : openaiVoiceA
    return ''
  }

  async function synthesizeSegment(segmentIndex: number): Promise<string> {
    const segment = segments[segmentIndex]
    if (!segment) throw new Error(t('找不到要合成的句子。'))
    if (engine === 'system') throw new Error(t('系统语音不需要预留音频。'))
    const voice = remoteVoice(segment.speaker)
    const key = `${engine}:${voice}:${speed}:${segment.text}`
    const cached = audioCache.current.get(key)
    if (cached) return cached
    const inFlight = audioInFlight.current.get(key)
    if (inFlight) return inFlight
    const promise = (async () => {
      const audio = await window.api.synthesizeTts({ engine, text: segment.text, voice, rate: speed })
      const binary = atob(audio.base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      // Blob URL 比超长 data: URL 的媒体管线更稳，避免播到一半被浏览器挂起。
      const url = URL.createObjectURL(new Blob([bytes], { type: audio.mime }))
      audioCache.current.set(key, url)
      return url
    })()
    audioInFlight.current.set(key, promise)
    try {
      return await promise
    } finally {
      audioInFlight.current.delete(key)
    }
  }

  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const load = (): void => setVoices(window.speechSynthesis.getVoices())
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])

  useEffect(() => {
    void window.api
      .getTtsStatus()
      .then((status) => {
        setTtsStatus(status)
        const edgeA = status.edge.voices.find((voice) => voice.gender === 'female') ?? status.edge.voices[0]
        const edgeB = status.edge.voices.find((voice) => voice.gender === 'male') ?? status.edge.voices[1] ?? edgeA
        if (edgeA) setEdgeVoiceA(edgeA.id)
        if (edgeB) setEdgeVoiceB(edgeB.id)
        if (status.beatra.configured) {
          void window.api
            .getBeatraVoices()
            .then((voices) => {
              setBeatraVoices(voices)
              // Beatra 同时提供中英文音色；默认优先中文，避免中文稿用英文音色朗读。
              const chinese = voices.filter((voice) => voice.language.toLowerCase().startsWith('zh'))
              const pool = chinese.length > 0 ? chinese : voices
              const a = pool.find((voice) => voice.gender === 'female') ?? pool[0]
              const b = pool.find((voice) => voice.gender === 'male') ?? pool[1] ?? a
              if (a) setBeatraVoiceA(a.id)
              if (b) setBeatraVoiceB(b.id)
            })
            .catch((err: unknown) => setBeatraLoadError(err instanceof Error ? err.message : String(err)))
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!engineTouched.current) return
    try {
      localStorage.setItem(TTS_ENGINE_KEY, engine)
    } catch {
      // 本地偏好写入失败不影响本次播放。
    }
  }, [engine])

  // 没手动选过引擎时，优先用已配置的 Beatra，其次 Edge；系统语音只作为最后兜底。
  useEffect(() => {
    if (!ttsStatus) return
    try {
      if (localStorage.getItem(TTS_ENGINE_KEY)) {
        engineTouched.current = true
        return
      }
    } catch {
      // 存储不可用时仍然按状态选默认。
    }
    engineTouched.current = true
    setEngine(ttsStatus.beatra.configured ? 'beatra' : ttsStatus.openai.configured ? 'openai' : 'edge')
  }, [ttsStatus])

  useEffect(() => {
    if (!ttsStatus) return
    setOpenaiVoiceA(ttsStatus.openai.voiceA)
    setOpenaiVoiceB(ttsStatus.openai.voiceB)
  }, [ttsStatus])

  useEffect(() => {
    exportCancelRef.current = true
    setFullAudioUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return null
    })
    setFullAudioBase64(null)
    setFullAudioDuration(0)
  }, [engine, speed, edgeVoiceA, edgeVoiceB, beatraVoiceA, beatraVoiceB])

  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [index])

  useEffect(() => {
    if (!playing || engine !== 'system') return
    if (!('speechSynthesis' in window)) {
      setError(t('当前环境没有可用的语音合成。'))
      setPlaying(false)
      return
    }
    const segment = segments[index]
    if (!segment) {
      setPlaying(false)
      return
    }
    let cancelled = false
    const utterance = new SpeechSynthesisUtterance(segment.text)
    const isChinese = /[一-鿿]/.test(segment.text)
    utterance.lang = isChinese ? 'zh-CN' : 'en-US'
    const isB = segment.speaker === 'B'
    const voice = isChinese ? (isB ? voiceB : voiceA) : voices.find((item) => item.lang.toLowerCase().startsWith('en'))
    if (voice) utterance.voice = voice
    utterance.rate = speed * (isB ? 1.03 : 1)
    // 系统只有一个中文音色时，用音高区分 B，避免两个角色听起来完全一样。
    utterance.pitch = isB ? (voicePlan.distinct ? 0.96 : 0.86) : 1
    utterance.onend = () => {
      if (cancelled) return
      if (index + 1 < segments.length) setIndex(index + 1)
      else {
        setPlaying(false)
        setPaused(false)
      }
    }
    utterance.onerror = (event) => {
      if (cancelled || event.error === 'interrupted' || event.error === 'canceled') return
      setError(t('朗读中断了，可以再点一次播放。'))
      setPlaying(false)
    }
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    return () => {
      cancelled = true
      window.speechSynthesis.cancel()
    }
  }, [playing, engine, index, segments, speed, voices, voiceA, voiceB, voicePlan.distinct])

  useEffect(() => {
    if (!playing || engine === 'system') return
    const segment = segments[index]
    if (!segment) {
      setPlaying(false)
      return
    }
    let cancelled = false
    let watchdog = 0
    setAudioLoading(true)
    setError(null)
    void (async () => {
      try {
        const url = await synthesizeSegment(index)
        if (cancelled) return
        // Edge 预取后两句；Beatra 只预取一句，避免未听先计费。
        const ahead = engine === 'edge' ? 2 : 1
        for (let offset = 1; offset <= ahead; offset++) {
          if (index + offset >= segments.length) break
          void synthesizeSegment(index + offset).catch(() => undefined)
        }
        const player = new Audio(url)
        player.preload = 'auto'
        audioRef.current = player
        let advanced = false
        const finishSegment = (): void => {
          if (cancelled || advanced) return
          advanced = true
          if (watchdog) window.clearInterval(watchdog)
          if (index + 1 < segments.length) setIndex(index + 1)
          else {
            setPlaying(false)
            setPaused(false)
            setAudioLoading(false)
          }
        }
        player.onended = finishSegment
        player.onerror = () => {
          if (cancelled) return
          setError(t('音频播放失败，已切回系统语音。'))
          engineTouched.current = false
          setEngine('system')
        }
        // 某些机器上媒体元素会在句尾不触发 ended；用时间进度做兜底。
        let lastTime = -1
        let lastProgressAt = Date.now()
        let retried = false
        watchdog = window.setInterval(() => {
          if (cancelled || player.paused || advanced) return
          if (player.ended || (Number.isFinite(player.duration) && player.duration > 0 && player.currentTime >= player.duration - 0.12)) {
            finishSegment()
            return
          }
          if (player.paused && !userPausedRef.current) {
            if (Date.now() - lastProgressAt > 2_000) {
              void player.play().catch(() => undefined)
            }
            if (Date.now() - lastProgressAt > 8_000) {
              setError(t('音频被系统暂停了，可以点播放继续，或换一个音色。'))
              setPlaying(false)
              setPaused(true)
            }
            return
          }
          if (player.currentTime > lastTime + 0.02) {
            lastTime = player.currentTime
            lastProgressAt = Date.now()
            retried = false
            return
          }
          if (Date.now() - lastProgressAt < 5_000) return
          if (!retried) {
            retried = true
            lastProgressAt = Date.now()
            void player.play().catch(() => undefined)
            return
          }
          setError(t('音频播放卡住了，已暂停；可以点播放继续，或换一个音色。'))
          setPlaying(false)
          setPaused(true)
        }, 500)
        setAudioLoading(false)
        await player.play()
        setPaused(false)
      } catch (err) {
        if (cancelled) return
        const message = (err instanceof Error ? err.message : String(err))
          .replace(/^Error invoking remote method '[^']+':\s*/, '')
          .replace(/^Error:\s*/, '')
        setAudioLoading(false)
        const label = engine === 'edge' ? t('Edge 在线音色') : t('Beatra 付费配音')
        setError(`${label}${t('不可用')}（${message}）${t('，已切回系统语音。')}`)
        engineTouched.current = false
        setEngine('system')
      }
    })()
    return () => {
      cancelled = true
      if (watchdog) window.clearInterval(watchdog)
      audioRef.current?.pause()
      audioRef.current = null
      userPausedRef.current = false
      setAudioLoading(false)
    }
  }, [playing, engine, index, segments, speed, edgeVoiceA, edgeVoiceB, beatraVoiceA, beatraVoiceB])

  useEffect(
    () => () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
      audioRef.current?.pause()
      audioRef.current = null
      for (const url of audioCache.current.values()) URL.revokeObjectURL(url)
      audioCache.current.clear()
      setFullAudioUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return null
      })
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

  async function toggle(): Promise<void> {
    setError(null)
    if (engine === 'beatra' && !beatraConfirmed.current) {
      const confirmed = await confirmDialog({
        title: t('使用 Beatra 付费配音'),
        message:
          t('Beatra 按字符计费。播放会按句子逐段合成，并提前预取下一句；失败不会自动重试。继续使用？'),
        confirmLabel: t('继续使用'),
      })
      if (!confirmed) return
      beatraConfirmed.current = true
    }
    if (audioLoading) {
      // 在线合成需要几秒；再次点击不应把正在生成的播放取消。
      return
    }
    if (engine === 'beatra' && !ttsStatus?.beatra.configured) {
      setError(t('Beatra 还没有配置，请到设置里填写 Device Token，或先切换到其他音色。'))
      return
    }
    if (engine === 'system' && !('speechSynthesis' in window)) {
      setError(t('当前环境没有可用的语音合成。'))
      return
    }
    if (!playing) {
      setPaused(false)
      setPlaying(true)
      return
    }
    if (engine !== 'system') {
      if (paused) {
        userPausedRef.current = false
        void audioRef.current?.play()
        setPaused(false)
      } else {
        userPausedRef.current = true
        audioRef.current?.pause()
        setPaused(true)
      }
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
    if (next < 0 || next >= segments.length) return
    if (next === index) {
      if (paused) {
        if (engine === 'system') window.speechSynthesis.resume()
        else void audioRef.current?.play()
        setPaused(false)
      } else if (!playing) {
        setPlaying(true)
      }
      return
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    audioRef.current?.pause()
    audioRef.current = null
    userPausedRef.current = false
    setPaused(false)
    setIndex(next)
    setPlaying(true)
  }

  function selectEngine(value: string): void {
    const next = value === 'edge' || value === 'beatra' ? value : 'system'
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    audioRef.current?.pause()
    audioRef.current = null
    userPausedRef.current = false
    engineTouched.current = true
    setEngine(next)
    setPaused(false)
    setError(null)
  }

  async function generateFullAudio(): Promise<void> {
    if (exporting) return
    if (engine === 'system') {
      setError(t('系统语音不支持导出整段音频，请切换到 Edge 或 Beatra。'))
      return
    }
    if (engine === 'beatra' && !ttsStatus?.beatra.configured) {
      setError(t('Beatra 还没有配置，无法生成整章音频。'))
      return
    }
    const chars = segments.reduce((sum, segment) => sum + segment.text.length, 0)
    if (engine === 'beatra') {
      const confirmed = await confirmDialog({
        title: t('生成整章 Beatra 音频'),
        message: `${t('会按')} ${segments.length} ${t('段')}、${t('共')} ${chars.toLocaleString()} ${t('字生成音频，Beatra 按字符计费，可能产生较高费用。继续？')}`,
        confirmLabel: t('生成整章'),
      })
      if (!confirmed) return
    }
    setExporting(true)
    setExportProgress(0)
    setError(null)
    exportCancelRef.current = false
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    audioRef.current?.pause()
    audioRef.current = null
    setPlaying(false)
    setPaused(false)
    try {
      const parts: Array<{ base64: string; mime: string }> = []
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
        if (exportCancelRef.current) throw new Error('cancelled')
        const segment = segments[segmentIndex]!
        const audio = await window.api.synthesizeTts({
          engine,
          text: segment.text,
          voice: remoteVoice(segment.speaker),
          rate: speed,
        })
        parts.push({ base64: audio.base64, mime: audio.mime })
        setExportProgress(segmentIndex + 1)
        // 让进度和取消按钮有机会更新，避免长章节把渲染线程一次占满。
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
      if (exportCancelRef.current) throw new Error('cancelled')
      const combined = await combineAudioSegments(parts)
      const url = URL.createObjectURL(new Blob([combined.wav], { type: 'audio/wav' }))
      setFullAudioUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return url
      })
      setFullAudioBase64(combined.base64)
      setFullAudioDuration(combined.duration)
    } catch (err) {
      if (!(err instanceof Error && err.message === 'cancelled')) {
        const message = (err instanceof Error ? err.message : String(err))
          .replace(/^Error invoking remote method '[^']+':\s*/, '')
          .replace(/^Error:\s*/, '')
        setError(`${t('整章音频生成失败')}：${message}`)
      }
    } finally {
      setExporting(false)
    }
  }

  async function saveFullAudio(): Promise<void> {
    if (!fullAudioBase64) return
    try {
      const result = await window.api.saveAudio(fullAudioBase64, `页边-${title}-整章.wav`)
      if (result.saved) setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function cancelFullAudio(): void {
    exportCancelRef.current = true
  }

  const edgeVoices = ttsStatus?.edge.voices ?? []
  const edgeVoiceOptions = edgeVoices.map((voice) => ({ value: voice.id, label: voice.label }))
  const beatraVoiceOptions = [...beatraVoices]
    .sort((a, b) => Number(!a.language.toLowerCase().startsWith('zh')) - Number(!b.language.toLowerCase().startsWith('zh')))
    .map((voice) => ({ value: voice.id, label: `${voice.label} · ${voice.language}` }))
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose, 'button')

  return (
    <div className="listen-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="listen-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('听读')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="listen-head">
          <div>
            <h2>{dialogue ? t('双人播客') : t('听读')}</h2>
            <p>{title}</p>
          </div>
          <div className="listen-controls">
            <button type="button" className="ghost-button small" onClick={() => jump(index - 1)} disabled={index === 0}>
              {t('上一句')}
            </button>
            <button type="button" className="primary-button small" onClick={() => void toggle()}>
              {audioLoading ? t('生成中…') : !playing ? t('播放') : paused ? t('继续') : t('暂停')}
            </button>
            <button
              type="button"
              className="ghost-button small"
              onClick={() => jump(index + 1)}
              disabled={index >= segments.length - 1}
            >
              {t('下一句')}
            </button>
            <Select
              className="listen-speed"
              value={String(speed)}
              onChange={(value) => setSpeed(Number(value))}
              ariaLabel={t('语速')}
              options={[
                { value: '0.8', label: '0.8×' },
                { value: '1', label: '1×' },
                { value: '1.2', label: '1.2×' },
                { value: '1.5', label: '1.5×' },
              ]}
            />
            <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
              ×
            </button>
          </div>
        </div>

        <div className="listen-engine-bar">
          <label>
            <span>{t('音色引擎')}</span>
            <Select
              className="listen-engine-select"
              value={engine}
              onChange={selectEngine}
              ariaLabel={t('音色引擎')}
              options={[
                { value: 'system', label: t('系统语音（离线）') },
                { value: 'edge', label: t('Edge 在线（免费）') },
                { value: 'beatra', label: ttsStatus?.beatra.configured ? t('Beatra 付费（已配置）') : t('Beatra 付费（未配置）') },
                { value: 'openai', label: ttsStatus?.openai.configured ? t('OpenAI TTS（已配置）') : t('OpenAI TTS（未配置）') },
              ]}
            />
          </label>
          {engine === 'edge' ? (
            <>
              <label>
                <span>{t('A 音色')}</span>
                <Select
                  className="listen-voice-select"
                  value={edgeVoiceA}
                  onChange={setEdgeVoiceA}
                  ariaLabel={t('Edge A 音色')}
                  options={edgeVoiceOptions}
                />
              </label>
              <label>
                <span>{t('B 音色')}</span>
                <Select
                  className="listen-voice-select"
                  value={edgeVoiceB}
                  onChange={setEdgeVoiceB}
                  ariaLabel={t('Edge B 音色')}
                  options={edgeVoiceOptions}
                />
              </label>
            </>
          ) : null}
          {engine === 'openai' ? (
            <>
              <label>
                <span>{t('A 音色')}</span>
                <input
                  className="listen-voice-input"
                  value={openaiVoiceA}
                  onChange={(event) => setOpenaiVoiceA(event.target.value)}
                  aria-label={t('OpenAI A 音色')}
                />
              </label>
              <label>
                <span>{t('B 音色')}</span>
                <input
                  className="listen-voice-input"
                  value={openaiVoiceB}
                  onChange={(event) => setOpenaiVoiceB(event.target.value)}
                  aria-label={t('OpenAI B 音色')}
                />
              </label>
            </>
          ) : null}
          {engine === 'beatra' && ttsStatus?.beatra.configured && beatraVoices.length > 0 ? (
            <>
              <label>
                <span>{t('A 音色')}</span>
                <Select
                  className="listen-voice-select"
                  value={beatraVoiceA}
                  onChange={setBeatraVoiceA}
                  ariaLabel={t('Beatra A 音色')}
                  options={beatraVoiceOptions}
                />
              </label>
              <label>
                <span>{t('B 音色')}</span>
                <Select
                  className="listen-voice-select"
                  value={beatraVoiceB}
                  onChange={setBeatraVoiceB}
                  ariaLabel={t('Beatra B 音色')}
                  options={beatraVoiceOptions}
                />
              </label>
            </>
          ) : null}
          <span className="listen-engine-hint">{engineHint(engine, ttsStatus)}</span>
          <span className="listen-engine-compare">
            {t('系统：离线、较机械 · Edge：免费在线、自然 · Beatra：付费、最高自然度')}
          </span>
        </div>

        <div className="listen-full-audio">
          <div className="listen-full-audio-head">
            <div>
              <strong>{t('整章音频')}</strong>
              <span>{t('一次生成并导出一个 WAV，适合播客或离线收听。')}</span>
            </div>
            <div className="listen-full-audio-actions">
              {exporting ? (
                <button type="button" className="ghost-button small" onClick={cancelFullAudio}>
                  {t('取消')}
                </button>
              ) : (
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={() => void generateFullAudio()}
                  disabled={segments.length === 0 || engine === 'system'}
                  title={engine === 'system' ? t('系统语音不支持导出整段音频') : undefined}
                >
                  {engine === 'system' ? t('系统语音不支持导出') : t('生成整章音频')}
                </button>
              )}
              {fullAudioUrl ? (
                <button type="button" className="ghost-button small" onClick={() => void saveFullAudio()}>
                  {t('保存 WAV')}
                </button>
              ) : null}
            </div>
          </div>
          {exporting ? (
            <div className="listen-full-audio-progress" role="status" aria-live="polite">
              <span>{t('正在生成')} {exportProgress} / {segments.length} {t('段')}</span>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${segments.length ? (exportProgress / segments.length) * 100 : 0}%` }} />
              </div>
            </div>
          ) : null}
          {fullAudioUrl ? (
            <audio className="listen-full-audio-player" controls src={fullAudioUrl} preload="metadata" />
          ) : null}
          {fullAudioDuration > 0 ? <span className="listen-full-audio-meta">{t('约')} {Math.ceil(fullAudioDuration / 60)} {t('分钟')}</span> : null}
        </div>

        {engine === 'beatra' && !ttsStatus?.beatra.configured ? (
          <div className="listen-engine-setup">
            <strong>{t('Beatra 还没有配置')}</strong>
            <p>
              {t('请打开右上角设置，在「Beatra AI 配音」里填写 Device Token。Beatra 按字符计费，播放前不会自动重试或重复扣费。')}
            </p>
          </div>
        ) : null}
        {engine === 'beatra' && beatraLoadError ? <div className="inline-error" role="alert">{beatraLoadError}</div> : null}

        {error ? <div className="inline-error" role="alert">{error}</div> : null}

        <div className="listen-body">
          {segments.length === 0 ? (
            <p className="listen-empty">{t('这一章没有可朗读的文字。')}</p>
          ) : (
            segments.map((segment, segmentIndex) => (
              <button
                key={segmentIndex}
                ref={segmentIndex === index ? currentRef : undefined}
                type="button"
                className={`listen-sentence${segmentIndex === index ? ' is-current' : ''}`}
                onClick={() => jump(segmentIndex)}
              >
                {segment.speaker ? (
                  <span className={`listen-speaker speaker-${segment.speaker.toLowerCase()}`}>{segment.speaker}</span>
                ) : null}
                <span className="listen-sentence-text">{segment.text}</span>
              </button>
            ))
          )}
        </div>
        <p className="listen-foot">
          {engine === 'beatra'
            ? `${t('中文普通话')} · ${t('Beatra 付费')} · A ${voiceName(beatraVoices, beatraVoiceA)} · B ${voiceName(beatraVoices, beatraVoiceB)}`
            : engine === 'edge'
              ? `${t('中文普通话')} · ${t('Edge 在线')} · A ${voiceName(edgeVoices, edgeVoiceA)} · B ${voiceName(edgeVoices, edgeVoiceB)}`
              : dialogue
                ? `${t('中文普通话')} · A ${voiceLabel(voicePlan.a)} · B ${voiceLabel(voicePlan.b)}${voicePlan.distinct ? '' : t('（B 用音高区分）')}`
                : `${chineseScript ? t('中文普通话') : t('英语')} · ${t('系统语音')}${chineseScript && voicePlan.a ? ` · ${voiceLabel(voicePlan.a)}` : ''}`}
          {' · '}{t('点击任意一句从这里开始')} · {index + 1}/{segments.length}
        </p>
      </div>
      <BeatraGuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  )
}
