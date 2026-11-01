export type ListenSpeaker = 'A' | 'B' | null

export interface ListenSegment {
  speaker: ListenSpeaker
  text: string
}

export interface VoiceLike {
  name: string
  lang: string
}

export interface PodcastVoicePlan {
  lang: string
  a: VoiceLike | null
  b: VoiceLike | null
  distinct: boolean
}

const SPEAKER_LINE = /^\s*(?:[-*]\s*)?(?:主持人\s*)?([ABＡＢ])\s*(?:[（(][^）)]{0,20}[）)])?\s*[：:]\s*(.*)$/i

function normalizeSpeaker(value: string): 'A' | 'B' {
  return value.toUpperCase() === 'Ａ' || value.toUpperCase() === 'A' ? 'A' : 'B'
}

function cleanSpokenText(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/[（(]\s*(?:笑|停顿|掌声|音乐|镜头|旁白|主持人|A|B)[^）)]{0,20}[）)]/gi, '')
    .replace(/[\[【]\s*(?:笑|停顿|掌声|音乐|镜头|旁白|主持人|A|B)[^\]】]{0,20}[\]】]/gi, '')
    .replace(/^[#>\s*\-+]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitSentences(value: string): string[] {
  return value
    .split(/(?<=[。！？!?；;])/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * 解析播客脚本或普通章节。播客脚本里的 A：/B：只用于分配音色，
 * 不会进入朗读文本；章节文本则按句子切成单播音色。
 */
export function parseListenScript(source: string): ListenSegment[] {
  const lines = source
    .replace(/\r\n?/g, '\n')
    .replace(/\[第 \d+ 页\]/g, '')
    .split('\n')
  const hasSpeakerLabels = lines.some((line) => SPEAKER_LINE.test(line))

  if (!hasSpeakerLabels) {
    const text = cleanSpokenText(lines.join('\n'))
    return splitSentences(text).map((text) => ({ speaker: null, text }))
  }

  const turns: Array<{ speaker: 'A' | 'B'; text: string }> = []
  let current: { speaker: 'A' | 'B'; text: string } | null = null
  for (const rawLine of lines) {
    const line = rawLine.trim().replace(/^[*_`]+/, '').replace(/[*_`]+$/, '').trim()
    if (!line || /^#{1,6}\s/.test(line) || /^[-*_]{3,}$/.test(line)) continue
    const match = SPEAKER_LINE.exec(line)
    if (match) {
      const text = cleanSpokenText(match[2] ?? '')
      if (!text) {
        current = { speaker: normalizeSpeaker(match[1] ?? 'A'), text: '' }
        turns.push(current)
      } else {
        current = { speaker: normalizeSpeaker(match[1] ?? 'A'), text }
        turns.push(current)
      }
      continue
    }
    // 模型偶尔会把一句话折到下一行；归到当前说话人，避免旁白被当第三条声音。
    if (!current) continue
    const text = cleanSpokenText(line)
    if (!text) continue
    current.text = `${current.text}${current.text && !/[。！？!?；;]$/.test(current.text) ? '。' : ''}${text}`
  }

  return turns.flatMap((turn) =>
    splitSentences(turn.text).map((text) => ({ speaker: turn.speaker, text })),
  )
}

/** 优先选两个不同的中文音色；只有一个时用音高区分 B。 */
export function pickPodcastVoices(voices: VoiceLike[]): PodcastVoicePlan {
  const normalized = voices.map((voice) => ({ ...voice, lang: voice.lang.replace('_', '-') }))
  const chinese = normalized.filter((voice) => /^zh(?:-|$)/i.test(voice.lang))
  const simplified = chinese.filter((voice) => /^zh-cn/i.test(voice.lang))
  const pool = simplified.length > 0 ? simplified : chinese
  const unique = pool.filter((voice, index) => pool.findIndex((item) => item.name === voice.name) === index)
  const a = unique[0] ?? null
  const b = unique[1] ?? a
  return { lang: 'zh-CN', a, b, distinct: Boolean(a && b && a.name !== b.name) }
}

export function voiceLabel(voice: VoiceLike | null): string {
  return voice ? `${voice.name}（${voice.lang}）` : '系统默认中文语音'
}
