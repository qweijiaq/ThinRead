export type ListenSpeaker = 'A' | 'B' | null

export interface ListenSegment {
  speaker: ListenSpeaker
  text: string
}

const SPEAKER_LINE = /^\s*(?:[-*]\s*)?(?:主持人\s*)?([ABＡＢ])\s*(?:[（(][^）)]{0,20}[）)])?\s*[：:]\s*(.*)$/i

function normalizeSpeaker(value: string): 'A' | 'B' {
  return value.toUpperCase() === 'Ａ' || value.toUpperCase() === 'A' ? 'A' : 'B'
}

function cleanSpokenText(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // 去掉「（第二章第一节）」「（《书名》第二章）」这类出处引用，不要把章节号读出来。
    .replace(/[（(][^（）()]{0,60}第[一二三四五六七八九十百零\d]+\s*[章节][^（）()]{0,40}[）)]/g, '')
    .replace(/[【\[][^【】\[\]]{0,60}第[一二三四五六七八九十百零\d]+\s*[章节][^【】\[\]]{0,40}[】\]]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/[（(]\s*(?:笑|停顿|掌声|音乐|镜头|旁白|主持人|A|B)[^）)]{0,20}[）)]/gi, '')
    .replace(/[\[【]\s*(?:笑|停顿|掌声|音乐|镜头|旁白|主持人|A|B)[^\]】]{0,20}[\]】]/gi, '')
    .replace(/^[#>\s*\-+]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const NON_DIALOGUE_LINE =
  /^(?:#{1,6}\s|[-*_]{3,}$|\||>|[-*+]\s|\d+\.\s|[（(【\[]|本期|参考|嘉宾|时间轴|制作|剪辑|音乐|BGM|片头|片尾|开场|结束|完$|THE END|Shownotes|简介|标题|封面)/i

function isContinuation(line: string, current: string): boolean {
  if (!current) return false
  if (NON_DIALOGUE_LINE.test(line)) return false
  if (SPEAKER_LINE.test(line)) return false
  return true
}

/** 去掉行首/行尾的 Markdown 强调标记，避免 `**A：**` 被当成普通文章。 */
const ROLE_LINE = /^(?:主持人|主播|嘉宾|作者)\s*[ABＡＢ]?\s*[：:]/i
const NON_SPEAKER_NAMES = new Set([
  '本期', '参考', '嘉宾', '时间轴', '制作', '剪辑', '音乐', 'BGM', '片头', '片尾',
  '开场', '结束', '简介', '标题', '封面', '问题', '回答', '总结', '注意', '说明',
  '来源', '正文', '目录', '附录', '注释', '声明', '版权', 'THE END', 'Shownotes',
])
const NAMED_LINE = /^([\u4e00-\u9fa5A-Za-z]{1,6})(?:[（(][^）)]{0,10}[）)])?\s*[：:]\s*(.*)$/

function detectNamedSpeakers(lines: string[]): string[] {
  const counts = new Map<string, number>()
  for (const raw of lines) {
    const line = cleanSpeakerLine(raw)
    if (!line || /^#{1,6}\s/.test(line) || ROLE_LINE.test(line)) continue
    const match = NAMED_LINE.exec(line)
    if (!match) continue
    const name = match[1]!.trim()
    if (!name || /^[ABＡＢ]$/i.test(name) || NON_SPEAKER_NAMES.has(name)) continue
    if (/(本期|参考|说明|来源|版权|声明|时间轴|Shownotes)/i.test(name)) continue
    if ((match[2] ?? '').trim().length < 2) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const names = [...counts.entries()].filter(([, count]) => count >= 1).map(([name]) => name)
  return names.length >= 2 ? names.slice(0, 6) : []
}

function cleanSpeakerLine(value: string): string {
  return value.trim().replace(/^[*_`]+/, '').replace(/[*_`]+$/, '').trim()
}

function splitSentences(value: string): string[] {
  const parts = value
    .split(/(?<=[。！？!?；;])/)
    .map((item) => item.trim())
    .filter(Boolean)
  // 引号、括号等收尾符号本身不是一句话，并回上一句，避免读成单独的“””。
  for (let index = 1; index < parts.length; index++) {
    while (/^[”’」』】）)\]]/.test(parts[index]!)) {
      parts[index - 1] += parts[index]![0]
      parts[index] = parts[index]!.slice(1).trimStart()
      if (!parts[index]) {
        parts.splice(index, 1)
        index--
        break
      }
    }
  }
  return parts.filter(Boolean)
}

/**
 * 解析带 A/B 标记的对白或普通章节。A/B 只用于分配音色，
 * 不会进入朗读文本；章节文本则按句子切成单播音色。
 */
export function parseListenScript(source: string): ListenSegment[] {
  const lines = source
    .replace(/\r\n?/g, '\n')
    .replace(/\[第 \d+ 页\]/g, '')
    .split('\n')
  const hasSpeakerLabels = lines.some((line) => SPEAKER_LINE.test(cleanSpeakerLine(line)))
  const namedSpeakers = hasSpeakerLabels ? [] : detectNamedSpeakers(lines)
  const namedMap = new Map(namedSpeakers.map((name, index) => [name, index % 2 === 0 ? ('A' as const) : ('B' as const)]))

  if (!hasSpeakerLabels && namedMap.size === 0) {
    const text = cleanSpokenText(lines.join('\n'))
    return splitSentences(text).map((text) => ({ speaker: null, text }))
  }

  const turns: Array<{ speaker: 'A' | 'B'; text: string }> = []
  let current: { speaker: 'A' | 'B'; text: string } | null = null
  for (const rawLine of lines) {
    const line = cleanSpeakerLine(rawLine)
    if (!line || /^#{1,6}\s/.test(line) || /^[-*_]{3,}$/.test(line)) continue
    // 「主持人 A：提问、推进」这类角色说明不是对白。
    if (ROLE_LINE.test(line)) continue
    const match = SPEAKER_LINE.exec(line)
    const namedMatch = !match && namedMap.size > 0 ? NAMED_LINE.exec(line) : null
    const namedSpeaker = namedMatch ? namedMap.get(namedMatch[1]!.trim()) : undefined
    if (match || namedSpeaker) {
      const text = cleanSpokenText(match ? (match[2] ?? '') : (namedMatch?.[2] ?? ''))
      current = { speaker: match ? normalizeSpeaker(match[1] ?? 'A') : namedSpeaker!, text }
      turns.push(current)
      continue
    }
    // 只接受“上一句还没说完”的折行；其余一律视为标题、旁白、shownotes 或舞台说明，不朗读。
    if (!current || !isContinuation(line, current.text)) continue
    const text = cleanSpokenText(line)
    if (!text) continue
    current.text = `${current.text}${text}`
  }

  return turns.flatMap((turn) =>
    splitSentences(turn.text).map((text) => ({ speaker: turn.speaker, text })),
  )
}

/** 纯英文段落优先使用英文音色；其余按 A/B 角色分配，B 留空时复用 A。 */
export function chooseTtsVoice(options: {
  speaker: 'A' | 'B' | null
  text: string
  voiceA: string
  voiceB: string
  voiceEn: string
}): string {
  if (options.voiceEn && /[A-Za-z]/.test(options.text) && !/[一-鿿]/.test(options.text)) {
    return options.voiceEn
  }
  if (options.speaker === 'B') return options.voiceB || options.voiceA
  return options.voiceA || options.voiceB
}
