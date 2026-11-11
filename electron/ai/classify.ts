import { z } from 'zod'

import type { ChapterKind, ChapterSuggestion, ClassifyResult } from '../../shared/types.js'
import { createLanguageModel, nonThinkingProviderOptions } from './provider.js'
import type { ModelConfig } from './provider.js'
import { tracedGenerateText } from './trace.js'

export interface ClassifiableChapter {
  id: string
  idx: number
  title: string
  text: string
}

const AUTO_HIDE: ChapterKind[] = ['cover', 'copyright', 'nav', 'ad', 'index', 'unknown']
const MAX_AI_CHAPTERS = 120
const BATCH_SIZE = 12
const EXCERPT_CHARS = 180

const CHAPTER_KINDS = [
  'content',
  'front',
  'nav',
  'cover',
  'copyright',
  'ad',
  'index',
  'unknown',
] as const

const classifySchema = z.object({
  chapters: z.array(
    z.object({
      index: z.number().int(),
      kind: z.enum(CHAPTER_KINDS),
      reason: z.string().max(80),
      confidence: z.number().min(0).max(1),
    }),
  ),
})

interface Judgment {
  kind: ChapterKind
  reason: string
  confidence: number
}

/** 不依赖 provider 的结构化输出：从自由文本里提取 JSON，再用 zod 校验。 */
export function parseClassifyJson(text: string): z.infer<typeof classifySchema> | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  const candidates = [trimmed]
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      const raw = Array.isArray(parsed) ? { chapters: parsed } : parsed
      if (!raw || typeof raw !== 'object') continue
      const rows = (raw as { chapters?: unknown }).chapters
      if (!Array.isArray(rows)) continue
      // 容忍模型省略 reason/confidence 或把数字写成字符串。
      const chapters = rows
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const row = item as Record<string, unknown>
          const index = Number(row.index)
          const rawKind = typeof row.kind === 'string' ? row.kind.trim() : ''
          if (!Number.isFinite(index) || !rawKind) return null
          const confidence = Number(row.confidence)
          return {
            index,
            kind: rawKind,
            reason: typeof row.reason === 'string' ? row.reason.trim().slice(0, 80) : '',
            confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.8,
          }
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
      if (chapters.length === 0) continue
      const checked = classifySchema.safeParse({ chapters })
      if (checked.success) return checked.data
    } catch {
      // 继续尝试下一段文本。
    }
  }
  return null
}

export function classifyHeuristically(chapters: ClassifiableChapter[]): ChapterSuggestion[] {
  return chapters.map((chapter) => {
    const judgment = classifyOne(chapter)
    return {
      chapterId: chapter.id,
      kind: judgment.kind,
      reason: judgment.reason,
      confidence: judgment.confidence,
      hidden: shouldAutoHide(judgment.kind, judgment.confidence),
    }
  })
}

function shouldAutoHide(kind: ChapterKind, confidence: number): boolean {
  if (!AUTO_HIDE.includes(kind)) return false
  return confidence >= (kind === 'unknown' ? 0.85 : 0.75)
}

function classifyOne(chapter: ClassifiableChapter, options: { skipToc?: boolean } = {}): Judgment {
  const title = chapter.title.trim()
  const text = chapter.text.trim()
  const chars = text.length
  const head = text.slice(0, 800)

  if (/^(封面|cover|书名页|title\s*page)$/i.test(title) || (/封面|书名页/.test(title) && chars < 1500)) {
    return { kind: 'cover', reason: '封面或书名页', confidence: 0.94 }
  }
  if (/(版权|copyright|出版信息|图书在版编目|CIP\s*数据|ISBN)/i.test(title) || /版权所有|图书在版编目|ISBN\s*97[89]/i.test(head)) {
    return { kind: 'copyright', reason: '版权/出版信息页', confidence: 0.92 }
  }
  if (/^(目\s*录(页)?|contents|table of contents)$/i.test(title)) {
    return { kind: 'nav', reason: '目录页', confidence: 0.96 }
  }
  if (/(索引|index)$/i.test(title) && chars < 8000) {
    return { kind: 'index', reason: '索引页', confidence: 0.9 }
  }
  if (/(扫码|二维码|公众号|关注公众号|微信号|QQ\s*群|加微信|培训班|网校|招生|课程报名|优惠|促销)/i.test(head)) {
    return { kind: 'ad', reason: '广告或推广内容', confidence: 0.88 }
  }
  if (/(序言|前言|自序|译序|推荐序|扉页|献词|题记|preface|foreword)/i.test(title)) {
    return { kind: 'front', reason: '前言/序/扉页', confidence: 0.7 }
  }
  if (/^([上下中]篇|第\s*[0-9一二三四五六七八九十百千零两]+\s*篇|part\s+[0-9ivxlcdm]+)/i.test(title)) {
    return { kind: 'front', reason: '篇/部标题页', confidence: 0.8 }
  }
  if (chars < 30) {
    return { kind: 'unknown', reason: '内容过短，可能是空白页或残留页', confidence: 0.9 }
  }
  if (garbledRatio(text) > 0.12) {
    return { kind: 'unknown', reason: '包含大量乱码或无法识别的字符', confidence: 0.9 }
  }
  if (!options.skipToc && looksLikeTableOfContents(text)) {
    return { kind: 'nav', reason: '正文主要是一串章节标题', confidence: 0.8 }
  }
  return { kind: 'content', reason: '', confidence: 0.9 }
}

function garbledRatio(text: string): number {
  if (text.length === 0) return 0
  let bad = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (char === '�' || (code < 32 && char !== '\n' && char !== '\t' && char !== '\r')) bad++
    if (code >= 0xe000 && code <= 0xf8ff) bad++
  }
  return bad / text.length
}

function looksLikeTableOfContents(text: string): boolean {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 6) return false
  const short = lines.filter((line) => line.length <= 40).length
  const chapterLike = lines.filter((line) => /^(第[一二三四五六七八九十百千\d]+[章节篇卷]|\d+[.、\s])/.test(line)).length
  return short / lines.length > 0.8 && chapterLike >= Math.min(4, lines.length * 0.25)
}

export function judgeChapter(
  chapter: { title: string; text: string },
  options: { skipToc?: boolean } = {},
): Judgment {
  return classifyOne({ id: '', idx: 0, title: chapter.title, text: chapter.text }, options)
}

export function shouldAutoHideChapter(kind: ChapterKind, confidence: number): boolean {
  return shouldAutoHide(kind, confidence)
}

export async function classifyChapters(
  chapters: ClassifiableChapter[],
  config: ModelConfig,
): Promise<ClassifyResult> {
  const heuristic = classifyHeuristically(chapters)
  if (config.provider === 'demo') {
    return { suggestions: heuristic, mode: 'demo' }
  }
  if (!config.apiKey) {
    return { suggestions: heuristic, mode: 'heuristic', error: '还没有配置 API Key，已使用本地规则识别。' }
  }

  try {
    const ai = await classifyWithAI(chapters.slice(0, MAX_AI_CHAPTERS), config)
    const byId = new Map<string, Judgment>()
    for (const [chapterId, judgment] of ai) byId.set(chapterId, judgment)
    const suggestions = chapters.map((chapter) => {
      const judgment = byId.get(chapter.id)
      if (!judgment) {
        const base = heuristic.find((item) => item.chapterId === chapter.id)!
        return base
      }
      return {
        chapterId: chapter.id,
        kind: judgment.kind,
        reason: judgment.reason,
        confidence: judgment.confidence,
        hidden: shouldAutoHide(judgment.kind, judgment.confidence),
      }
    })
    return { suggestions, mode: 'ai' }
  } catch (error) {
    return {
      suggestions: heuristic,
      mode: 'heuristic',
      error: `AI 识别失败，已回退到本地规则：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function classifyWithAI(
  chapters: ClassifiableChapter[],
  config: ModelConfig,
): Promise<Map<string, Judgment>> {
  const model = createLanguageModel(config)
  const result = new Map<string, Judgment>()

  for (let offset = 0; offset < chapters.length; offset += BATCH_SIZE) {
    const batch = chapters.slice(offset, offset + BATCH_SIZE)
    const payload = batch.map((chapter) => ({
      index: chapter.idx,
      title: chapter.title,
      chars: chapter.text.length,
      excerpt: chapter.text.replace(/\s+/g, ' ').slice(0, EXCERPT_CHARS),
    }))

    const prompt = [
      '你在整理一本电子书的目录。判断下面每一节是否属于正文内容。',
      '分类：content=正文；front=前言/序/扉页/献词；nav=目录；cover=封面；copyright=版权或出版信息；ad=广告或推广；index=索引；unknown=空白页、乱码或无法识别。',
      '只根据标题、字数和开头摘录判断；不确定时选 content，不要过度删除。',
      '输入：',
      JSON.stringify(payload),
      '只返回一个 JSON 对象，格式为 {"chapters": [{"index": 0, "kind": "content", "reason": "…", "confidence": 0.9}]}，与输入 index 一一对应。不要输出 Markdown 代码块、思考过程或额外解释。',
    ].join('\n')
    const traceMeta = {
      step: 'classify-chapters',
      provider: config.provider,
      model: config.model,
      promptVersion: 'classify-v3',
    }
    const providerOptions = nonThinkingProviderOptions(config)
    const response = await tracedGenerateText(traceMeta, {
      model,
      prompt,
      // 有些模型会把思考 token 也算进输出；给足空间，避免 JSON 还没开始就被截断。
      maxOutputTokens: 6_000,
      ...(providerOptions ? { providerOptions } : {}),
      abortSignal: AbortSignal.timeout(60_000),
    })
    let parsed = parseClassifyJson(response.text)
    if (!parsed) {
      // 兼容不支持结构化输出或第一次被截断的模型：再给一次更严格的 JSON 指令。
      const retry = await tracedGenerateText(
        { ...traceMeta, step: 'classify-chapters-retry' },
        {
          model,
          prompt: `${prompt}\n\n重要：上一次没有返回可解析的 JSON。请只输出一个合法 JSON 对象，不要任何解释、思考过程或 Markdown 代码块。`,
          maxOutputTokens: 8_000,
          ...(providerOptions ? { providerOptions } : {}),
          abortSignal: AbortSignal.timeout(60_000),
        },
      )
      parsed = parseClassifyJson(retry.text)
    }
    if (!parsed) throw new Error('模型没有返回可解析的目录 JSON，请换一个模型或稍后重试。')

    for (const item of parsed.chapters) {
      const chapter = batch.find((candidate) => candidate.idx === item.index)
      if (!chapter) continue
      result.set(chapter.id, {
        kind: item.kind as ChapterKind,
        reason: item.reason.trim() || kindLabel(item.kind),
        confidence: item.confidence,
      })
    }
  }

  return result
}

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    content: '正文',
    front: '前言/序',
    nav: '目录',
    cover: '封面',
    copyright: '版权页',
    ad: '广告',
    index: '索引',
    unknown: '无法识别',
  }
  return labels[kind] ?? kind
}
