import { generateText } from 'ai'

import type { ComposeSectionRewriteResult } from '../../shared/types.js'

import { createLanguageModel, type ModelConfig } from './provider.js'

interface RewriteSectionArgs {
  config: ModelConfig
  demo: boolean
  bookTitle: string
  fullText: string
  start: number
  end: number
  signal?: AbortSignal
}

/** 只重写用户选中的一小段，保留上下文、事实和引用，返回可直接替换的片段。 */
export async function rewriteComposeSection(args: RewriteSectionArgs): Promise<ComposeSectionRewriteResult> {
  const selected = args.fullText.slice(args.start, args.end)
  if (!selected.trim()) throw new Error('先选中要重写的文字。')
  if (selected.length > 6_000) throw new Error('选中片段太长，请分段重写。')
  if (args.demo) return { text: selected, demo: true }
  if (!args.config.apiKey && args.config.provider !== 'ollama') {
    throw new Error('还没有配置 API Key，无法重写选中的文字。')
  }
  const before = args.fullText.slice(Math.max(0, args.start - 1_200), args.start)
  const after = args.fullText.slice(args.end, args.end + 1_200)
  const { text } = await generateText({
    model: createLanguageModel(args.config),
    system:
      '你是中文书稿编辑。只重写用户选中的片段，保持上下文衔接、事实、论点和引用不变。输出纯 Markdown 片段，不要解释，不要加代码块，不要重复前后文。',
    prompt: [
      `书名：${args.bookTitle}`,
      '请重写下面选中的片段，使表达更清楚、节奏更好；不要改变原意，不要编造新事实。',
      '只输出重写后的片段。',
      '',
      '【前文】',
      before || '（无）',
      '【选中片段】',
      selected,
      '【后文】',
      after || '（无）',
    ].join('\n'),
    temperature: 0.4,
    maxOutputTokens: 1_200,
    abortSignal: args.signal,
  })
  const rewritten = text.trim()
  if (!rewritten) throw new Error('模型没有返回重写片段。')
  return { text: rewritten }
}
