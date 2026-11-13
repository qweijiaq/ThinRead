import type { ShareCopyResult } from '../../shared/types.js'

import { createLanguageModel, type ModelConfig } from './provider.js'
import { tracedGenerateText } from './trace.js'

interface OptimizeArgs {
  config: ModelConfig
  demo: boolean
  title: string
  body: string
  kind?: string
}

function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*\n?/g, ''))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function fallback(title: string, body: string): ShareCopyResult {
  const plain = plainText(body).replace(/^第[0-9一二三四五六七八九十百零]+章\s*[^，。！？]{0,12}\s+/, '').trim()
  const sentences = plain
    .split(/(?<=[。！？!?])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12)
  const points = (sentences.length > 0 ? sentences : [plain])
    .map((sentence) => (sentence.length > 80 ? `${sentence.slice(0, 78)}…` : sentence))
    .slice(0, 3)
  const generic = /读薄稿|摘录|知识点/.test(title)
  const derived = points[0]?.split(/[，。：:]/)[0]?.trim().slice(0, 18)
  return {
    title: generic && derived ? derived : title.trim().slice(0, 20) || derived || '',
    points,
    note: '使用本地规则提炼；配置真实模型后可以让 AI 改写。',
  }
}

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

/** 把一条笔记改写成适合分享的标题和 3 条要点。 */
export async function optimizeShareCopy(args: OptimizeArgs): Promise<ShareCopyResult> {
  const source = plainText(args.body).slice(0, 12_000)
  if (args.demo) return fallback(args.title, args.body)
  if (!args.config.apiKey && args.config.provider !== 'ollama' && args.config.provider !== 'lmstudio') {
    throw new Error('还没有配置 API Key，无法优化文案。')
  }
  if (!source) throw new Error('没有可以优化的正文。')

  const xhs = args.kind === 'xhs'
  const { text } = await tracedGenerateText(
    {
      step: 'share-copy',
      provider: args.config.provider,
      model: args.config.model,
      promptVersion: xhs ? 'xhs-cover-copy-v1' : 'share-copy-v2',
    },
    {
      model: createLanguageModel(args.config),
      system: xhs
        ? '你是小红书读书博主，擅长写让人想点开的封面标题。保留原意，不编造事实，不夸张承诺，不使用 Markdown 或 emoji。'
        : '你是中文阅读分享编辑。把用户给出的笔记改写成适合社交平台分享的短文案，保留原意，不编造事实，不使用 Markdown。',
      prompt: xhs
        ? [
            '根据下面的读书笔记，起 1 个适合小红书封面的标题，并给出 3 句可以直接放进图文的金句。',
            '标题要求：14–22 字；具体、有钩子，可以用反差、提问或数字；像人在分享，不要像论文标题；不要用“必看”“震惊”这类标题党。',
            '金句要求：每句 18–40 字，来自笔记本身，彼此不重复。',
            '只输出 JSON：{"title":"...","points":["...","...","..."]}',
            '',
            `原章节：${args.title}`,
            `笔记：${source}`,
          ].join('\n')
        : [
            '把下面的笔记改写成 1 个标题和 3 条要点。',
            '要求：标题 12–20 字；每条要点 18–45 字，彼此不重复；语气克制、具体，不要口号。',
            '只输出 JSON：{"title":"...","points":["...","...","..."]}',
            '',
            `原标题：${args.title}`,
            `正文：${source}`,
          ].join('\n'),
      temperature: xhs ? 0.7 : 0.4,
      maxOutputTokens: 800,
    },
  )

  const parsed = cleanJson(text) as { title?: unknown; points?: unknown } | null
  const points = Array.isArray(parsed?.points)
    ? parsed!.points
        .filter((point): point is string => typeof point === 'string' && point.trim().length > 0)
        .map((point) => point.trim().slice(0, 60))
        .slice(0, 3)
    : []
  if (points.length < 2) {
    return { ...fallback(args.title, args.body), note: '模型输出无法解析，已使用本地提炼。' }
  }
  return {
    title: typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title.trim().slice(0, 24) : args.title,
    points,
  }
}
