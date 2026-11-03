import { generateText } from 'ai'

import type { ShareCopyResult } from '../../shared/types.js'

import { createLanguageModel, type ModelConfig } from './provider.js'

interface OptimizeArgs {
  config: ModelConfig
  demo: boolean
  title: string
  body: string
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
  if (!args.config.apiKey && args.config.provider !== 'ollama') {
    throw new Error('还没有配置 API Key，无法优化文案。')
  }
  if (!source) throw new Error('没有可以优化的正文。')

  const { text } = await generateText({
    model: createLanguageModel(args.config),
    system:
      '你是中文阅读分享编辑。把用户给出的笔记改写成适合社交平台分享的短文案，保留原意，不编造事实，不使用 Markdown。',
    prompt: [
      '把下面的笔记改写成 1 个标题和 3 条要点。',
      '要求：标题 12–20 字；每条要点 18–45 字，彼此不重复；语气克制、具体，不要口号。',
      '只输出 JSON：{"title":"...","points":["...","...","..."]}',
      '',
      `原标题：${args.title}`,
      `正文：${source}`,
    ].join('\n'),
    temperature: 0.4,
  })

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
