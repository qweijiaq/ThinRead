import { generateText } from 'ai'

import type { Note, SessionSummary } from '../../shared/types.js'

import { createLanguageModel, type ModelConfig } from './provider.js'

interface SessionSummaryArgs {
  config: ModelConfig
  demo: boolean
  bookTitle: string
  chapterTitle: string
  chapterText: string
  notes: Note[]
  minutes: number
  signal?: AbortSignal
}

function demoSummary(args: SessionSummaryArgs): SessionSummary {
  return {
    title: `阅读小结 · ${args.chapterTitle}`,
    markdown: [
      '## 本次读到',
      `- 你在《${args.bookTitle}》的「${args.chapterTitle}」读了约 ${args.minutes} 分钟。`,
      '- 演示模式只展示小结格式，不会调用模型。',
      '',
      '## 还存着的疑问',
      '- 这一章最核心的判断是什么？',
      '- 它和我已有的经验有没有冲突？',
      '',
      '## 下一步',
      '- 用自己的话写一条摘要，或配置真实模型后重新生成。',
    ].join('\n'),
  }
}

/** 根据当前章节和本次阅读时长生成一份可保存的阅读小结。 */
export async function generateSessionSummary(args: SessionSummaryArgs): Promise<SessionSummary> {
  if (args.demo) return demoSummary(args)
  if (!args.config.apiKey && args.config.provider !== 'ollama') {
    throw new Error('还没有配置 API Key，无法生成阅读小结。')
  }
  const text = args.chapterText.slice(0, 14_000)
  if (!text.trim()) throw new Error('这一章没有可总结的正文。')
  const notes = args.notes
    .slice(0, 24)
    .map((note) => `- ${note.title}：${note.content.slice(0, 180)}`)
    .join('\n')

  const { text: answer } = await generateText({
    model: createLanguageModel(args.config),
    system:
      '你是中文读书笔记助手。只根据用户提供的章节和已有笔记写阅读小结，不编造原文引用，不写空泛口号。输出 Markdown，不要输出 JSON 或代码块。',
    prompt: [
      '请写一份简短的本次阅读小结，严格使用以下结构：',
      '## 本次读到',
      '2–4 条，具体的观点或信息，不要复述目录。',
      '## 还存着的疑问',
      '1–3 条，指出还没想通、值得继续查的地方。',
      '## 下一步',
      '1–3 条，可以马上做的动作，例如回看某段、写一条自己的判断、找另一本书对照。',
      '',
      `书名：${args.bookTitle}`,
      `章节：${args.chapterTitle}`,
      `本次阅读约：${args.minutes} 分钟`,
      '',
      `已有笔记：\n${notes || '（暂无）'}`,
      '',
      `章节正文：\n${text}`,
    ].join('\n'),
    temperature: 0.3,
    maxOutputTokens: 900,
    abortSignal: args.signal,
  })
  const markdown = answer.trim()
  if (!markdown) throw new Error('模型没有返回阅读小结。')
  return { title: `阅读小结 · ${args.chapterTitle}`, markdown }
}
