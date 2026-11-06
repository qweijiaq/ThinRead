import { useEffect, useMemo, useRef, useState, type JSX } from 'react'

import type { SettingsView, TtsStatus } from '../../shared/types.js'
import { combineAudioSegments } from '../lib/audio-export.js'
import { t, useLocale } from '../lib/i18n.js'
import { chooseTtsVoice, parseListenScript } from '../lib/listen-script.js'
import { estimateSpeechCost } from '../lib/tts-cost.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import { confirmDialog } from './ConfirmDialog.js'
import { Select } from './Select.js'

interface ListenPanelProps {
  title: string
  text: string
  scope?: string
  demo?: boolean
  onSettingsChanged?(settings: SettingsView): void
  onClose(): void
}

const RESUME_PREFIX = 'reading-notes-listen-'
const RESUME_MAX_AGE = 30 * 24 * 60 * 60 * 1000

function readResumeIndex(scope: string | undefined, total: number): number {
  if (!scope || total <= 0) return 0
  try {
    const raw = localStorage.getItem(`${RESUME_PREFIX}${scope}`)
    if (!raw) return 0
    const parsed = JSON.parse(raw) as { index?: number; total?: number; at?: number }
    if (parsed.total !== total) return 0
    if (!Number.isFinite(parsed.at) || Date.now() - Number(parsed.at) > RESUME_MAX_AGE) return 0
    const index = Math.floor(Number(parsed.index))
    return Number.isFinite(index) && index > 0 && index < total ? index : 0
  } catch {
    return 0
  }
}

function saveResumeIndex(scope: string | undefined, index: number, total: number): void {
  if (!scope || total <= 0) return
  try {
    localStorage.setItem(`${RESUME_PREFIX}${scope}`, JSON.stringify({ index, total, at: Date.now() }))
  } catch {
    // 本地续听位置写不进去不影响播放。
  }
}

function clearResumeIndex(scope: string | undefined): void {
  if (!scope) return
  try {
    localStorage.removeItem(`${RESUME_PREFIX}${scope}`)
  } catch {
    // 忽略。
  }
}

export function ListenPanel({
  title,
  text,
  scope,
  demo = false,
  onSettingsChanged,
  onClose,
}: ListenPanelProps): JSX.Element {
  useLocale()
  const segments = useMemo(() => parseListenScript(text.slice(0, 50_000)), [text])
  const dialogue = segments.some((segment) => segment.speaker !== null)
  const initialResume = useMemo(() => readResumeIndex(scope, segments.length), [scope, segments.length])
  const [index, setIndex] = useState(initialResume)
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [sleepMinutes, setSleepMinutes] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(
    initialResume > 0 ? t('已从上次位置继续') : null,
  )
  const [ttsStatus, setTtsStatus] = useState<TtsStatus | null>(null)
  const [voiceA, setVoiceA] = useState('')
  const [voiceB, setVoiceB] = useState('')
  const [voiceEn, setVoiceEn] = useState('')
  const [audioLoading, setAudioLoading] = useState(false)
  const [fullAudioUrl, setFullAudioUrl] = useState<string | null>(null)
  const [fullAudioBase64, setFullAudioBase64] = useState<string | null>(null)
  const [fullAudioMp3Base64, setFullAudioMp3Base64] = useState<string | null>(null)
  const [fullAudioDuration, setFullAudioDuration] = useState(0)
  const [gapSeconds, setGapSeconds] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [minimized, setMinimized] = useState(false)
  const exportCancelRef = useRef(false)
  const currentRef = useRef<HTMLButtonElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioCache = useRef(new Map<string, string>())
  const audioInFlight = useRef(new Map<string, Promise<string>>())
  const userPausedRef = useRef(false)
  const voiceSaveRef = useRef<Promise<unknown>>(Promise.resolve())

  function changeVoice(which: 'a' | 'b', value: string): void {
    const nextA = which === 'a' ? value : voiceA
    const nextB = which === 'b' ? value : voiceB
    if (which === 'a') setVoiceA(value)
    else setVoiceB(value)
    voiceSaveRef.current = voiceSaveRef.current
      .then(async () => {
        const current = await window.api.getSettings()
        const saved = await window.api.saveSettings({
          provider: current.provider,
          baseUrl: current.baseUrl,
          model: current.model,
          qwenTtsVoiceA: nextA,
          qwenTtsVoiceB: nextB,
        })
        onSettingsChanged?.(saved)
        setNotice(t('已保存为默认音色。'))
      })
      .catch(() => undefined)
  }

  const remoteVoice = (segmentSpeaker: 'A' | 'B' | null, segmentText: string): string =>
    chooseTtsVoice({ speaker: segmentSpeaker, text: segmentText, voiceA, voiceB, voiceEn })

  async function synthesizeSegment(segmentIndex: number): Promise<string> {
    const segment = segments[segmentIndex]
    if (!segment) throw new Error(t('找不到要合成的句子。'))
    if (!ttsStatus?.qwen.configured) {
      throw new Error(t('千问 TTS 还没有配置，请到设置里填写 Key（或先配置阿里云百炼主 Key）。'))
    }
    const voice = remoteVoice(segment.speaker, segment.text)
    const key = `${voice}:${segment.text}`
    const cached = audioCache.current.get(key)
    if (cached) return cached
    const inFlight = audioInFlight.current.get(key)
    if (inFlight) return inFlight
    const promise = (async () => {
      const audio = await window.api.synthesizeTts({ text: segment.text, voice })
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
    void window.api
      .getTtsStatus()
      .then((status) => {
        setTtsStatus(status)
        setVoiceA(status.qwen.voiceA)
        setVoiceB(status.qwen.voiceB)
        setVoiceEn(status.qwen.voiceEn)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    exportCancelRef.current = true
    setFullAudioUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return null
    })
    setFullAudioBase64(null)
    setFullAudioMp3Base64(null)
    setFullAudioDuration(0)
  }, [speed, voiceA, voiceB, voiceEn, gapSeconds])

  useEffect(() => {
    saveResumeIndex(scope, index, segments.length)
  }, [scope, index, segments.length])

  useEffect(() => {
    if (!sleepMinutes) return
    const timer = window.setTimeout(() => {
      audioRef.current?.pause()
      setPlaying(false)
      setPaused(true)
      setSleepMinutes(0)
      setNotice(t('定时结束，已暂停播放。'))
    }, sleepMinutes * 60_000)
    return () => window.clearTimeout(timer)
  }, [sleepMinutes])

  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [index])

  useEffect(() => {
    if (!playing) return
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
        // 预取下一句，减少句间停顿；只预取一句，避免未听先计费。
        if (index + 1 < segments.length) {
          void synthesizeSegment(index + 1).catch(() => undefined)
        }
        const player = new Audio(url)
        player.preload = 'auto'
        player.playbackRate = speed
        audioRef.current = player
        let advanced = false
        const finishSegment = (): void => {
          if (cancelled || advanced) return
          advanced = true
          if (watchdog) window.clearInterval(watchdog)
          if (index + 1 < segments.length) setIndex(index + 1)
          else {
            clearResumeIndex(scope)
            setSleepMinutes(0)
            setPlaying(false)
            setPaused(false)
            setAudioLoading(false)
          }
        }
        player.onended = finishSegment
        player.onerror = () => {
          if (cancelled) return
          setError(t('音频播放失败，请检查千问 TTS 配置后重试。'))
          setPlaying(false)
          setAudioLoading(false)
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
              setError(t('音频被系统暂停了，可以点播放继续。'))
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
          setError(t('音频播放卡住了，已暂停；可以点播放继续。'))
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
        setError(`${t('千问 TTS 不可用')}（${message}）`)
        setPlaying(false)
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
  }, [playing, index, segments, speed, voiceA, voiceB, voiceEn, scope, ttsStatus])

  useEffect(
    () => () => {
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
      if (event.key === 'Escape') {
        if (minimized) setMinimized(false)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [minimized, onClose])

  async function toggle(): Promise<void> {
    setError(null)
    if (audioLoading) {
      // 在线合成需要几秒；再次点击不应把正在生成的播放取消。
      return
    }
    if (!ttsStatus?.qwen.configured) {
      setError(t('千问 TTS 还没有配置，请到设置里填写 Key（或先配置阿里云百炼主 Key）。'))
      return
    }
    if (!playing) {
      setPaused(false)
      setPlaying(true)
      return
    }
    if (paused) {
      userPausedRef.current = false
      void audioRef.current?.play()
      setPaused(false)
    } else {
      userPausedRef.current = true
      audioRef.current?.pause()
      setPaused(true)
    }
  }

  function jump(next: number): void {
    if (next < 0 || next >= segments.length) return
    if (next === index) {
      if (paused) {
        void audioRef.current?.play()
        setPaused(false)
      } else if (!playing) {
        setPlaying(true)
      }
      return
    }
    audioRef.current?.pause()
    audioRef.current = null
    userPausedRef.current = false
    setPaused(false)
    setIndex(next)
    setPlaying(true)
  }

  async function generateFullAudio(): Promise<void> {
    if (exporting) return
    if (!ttsStatus?.qwen.configured) {
      setError(t('千问 TTS 还没有配置，无法生成整章音频。'))
      return
    }
    const chars = segments.reduce((sum, segment) => sum + segment.text.length, 0)
    const pricePerK = Math.max(0, Number(ttsStatus?.qwen.pricePerK) || 0)
    const cost = estimateSpeechCost(chars, pricePerK)
    const estimate = cost === null ? '' : `，${t('按当前设置估算约')} ¥${cost.toFixed(2)}`
    const confirmed = await confirmDialog({
      title: t('生成整章音频'),
      message: `${t('将按')} ${segments.length} ${t('段')}、${t('共')} ${chars.toLocaleString()} ${t('字请求千问 TTS，按字符计费，可能产生费用；整章音频按原速导出')}${estimate}${t('。实际费用以百炼账单为准，继续？')}`,
      confirmLabel: t('继续生成'),
    })
    if (!confirmed) return
    setExporting(true)
    setExportProgress(0)
    setError(null)
    exportCancelRef.current = false
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
          text: segment.text,
          voice: remoteVoice(segment.speaker, segment.text),
        })
        parts.push({ base64: audio.base64, mime: audio.mime })
        setExportProgress(segmentIndex + 1)
        // 让进度和取消按钮有机会更新，避免长章节把渲染线程一次占满。
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
      if (exportCancelRef.current) throw new Error('cancelled')
      const combined = await combineAudioSegments(parts, gapSeconds)
      const url = URL.createObjectURL(new Blob([combined.wav], { type: 'audio/wav' }))
      setFullAudioUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return url
      })
      setFullAudioBase64(combined.base64)
      setFullAudioMp3Base64(combined.mp3Base64)
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

  async function saveFullAudioMp3(): Promise<void> {
    if (!fullAudioMp3Base64) return
    try {
      const result = await window.api.saveAudio(fullAudioMp3Base64, `页边-${title}-整章.mp3`)
      if (result.saved) setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function cancelFullAudio(): void {
    exportCancelRef.current = true
  }

  const dialogRef = useDialogFocus<HTMLDivElement>(!minimized, onClose, 'button')
  const configured = Boolean(ttsStatus?.qwen.configured)
  const model = ttsStatus?.qwen.model || 'qwen-audio-3.1-tts-flash'
  const aName = voiceA || ttsStatus?.qwen.voiceA || 'longanhuan_v3.1'
  const bName = voiceB || ttsStatus?.qwen.voiceB || 'xunanchuan_v3.1'
  const voiceOptions = [...(ttsStatus?.qwen.voices ?? [])].map((voice) => ({
    value: voice.id,
    label: voice.label,
  }))
  for (const id of [voiceA, voiceB]) {
    if (id && !voiceOptions.some((option) => option.value === id)) voiceOptions.push({ value: id, label: id })
  }

  if (minimized) {
    const segment = segments[index]
    return (
      <div className="listen-mini" role="region" aria-label={t('听读播放器')}>
        <div className="listen-mini-info">
          <span className="listen-mini-kicker">
            {t('听读')} · {index + 1}/{segments.length}
            {sleepMinutes > 0 ? ` · ${t('定时')} ${sleepMinutes} ${t('分钟')}` : ''}
          </span>
          <strong>{title}</strong>
          <span className={`listen-mini-sentence${error ? ' is-error' : ''}`}>
            {error || segment?.text || t('这一章没有可朗读的文字。')}
          </span>
        </div>
        <div className="listen-mini-actions">
          <button type="button" className="ghost-button small" onClick={() => jump(index - 1)} disabled={index === 0}>
            {t('上一句')}
          </button>
          <button
            type="button"
            className="primary-button small"
            onClick={() => void toggle()}
            disabled={!configured || segments.length === 0}
            title={configured ? undefined : t('千问 TTS 还没有配置，请到设置里填写 Key（或先配置阿里云百炼主 Key）。')}
          >
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
          <button type="button" className="ghost-button small" onClick={() => setMinimized(false)}>
            {t('展开')}
          </button>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            ×
          </button>
        </div>
      </div>
    )
  }

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
            <button
              type="button"
              className="primary-button small"
              onClick={() => void toggle()}
              disabled={!configured || segments.length === 0}
              title={configured ? undefined : t('千问 TTS 还没有配置，请到设置里填写 Key（或先配置阿里云百炼主 Key）。')}
            >
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
            <span className="listen-timer">
              <span className="listen-timer-label">{t('定时')}</span>
              <Select
                className="listen-speed"
                value={String(sleepMinutes)}
                onChange={(value) => {
                  const next = Number(value)
                  setSleepMinutes(Number.isFinite(next) ? next : 0)
                  setNotice(next > 0 ? `${t('定时')} ${next} ${t('分钟')}` : null)
                }}
                ariaLabel={t('睡眠定时')}
                options={[
                  { value: '0', label: t('关闭') },
                  { value: '15', label: `15 ${t('分钟')}` },
                  { value: '30', label: `30 ${t('分钟')}` },
                  { value: '60', label: `60 ${t('分钟')}` },
                ]}
              />
            </span>
            <button type="button" className="icon-button" onClick={() => setMinimized(true)} aria-label={t('最小化')}>
              –
            </button>
            <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
              ×
            </button>
          </div>
        </div>

        <div className="listen-engine-bar">
          <label>
            <span>{t('语音模型')}</span>
            <span className="listen-engine-name">{model}</span>
          </label>
          <label>
            <span>{t('A 音色')}</span>
            <Select
              className="listen-voice-select"
              value={voiceA}
              onChange={(value) => changeVoice('a', value)}
              ariaLabel={t('千问 A 音色')}
              options={voiceOptions}
            />
          </label>
          <label>
            <span>{t('B 音色')}</span>
            <Select
              className="listen-voice-select"
              value={voiceB}
              onChange={(value) => changeVoice('b', value)}
              ariaLabel={t('千问 B 音色')}
              options={voiceOptions}
            />
          </label>
          <span className="listen-engine-hint">
            {configured
              ? t('千问 TTS · 阿里云百炼 · 按字符计费，文本会发送到该服务。')
              : demo
                ? t('演示模式不包含语音合成；配置千问 TTS Key 后即可使用。')
                : t('千问 TTS 还没有配置；请到右上角设置填写 Key，或先配置阿里云百炼主 Key。')}
          </span>
          <span className="listen-engine-hint">{t('更改 A/B 音色会保存为默认音色。')}</span>
        </div>

        <div className="listen-full-audio">
          <div className="listen-full-audio-head">
            <div>
              <strong>{t('整章音频')}</strong>
              <span>{t('一次生成并导出 WAV 或 MP3，适合播客或离线收听；播放速度只影响试听。')}</span>
            </div>
            <div className="listen-full-audio-actions">
              <label className="listen-gap-control">
                <span>{t('段落间隔')}</span>
                <Select
                  className="listen-gap"
                  value={String(gapSeconds)}
                  onChange={(value) => setGapSeconds(Number(value))}
                  ariaLabel={t('段落间隔')}
                  options={[
                    { value: '0', label: t('无间隔') },
                    { value: '0.5', label: `0.5 ${t('秒')}` },
                    { value: '1', label: `1 ${t('秒')}` },
                  ]}
                />
              </label>
              {exporting ? (
                <button type="button" className="ghost-button small" onClick={cancelFullAudio}>
                  {t('取消')}
                </button>
              ) : (
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={() => void generateFullAudio()}
                  disabled={segments.length === 0 || !configured}
                  title={!configured ? t('请先配置千问 TTS') : undefined}
                >
                  {t('生成整章音频')}
                </button>
              )}
              {fullAudioUrl ? (
                <button type="button" className="ghost-button small" onClick={() => void saveFullAudio()}>
                  {t('保存 WAV')}
                </button>
              ) : null}
              {fullAudioMp3Base64 ? (
                <button type="button" className="ghost-button small" onClick={() => void saveFullAudioMp3()}>
                  {t('保存 MP3')}
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

        {ttsStatus && !configured ? (
          <div className="listen-engine-setup">
            <strong>{t('千问 TTS 还没有配置')}</strong>
            <p>
              {t('请打开右上角设置，在「千问 TTS（阿里云百炼）」里填写 Key；如果主模型已经选了阿里云百炼，Key 留空即可复用。文本会发送到该服务，按字符计费。')}
            </p>
          </div>
        ) : null}

        {notice ? <div className="inline-notice" role="status">{notice}</div> : null}
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
          {`${t('千问 TTS')} · ${model} · A ${aName} · B ${bName}`}
          {' · '}{t('点击任意一句从这里开始')} · {index + 1}/{segments.length}
        </p>
      </div>
    </div>
  )
}
