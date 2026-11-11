import { createHash } from 'node:crypto'

import * as cheerio from 'cheerio'

import type { ModelConfig } from './provider.js'
import { createLanguageModel, nonThinkingProviderOptions } from './provider.js'
import { tracedGenerateText } from './trace.js'

export type CodeAssistMode = 'review' | 'explain' | 'fix'

export interface CodeAssistResult {
  text: string
  html?: string
  understood?: number
  skipped?: number
  changed?: boolean
}

function normalizeCode(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim()
}

function compactCode(value: string): string {
  return normalizeCode(value).replace(/\s+/g, '')
}

function codeKey(code: string): string {
  return createHash('sha256').update(normalizeCode(code)).digest('hex').slice(0, 16)
}

function cleanModelText(value: string): string {
  return value
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
    .slice(0, 4_000)
}

function commentMarker(language: string, code: string): string {
  const hint = language.toLowerCase()
  if (/python|\bpy\b/.test(hint) || /^\s*(def|class|import|from)\b/m.test(code)) return '#'
  if (/sql/.test(hint)) return '--'
  if (/html|xml/.test(hint)) return '<!-- ... -->'
  if (/shell|bash|zsh|sh\b/.test(hint)) return '#'
  return '//'
}

function parseFixedCode(value: string): string {
  const cleaned = value.replace(/^```(?:[a-z0-9+#.-]+)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { code?: unknown }
      if (typeof parsed.code === 'string' && parsed.code.trim()) return parsed.code.replace(/\r\n?/g, '\n')
    } catch {
      // 退回纯文本。
    }
  }
  return cleaned.replace(/\r\n?/g, '\n')
}

async function askCode(args: {
  config: ModelConfig
  demo: boolean
  mode: CodeAssistMode
  code: string
  language: string
  chapterTitle: string
  bookTitle: string
  signal?: AbortSignal
}): Promise<string> {
  if (args.demo) throw new Error('演示模式不支持代码检查，请先配置真实模型。')
  if (!args.code.trim()) throw new Error('这段代码是空的。')
  if (args.code.length > 24_000) throw new Error('这段代码太长，暂时只支持 2.4 万字符以内的代码块。')
  const model = createLanguageModel(args.config)
  const providerOptions = nonThinkingProviderOptions(args.config)
  const common = [
    `书名《${args.bookTitle}》，章节「${args.chapterTitle}」。`,
    args.language ? `代码语言：${args.language}` : '',
    '代码：',
    args.code,
  ]
    .filter(Boolean)
    .join('\n\n')

  if (args.mode === 'fix') {
    const marker = commentMarker(args.language, args.code)
    const response = await tracedGenerateText(
      {
        step: 'code-fix',
        scope: args.chapterTitle,
        provider: args.config.provider,
        model: args.config.model,
        promptVersion: 'code-fix-v1',
        timeoutMs: 120_000,
      },
      {
        model,
        system:
          '你是谨慎的代码修复助手。只修能确定的错误，不重构，不改变代码意图，不添加无关功能。',
        prompt: [
          common,
          '请修复这段代码里的语法错误、拼写错误、错误符号、括号/引号不匹配、明显缺字符或多字符、缩进混乱。',
          '如果代码块里混入了正文、旁注或说明文字，不要删除它们，用该语言的行注释符把它们注释掉；本段优先使用 ' + marker + '。',
          '保持原有代码结构和语言，不要改写成另一种写法，不要输出解释。',
          '只返回一个 JSON 对象，字段为 code，值是修复后的完整代码字符串。不要输出 Markdown 代码块。',
        ].join('\n\n'),
        temperature: 0.05,
        maxOutputTokens: Math.min(6_000, Math.max(1_200, Math.ceil(args.code.length * 1.6))),
        ...(providerOptions ? { providerOptions } : {}),
        maxRetries: 1,
        abortSignal: args.signal,
      },
    )
    const fixed = parseFixedCode(response.text)
    if (!fixed.trim()) throw new Error('模型没有返回修复后的代码。')
    if (fixed.length < args.code.length * 0.4 || fixed.length > args.code.length * 2.5 + 300) {
      throw new Error('修复结果长度异常，已保留原代码。')
    }
    return fixed
  }

  if (args.mode === 'review') {
    const response = await tracedGenerateText(
      {
        step: 'code-review',
        scope: args.chapterTitle,
        provider: args.config.provider,
        model: args.config.model,
        promptVersion: 'code-review-v1',
        timeoutMs: 120_000,
      },
      {
        model,
        system:
          '你是严谨的代码审阅助手。只根据给出的代码判断，不猜测作者意图，不编造不存在的代码。',
        prompt: [
          common,
          '请检查这段代码是否符合代码规范，以及是否存在错字、错误符号、括号/引号不匹配、明显缺字符或多字符、缩进混乱等问题。',
          '输出简体中文，按严重程度列出能确定的问题；每条写清楚“问题 + 位置/片段 + 建议怎么改”。',
          '如果只发现风格问题，单独标成“风格建议”；如果没有发现明显问题，直接说“未发现明显错误”，不要硬凑问题。',
          '不要重写整段代码，不要输出与检查无关的客套话。',
        ].join('\n\n'),
        temperature: 0.1,
        maxOutputTokens: 1_600,
        ...(providerOptions ? { providerOptions } : {}),
        maxRetries: 1,
        abortSignal: args.signal,
      },
    )
    return cleanModelText(response.text)
  }

  const response = await tracedGenerateText(
    {
      step: 'code-explain',
      scope: args.chapterTitle,
      provider: args.config.provider,
      model: args.config.model,
      promptVersion: 'code-explain-v1',
      timeoutMs: 120_000,
    },
    {
      model,
      system: '你是读书笔记应用的代码理解助手，负责把书里的示例代码解释成可以直接阅读的正文。',
      prompt: [
        common,
        '请用简体中文写 2–6 句，说明这段代码大致做什么、输入和输出是什么、关键步骤或设计意图是什么。',
        '不要逐行翻译，不要复述变量名，不要编造代码里没有的行为；如果是示例片段，可以指出它依赖的上下文。',
        '直接输出正文，不要标题、Markdown 列表或“这段代码”这类套话。',
      ].join('\n\n'),
      temperature: 0.2,
      maxOutputTokens: 900,
      ...(providerOptions ? { providerOptions } : {}),
      maxRetries: 1,
      abortSignal: args.signal,
    },
  )
  return cleanModelText(response.text)
}

type CodeAssistArgs = Omit<Parameters<typeof askCode>[0], 'mode'>

export async function reviewCode(args: CodeAssistArgs): Promise<string> {
  return askCode({ ...args, mode: 'review' })
}

export async function explainCode(args: CodeAssistArgs): Promise<string> {
  return askCode({ ...args, mode: 'explain' })
}

export async function fixCode(args: CodeAssistArgs): Promise<string> {
  return askCode({ ...args, mode: 'fix' })
}

/** 用修复后的代码替换对应 pre，并移除已经过期的代码理解。 */
export function replaceCodeBlock(source: string, code: string, fixedCode: string): CodeAssistResult {
  const $ = cheerio.load(`<div id="__code_fix_root">${source}</div>`)
  const root = $('#__code_fix_root')
  const needle = compactCode(code)
  let target = root.find('pre').filter((_, element) => compactCode($(element).text()) === needle).first()
  if (target.length === 0) target = root.find('pre').filter((_, element) => $(element).text().includes(code.trim())).first()
  if (target.length === 0) throw new Error('找不到这段代码，可能已经被重新排版。')
  const changed = normalizeCode(target.text()) !== normalizeCode(fixedCode)
  if (changed) {
    const codeElement = target.find('code').first()
    if (codeElement.length > 0) codeElement.text(fixedCode)
    else target.text(fixedCode)
    target.removeAttr('data-code-understood')
    target.next('.code-understanding').remove()
  }
  return { text: fixedCode, html: root.html() ?? source, changed }
}

/** 把代码理解插到对应 pre 后面；已经理解过的代码块会跳过。 */
export function insertCodeUnderstanding(
  source: string,
  code: string,
  text: string,
): CodeAssistResult {
  const $ = cheerio.load(`<div id="__code_understanding_root">${source}</div>`)
  const root = $('#__code_understanding_root')
  const needle = compactCode(code)
  let target = root.find('pre').filter((_, element) => compactCode($(element).text()) === needle).first()
  if (target.length === 0) target = root.find('pre').filter((_, element) => $(element).text().includes(code.trim())).first()
  if (target.length === 0) throw new Error('找不到这段代码，可能已经被重新排版。')
  if (target.attr('data-code-understood') === '1') {
    return { text, understood: 0, skipped: 1 }
  }
  const block = $('<aside class="code-understanding"></aside>')
  block.attr('data-code-understanding', codeKey(code))
  block.append($('<div class="code-understanding-label"></div>').text('代码理解'))
  for (const paragraph of text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)) {
    block.append($('<p></p>').text(paragraph))
  }
  target.attr('data-code-understood', '1')
  target.after(block)
  return { text, html: root.html() ?? source, understood: 1, skipped: 0 }
}
