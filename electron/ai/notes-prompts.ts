import type { Chunk, GenerateArgs } from './notes.js'
import { genreRule } from './genre.js'
import { imagePromptBlock } from './note-images.js'

export const NOTES_SYSTEM =
  '你是严谨的阅读助手。严格依据用户给出的内容工作，不编造原文没有的事实；输出语言按用户要求执行，只输出请求的 JSON。'

// ─── 阶段一：压缩重写 ─────────────────────────────────────────────────────

export interface SourceLanguage {
  name: string
  foreign: boolean
}

/** 粗判原文语言：只用来决定默认输出中文还是跟随原文，不做严格语种识别。 */
export function detectSourceLanguage(text: string): SourceLanguage {
  const sample = text.slice(0, 12_000)
  const cjk = (sample.match(/[\u3400-\u9fff]/g) ?? []).length
  const kana = (sample.match(/[\u3040-\u30ff]/g) ?? []).length
  const hangul = (sample.match(/[\uac00-\ud7af]/g) ?? []).length
  const cyrillic = (sample.match(/[\u0400-\u04ff]/g) ?? []).length
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length
  if (kana > 80 && kana > cjk * 0.4) return { name: '日文', foreign: true }
  if (hangul > 80 && hangul > cjk * 0.5) return { name: '韩文', foreign: true }
  if (cyrillic > 80) return { name: '俄文等西里尔文字', foreign: true }
  if (latin > 200 && latin > cjk * 2) return { name: '英文等拉丁字母文字', foreign: true }
  return { name: '中文', foreign: false }
}

export function languageDirective(args: GenerateArgs): string {
  if ((args.notesLanguage ?? 'zh') === 'source') return '输出语言：跟随原文语言。'
  const language = detectSourceLanguage(args.chapterText)
  if (!language.foreign) return '输出语言：简体中文。'
  return [
    `原书主要是${language.name}。读薄稿、知识点、标题、概念和补遗一律使用简体中文；`,
    '专业术语首次出现时可以写成「中文（原文）」。',
    'evidence 字段必须逐字复制原文，不要翻译；原文引用保持原语言。',
  ].join('')
}

export function looksLikeList(text: string): boolean {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 3) return false
  const listy = lines.filter((line) =>
    /^([-*+•]|\d+[.)、]|[一二三四五六七八九十]+[、.])\s+/.test(line),
  ).length
  return listy >= Math.max(2, Math.ceil(lines.length * 0.35))
}

function numberParagraphs(text: string): string {
  const groups: string[] = []
  let current: string[] = []
  let inFence = false
  const flush = (): void => {
    const paragraph = current.join('\n').trim()
    if (paragraph) groups.push(paragraph)
    current = []
  }
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence
    if (!inFence && line.trim() === '') flush()
    else current.push(line)
  }
  flush()
  return groups.map((paragraph, index) => `[§${index + 1}] ${paragraph}`).join('\n\n')
}

export function condensePrompt(args: GenerateArgs, chunk: Chunk): string {
  const numbered = numberParagraphs(chunk.text)
  const hint = genreRule(args.genre)

  return [
    `你在把一本书读薄，目标是写成一篇连贯、可读的读薄文章，而不是缩写或要点清单。书名《${args.bookTitle}》，本章「${args.chapterTitle}」，小节「${chunk.title || '正文'}」。`,
    languageDirective(args),
    ...(hint ? [hint] : []),
    ...(chunk.images.length > 0 ? [imagePromptBlock(chunk.images)] : []),
    '',
    '请完成：',
    '1. 用自然的段落复述这一节的论证：主张是什么，为什么成立，机制或证据如何支撑，适用边界在哪里。',
    '2. 保留论证链和必要的上下文。可以删掉重复、寒暄、冗长铺垫和纯装饰性例子，但不要只留下结论，也不要把所有解释性从句删光。',
    '3. 写成连贯行文：段落之间要有承接；不要使用项目符号、编号列表、表格，也不要以「-」「*」「1.」开头。确需并列时，把并列项写进句子里。',
    '4. 不要逐段翻译或复述原文，用自己的话重组；不要保留原句的骨架。',
    '5. 压缩幅度：通常保留原文的 45%–60%；重复多的可以更短，论证密集的不要为了短而损伤逻辑。',
    '6. 不要写「作者认为」「本章」「接下来」这类元话；不要加入原文没有的观点；不要保留（源：§n）或段落编号。',
    '7. 不写小节标题，直接输出正文段落。',
    '8. 删除的原文片段和原因放进 omitted。',
    '9. 遇到图表或图片时，只写它明确支持了哪个论点、对比或流程；不要编造看不清的细节，也不要罗列图里的所有标签。',
    '10. 遇到代码时，不要逐行复述；用一两句话说明它解决什么问题、关键输入输出或结论。如果代码只是装饰性示例，可以删掉并说明。',
    '',
    '示例：',
    '原文：要理解这个问题，需要先看 X 的历史；X 由内到外至少有三层：A、B、C。',
    '读薄稿：要理解 X，先要看到它并非一个平面概念，而是由外到内分成 A、B、C 三层。外层负责……，中间层……，最内层……。三层之间不是简单叠加，而是……，这也决定了……。',
    '',
    '只输出一个 JSON 对象：{"compressed":"Markdown 读薄稿","omitted":[{"text":"...","reason":"..."}]}。不要输出 Markdown 代码块或额外解释。',
    '',
    '原文：',
    numbered,
  ].join('\n')
}

