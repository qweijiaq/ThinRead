import { Output, streamText } from 'ai'

import type { ChatAnswer, ChatCitation, ChatMode, ChatTurn, FeynmanResult } from '../../shared/types.js'
import { chatOutputSchema, feynmanResultSchema } from '../../shared/schemas.js'
import { normalizeForMatch } from '../html.js'
import type { ModelConfig } from './provider.js'
import { createLanguageModel } from './provider.js'
import { queryTerms, retrievePassages, scoreText } from './context.js'
import { tracedGenerateText, traceStreamUsage } from './trace.js'

const TUTOR_PROMPT_VERSION = 'tutor-v2'
const MAX_ANSWER_TOKENS = 1_200

export interface TutorContext {
  bookTitle: string
  chapterTitle: string
  chapterText: string
  condensed: string
  cards: Array<{ title: string; content: string; role: string | null; quote: string | null }>
}

const ANSWER_SYSTEM = [
  '你是「页边」里的读书助手。你只根据用户当前这一章的内容回答，不引入章节之外的知识。',
  '回答要直接、具体，控制在 250 字以内。',
  '每条回答必须给出 1–3 条逐字原文依据；找不到依据时明确说「本章没有直接依据」，citations 留空。',
  '如果问题涉及本章之外的内容，先说明本章未涉及，再说明能回答的范围。',
  '只输出 JSON：{"answer":"回答","citations":["原文引用"]}。不要输出 Markdown 代码块。',
].join('\n')

const SOCRATIC_SYSTEM = [
  '你是「页边」里的苏格拉底式阅读教练。你只围绕用户当前这一章提问，不替用户下结论。',
  '先简短回应用户刚才的说法，再提出一个更具体、可回答的问题；一次只问一个问题。',
  '如果用户答对了，追问边界、反例或与别的观点的冲突；如果答偏了，用一个提示把他带回原文。',
  '可以给 1–2 条相关原文作为提示，但不要直接把完整答案讲完。',
  '只输出 JSON：{"answer":"你的回应和问题","citations":["原文引用"]}。不要输出 Markdown 代码块。',
].join('\n')

const FEYNMAN_SYSTEM = [
  '你是「页边」里的阅读教练，正在检查读者是否真正理解了一章。',
  '请对照读薄稿和核心卡片，判断读者的解释：讲到了什么、漏掉了什么、哪里有理解偏差。',
  '反馈要具体、直接、不空泛；先肯定讲对的地方，再指出最值得补的一点。',
  '只输出 JSON：{"feedback":"120 字以内的反馈","covered":["讲到的关键点"],"missing":["漏掉的重要点"],"misconceptions":["理解偏差，没有就空数组"]}。',
  '不要输出 Markdown 代码块或额外解释。',
].join('\n')

export async function askChapter(
  args: {
    config: ModelConfig
    demo: boolean
    context: TutorContext
    question: string
    history: ChatTurn[]
    mode: ChatMode
  },
  onDelta?: (text: string) => void,
): Promise<ChatAnswer> {
  const question = args.question.trim()
  if (!question) throw new Error('先写一个想问的问题。')
  if (args.demo) {
    const answer = demoAnswer(args.context, question, args.mode)
    onDelta?.(answer.answer)
    return answer
  }

  const model = createLanguageModel(args.config)
  const history = conversationDigest(args.history)
  const prompt = [
    contextBlock(args.context, question),
    history.length > 0 ? `对话记录：\n${history.join('\n')}` : '',
    `读者的问题：${question}`,
    args.mode === 'socratic'
      ? '请按苏格拉底式教练的方式回应，先确认读者的理解，再提出一个具体问题。'
      : '请直接回答读者的问题。',
  ]
    .filter(Boolean)
    .join('\n\n')
  const traceMeta = {
    step: 'tutor-ask',
    provider: args.config.provider,
    model: args.config.model,
    promptVersion: TUTOR_PROMPT_VERSION,
  }

  if (onDelta) {
    let emitted = false
    const startedAt = Date.now()
    try {
      const stream = streamText({
        model,
        system: args.mode === 'socratic' ? SOCRATIC_SYSTEM : ANSWER_SYSTEM,
        prompt,
        temperature: args.mode === 'socratic' ? 0.7 : 0.3,
        maxOutputTokens: MAX_ANSWER_TOKENS,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(90_000),
        output: Output.object({ schema: chatOutputSchema }),
      })
      let last = ''
      for await (const partial of stream.partialOutputStream) {
        const text = typeof partial?.answer === 'string' ? partial.answer : ''
        if (text && text !== last) {
          last = text
          emitted = true
          onDelta(text)
        }
      }
      const final = await stream.output
      traceStreamUsage(traceMeta, startedAt, await stream.usage)
      return { answer: final.answer.trim(), citations: normalizeCitations(final.citations, args.context.chapterText) }
    } catch (error) {
      traceStreamUsage(traceMeta, startedAt, undefined, error)
      // 某些 OpenAI-compatible 服务不支持结构化流式输出；尚未产生增量时回退到普通请求。
      if (emitted) throw error
    }
  }

  const response = await tracedGenerateText(traceMeta, {
    model,
    system: args.mode === 'socratic' ? SOCRATIC_SYSTEM : ANSWER_SYSTEM,
    prompt,
    temperature: args.mode === 'socratic' ? 0.7 : 0.3,
    maxOutputTokens: MAX_ANSWER_TOKENS,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(90_000),
  })
  const parsed = parseJsonObject(response.text)
  const answer =
    parsed && typeof parsed.answer === 'string' && parsed.answer.trim()
      ? parsed.answer.trim()
      : response.text.trim()
  const citations = normalizeCitations(parsed?.citations, args.context.chapterText)
  return { answer, citations }
}

export async function evaluateExplanation(
  args: {
    config: ModelConfig
    demo: boolean
    context: TutorContext
    explanation: string
  },
  onDelta?: (text: string) => void,
): Promise<FeynmanResult> {
  const explanation = args.explanation.trim()
  if (explanation.length < 12) throw new Error('再写长一点：用两三句话讲清楚这一章。')
  if (args.demo) {
    const result = demoFeynman(args.context, explanation)
    onDelta?.(result.feedback)
    return result
  }

  const model = createLanguageModel(args.config)
  const prompt = [
    contextBlock(args.context, explanation.slice(0, 4_000)),
    `读者的解释：\n${explanation.slice(0, 4_000)}`,
    '请检查这段解释。',
  ].join('\n\n')
  const traceMeta = {
    step: 'tutor-feynman',
    provider: args.config.provider,
    model: args.config.model,
    promptVersion: TUTOR_PROMPT_VERSION,
  }

  if (onDelta) {
    let emitted = false
    const startedAt = Date.now()
    try {
      const stream = streamText({
        model,
        system: FEYNMAN_SYSTEM,
        prompt,
        temperature: 0.2,
        maxOutputTokens: MAX_ANSWER_TOKENS,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(90_000),
        output: Output.object({ schema: feynmanResultSchema }),
      })
      let last = ''
      for await (const partial of stream.partialOutputStream) {
        const text = typeof partial?.feedback === 'string' ? partial.feedback : ''
        if (text && text !== last) {
          last = text
          emitted = true
          onDelta(text)
        }
      }
      const output = await stream.output
      traceStreamUsage(traceMeta, startedAt, await stream.usage)
      return output
    } catch (error) {
      traceStreamUsage(traceMeta, startedAt, undefined, error)
      if (emitted) throw error
    }
  }

  const response = await tracedGenerateText(traceMeta, {
    model,
    system: FEYNMAN_SYSTEM,
    prompt,
    temperature: 0.2,
    maxOutputTokens: MAX_ANSWER_TOKENS,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(90_000),
  })
  const parsed = parseJsonObject(response.text)
  if (!parsed) throw new Error('模型返回的理解检查无法解析，请重试。')
  return {
    feedback: typeof parsed.feedback === 'string' ? parsed.feedback.trim() : '',
    covered: stringList(parsed.covered),
    missing: stringList(parsed.missing),
    misconceptions: stringList(parsed.misconceptions),
  }
}

function contextBlock(context: TutorContext, query: string): string {
  // 卡片和原文都按问题检索，避免多轮对话每次都重送整章。
  const cards = relevantCards(context.cards, query, 12)
    .map((card) => `- ${card.title}：${card.content}${card.role ? `（作用：${card.role}）` : ''}`)
    .join('\n')
  const rawLimit = context.condensed ? 4_000 : 9_000
  const excerpt = retrievePassages(context.chapterText, query, rawLimit)
  return [
    `书名《${context.bookTitle}》，当前章节「${context.chapterTitle}」。`,
    context.condensed ? `读薄稿：\n${context.condensed.slice(0, 5_000)}` : '',
    cards ? `核心卡片：\n${cards}` : '',
    excerpt ? `章节原文（与问题相关的节选）：\n${excerpt}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** 多轮只保留最近 4 轮原文，更早的压成一句摘要，避免上下文随对话线性增长。 */
function conversationDigest(history: ChatTurn[]): string[] {
  if (history.length === 0) return []
  const recent = history.slice(-4)
  const older = history.slice(0, -4)
  const lines: string[] = []
  if (older.length > 0) {
    lines.push(
      `更早对话摘要：${older
        .map((turn) => `${turn.role === 'user' ? '读者' : '助手'}：${turn.content.replace(/\s+/g, ' ').slice(0, 90)}`)
        .join(' | ')}`,
    )
  }
  for (const turn of recent) {
    lines.push(`${turn.role === 'user' ? '读者' : '助手'}：${turn.content.slice(0, 900)}`)
  }
  return lines
}

function relevantCards(
  cards: TutorContext['cards'],
  query: string,
  limit: number,
): TutorContext['cards'] {
  const terms = queryTerms(query)
  return cards
    .map((card) => ({
      card,
      score: scoreText(`${card.title} ${card.content} ${card.role ?? ''}`, terms),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.card)
}

function normalizeCitations(raw: unknown, chapterText: string): ChatCitation[] {
  if (!Array.isArray(raw)) return []
  const chapter = normalizeForMatch(chapterText)
  const seen = new Set<string>()
  const citations: ChatCitation[] = []
  for (const item of raw) {
    const quote = typeof item === 'string' ? item.trim() : ''
    if (!quote || quote.length < 3 || seen.has(quote)) continue
    seen.add(quote)
    citations.push({ quote, verified: chapter.includes(normalizeForMatch(quote)) })
    if (citations.length >= 3) break
  }
  return citations
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8)
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
}

function demoAnswer(context: TutorContext, question: string, mode: ChatMode): ChatAnswer {
  const sentence =
    context.chapterText
      .split(/(?<=[。！？!?])/)
      .map((item) => item.trim())
      .find((item) => item.length >= 8) ?? context.chapterTitle
  if (mode === 'socratic') {
    return {
      answer: `演示模式：如果作者坐在这里，他可能会先反问你——关于「${question.slice(0, 18)}」，这一章最想让你记住的断言是什么？先试着用自己的话回答，我再顺着你的答案追问。`,
      citations: [{ quote: sentence, verified: true }],
    }
  }
  const summary = context.condensed
    ? context.condensed.replace(/^#+\s*/gm, '').replace(/[-*]\s*/g, '').replace(/\s+/g, ' ').slice(0, 180)
    : sentence
  return {
    answer: `演示模式：${summary}${summary.length >= 180 ? '…' : ''}`,
    citations: [{ quote: sentence, verified: true }],
  }
}

function demoFeynman(context: TutorContext, explanation: string): FeynmanResult {
  const covered = context.cards.slice(0, 2).map((card) => card.title)
  return {
    feedback:
      explanation.length > 60
        ? '演示模式：你讲出了章节的主线。正式模型会逐条对照读薄稿，指出漏掉的前提和偏差。'
        : '演示模式：解释还比较短。试着补上「作者为什么这样认为」和「这个结论在什么条件下失效」。',
    covered,
    missing: context.cards.slice(2, 4).map((card) => card.title),
    misconceptions: [],
  }
}
