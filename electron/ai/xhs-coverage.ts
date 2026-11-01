import { generateText } from 'ai'

import type { XhsCoverageAudit } from '../../shared/types.js'

import { createLanguageModel, type ModelConfig } from './provider.js'

export interface XhsCoverageChapter {
  id: string
  title: string
  text: string
}

export interface XhsCoverageCard {
  title: string
  content: string
  chapterTitle: string | null
}

const MAX_CHAPTER_CHARS = 18_000
const MAX_TOTAL_CHARS = 70_000

function cleanJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as unknown
  } catch {
    return null
  }
}

/** 用当前阅读模型检查「原章正文」和已有卡片之间是否有明显漏点。 */
export async function auditXhsCoverage(args: {
  config: ModelConfig
  demo: boolean
  bookTitle: string
  chapters: XhsCoverageChapter[]
  cards: XhsCoverageCard[]
}): Promise<XhsCoverageAudit> {
  if (args.demo) {
    return { missing: [], checkedChapters: args.chapters.length, note: '演示模式不会调用模型做覆盖检查。' }
  }
  if (!args.config.apiKey && args.config.provider !== 'ollama') {
    throw new Error('还没有配置 API Key，无法检查原书覆盖。')
  }
  if (args.cards.length === 0) return { missing: [], checkedChapters: 0, note: '还没有核心卡片。' }

  let budget = MAX_TOTAL_CHARS
  const chapters = args.chapters
    .map((chapter) => {
      const text = chapter.text.slice(0, Math.min(MAX_CHAPTER_CHARS, budget))
      budget -= text.length
      return { ...chapter, text }
    })
    .filter((chapter) => chapter.text.trim().length > 0 && budget >= 0)

  const cardLines = args.cards
    .map((card, index) => `${index + 1}. [${card.chapterTitle ?? '未分章'}] ${card.title}：${card.content}`)
    .join('\n')
    .slice(0, 24_000)
  const chapterText = chapters
    .map((chapter) => `## ${chapter.title}\n${chapter.text}`)
    .join('\n\n')
  const model = createLanguageModel(args.config)
  const result = await generateText({
    model,
    system:
      '你是严谨的阅读编辑。只根据用户提供的章节正文和已有卡片，找出正文中存在、但卡片没有覆盖到的明确知识点。不要为了凑数制造观点，不要把例子、铺垫、重复表述当成新知识点。',
    prompt: [
      `书：${args.bookTitle}`,
      '',
      '已有卡片：',
      cardLines,
      '',
      '章节正文：',
      chapterText,
      '',
      '请输出 JSON：',
      '{"missing":[{"chapterTitle":"章节名","point":"一句具体的漏点","evidence":"正文中的短引用"}]}',
      '没有明显漏点时返回 {"missing":[]}。最多列出 20 条；每条 point 不超过 80 字，evidence 不超过 80 字。',
    ].join('\n'),
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(120_000),
  })
  const parsed = cleanJson(result.text)
  const rawMissing =
    parsed && typeof parsed === 'object' && Array.isArray((parsed as { missing?: unknown }).missing)
      ? ((parsed as { missing: unknown[] }).missing)
      : []
  const missing = rawMissing
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const value = item as Record<string, unknown>
      const point = typeof value.point === 'string' ? value.point.replace(/\s+/g, ' ').trim() : ''
      if (!point) return null
      const chapterTitle = typeof value.chapterTitle === 'string' ? value.chapterTitle.trim() : null
      const chapter = chapters.find((entry) => entry.title === chapterTitle)
      return {
        id: `coverage:${index}:${point.slice(0, 24)}`,
        chapterId: chapter?.id ?? chapters[0]?.id ?? null,
        chapterTitle: chapter?.title ?? chapterTitle,
        point: point.slice(0, 120),
        evidence: typeof value.evidence === 'string' ? value.evidence.replace(/\s+/g, ' ').trim().slice(0, 160) : '',
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 20)
  return {
    missing,
    checkedChapters: chapters.length,
    note:
      missing.length > 0
        ? `模型发现 ${missing.length} 个可能的漏点；已按章节列在下方，建议人工核对。`
        : '模型没有发现明显漏点；这仍是辅助检查，不等于形式化证明。',
  }
}
