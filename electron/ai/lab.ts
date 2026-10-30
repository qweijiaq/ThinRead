import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import { generateText } from 'ai'

import type {
  ChatTurn,
  LabAnswerCheck,
  LabChatAnswer,
  LabDuplicatePair,
  LabExperiment,
  LabMergeGroup,
  LabQuiz,
  LabQuizQuestion,
  LabReport,
  LabRequest,
  Note,
} from '../../shared/types.js'
import {
  createExperiment,
  getBookRecord,
  getBookSummary,
  getChapter,
  getChapters,
  listBooks,
  listLibraryNotes,
  listLibraryTags,
  listMapNotes,
  listNotes,
} from '../db.js'
import { buildKnowledgeMap } from '../knowledge-map.js'
import type { ModelConfig } from './provider.js'
import { createLanguageModel } from './provider.js'

const execFileAsync = promisify(execFile)

interface LabContext {
  label: string
  text: string
  bookTitle: string
  chapterTitle: string
}

const REPORT_SYSTEM = [
  '你是「页边」的 AI 阅读研究员。',
  '只使用下面提供的书、章节和笔记作为事实来源；需要引用时写清《书名》和章节。',
  '不要编造原文。找不到依据时直接说明「本地库中没有找到依据」。',
  '输出可直接阅读的 Markdown，不要输出 JSON 代码块，除非任务明确要求 JSON。',
].join('\n')

const REPORT_INSTRUCTIONS: Partial<Record<LabRequest['tool'], string>> = {
  'cross-book-synthesis':
    '请围绕用户的问题，综合所选书的读薄稿和卡片，写一份带引用的跨书综述：先给结论，再写共同点、分歧、各自盲点，最后给一个综合判断。',
  'argument-map':
    '请把这一章拆成一棵论证树：主张 → 前提 → 证据 → 反例/边界。用 Markdown 缩进列表表达层级，每个节点尽量附一句原文依据；最后列出 2–3 个值得追问的问题。',
  'weekly-review':
    '请根据最近一周的笔记和概念，写一份安静的每周复盘：本周反复出现的主题、理解上的变化、3 个未解决的问题、下周最值得回看的内容。不要做排行榜。',
  'reading-path':
    '请根据用户的目标和书库内容，设计一条可执行的阅读路径：按顺序列出章节/主题、每站为什么读、读完后用什么问题检查自己，最后给一个阶段小结任务。',
  'view-timeline':
    '请围绕用户指定的概念，按时间整理笔记里的观点变化：早期理解、转折、现在的理解，并指出哪些书/章节推动了变化。用时间线式 Markdown。',
  'knowledge-gaps':
    '请分析当前概念图：指出孤立概念、缺少桥接的主题、相互矛盾的观点，以及最值得补充的阅读方向。区分「书库内已有但没连起来」和「书库外可能需要补充」。',
  podcast:
    '请写一段 5 分钟的双人播客脚本：主持人 A 负责提问，主持人 B 负责用书中观点回答；有开场、3 个重点、一个反例/边界、结尾。保留原文引用。',
  'chapter-annotations':
    '请为这一章写 6–10 条页边注。每条包含：原文短引、这条注在解释什么、与前后文/其他书的联系。按段落顺序排列，避免每句都注。',
  'entity-network':
    '请提取这一章/这本书里出现的人物、著作、理论和关键关系，输出一张 Markdown 表：实体、类型、关系、出处；最后指出最值得继续追踪的 2–3 条线索。',
  'fact-check':
    '请核查这一章里的事实性主张和数据：列出主张、书中依据、本地库中的支持或反例、状态（有依据/库内冲突/需要外部核查）。不要假装查过互联网。',
  'annual-report':
    '请根据书库和笔记写一份年度阅读报告：读过的书、反复出现的概念、观点变化、最值得重读的章节、明年的阅读建议。用温和、具体的语气。',
}

const CHAT_SYSTEMS: Partial<Record<LabRequest['tool'], string>> = {
  'author-roundtable': [
    '你正在进行一场作者圆桌。',
    '如果有两本书，就分别以两位作者的口吻发言，用「《书名》作者」标注；只有一本书时就以作者口吻回答。',
    '只能根据书中的读薄稿、卡片和原文推断作者立场；书中没有表态的地方明确说「书中未直接表态」。',
    '回答要有观点、有原文依据，不要写成通用百科。',
  ].join('\n'),
  'library-research': [
    '你是用户私人书库的研究助手。',
    '只根据提供的书、读薄稿、卡片和笔记回答，尽量给出书名和章节引用。',
    '如果本地库没有依据，明确说没有找到，不要用外部常识补成书里的观点。',
  ].join('\n'),
  'devils-advocate': [
    '你是用户的魔鬼代言人。',
    '你的任务不是附和，而是用书里的证据、其他书的观点和清晰的推理挑战当前章节的主张。',
    '先复述你要挑战的主张，再给出最强反方论证，最后提出一个让用户必须回答的问题。',
    '不要为了反驳而编造书中没有的内容；区分「书内反例」和「一般推理」。',
  ].join('\n'),
  'book-club': [
    '你正在主持一场三人读书会。',
    '每次回答都让三个角色依次发言：初学者（提出朴素疑问）、怀疑者（挑逻辑漏洞）、实践者（追问怎么用）。',
    '每个人都要引用或指向本章的具体内容，最后给用户留一个问题。',
  ].join('\n'),
  'voice-chat': [
    '你是用户私人书库的语音研究助手。',
    '回答要短、口语化、适合朗读；只根据提供的书和笔记回答，给出书名/章节依据。',
  ].join('\n'),
}

export async function runLab(args: {
  config: ModelConfig
  demo: boolean
  request: LabRequest
}): Promise<LabReport> {
  const request = args.request
  const instruction = REPORT_INSTRUCTIONS[request.tool]
  if (!instruction) throw new Error('这个工作台任务暂不支持。')
  const context = buildContext(request)
  if (args.demo) return { title: reportTitle(request.tool), markdown: demoReport(request, context) }
  const model = createLanguageModel(args.config)
  const prompt = [
    context.text,
    request.question?.trim() ? `用户的问题/目标：${request.question.trim()}` : '',
    instruction,
  ]
    .filter(Boolean)
    .join('\n\n')
  const response = await generateText({
    model,
    system: REPORT_SYSTEM,
    prompt,
    temperature: 0.35,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(120_000),
  })
  const markdown = response.text.trim()
  if (!markdown) throw new Error('模型没有返回内容，请重试。')
  return { title: reportTitle(request.tool), markdown }
}

export async function labChat(args: {
  config: ModelConfig
  demo: boolean
  request: LabRequest
  history: ChatTurn[]
}): Promise<LabChatAnswer> {
  const request = args.request
  const system = CHAT_SYSTEMS[request.tool]
  if (!system) throw new Error('这个对话任务暂不支持。')
  const question = request.question?.trim()
  if (!question) throw new Error('先写一个问题。')
  const context = buildContext(request)
  if (args.demo) {
    return {
      answer: `演示模式：${context.label}。\n\n如果正式模型在这里，它会引用原文回答「${question.slice(0, 40)}」，并区分书中立场和书中未表态的部分。`,
    }
  }
  const history = args.history
    .slice(-8)
    .map((turn) => `${turn.role === 'user' ? '读者' : '助手'}：${turn.content}`)
  const model = createLanguageModel(args.config)
  const response = await generateText({
    model,
    system,
    prompt: [context.text, history.length ? `对话记录：\n${history.join('\n')}` : '', `读者：${question}`]
      .filter(Boolean)
      .join('\n\n'),
    temperature: 0.65,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(120_000),
  })
  const answer = response.text.trim()
  if (!answer) throw new Error('模型没有返回内容，请重试。')
  return { answer }
}

export async function marginNote(args: {
  config: ModelConfig
  demo: boolean
  chapterId: string
  quote: string
}): Promise<LabReport> {
  const quote = args.quote.trim()
  if (!quote) throw new Error('先选中一段原文。')
  const context = buildChapterContext(args.chapterId)
  if (args.demo) {
    return {
      title: 'AI 边注',
      markdown: `**这句在说什么**：这句话是本章的一个关键断言。\n\n**和前后文的联系**：它支撑了本章对自动反应和选择空间的讨论。\n\n> ${quote}`,
    }
  }
  const model = createLanguageModel(args.config)
  const response = await generateText({
    model,
    system: '你是「页边」的阅读批注助手。写一条克制的边注，不要复述整章。',
    prompt: [
      context.text,
      `选中的原文：“${quote}”`,
      '请写 80–150 字：解释这句话在论证里的作用；如果和其他笔记/书有联系，点一句；如果这句话有边界或反例，也点一句。用 Markdown，不要写空话。',
    ].join('\n\n'),
    temperature: 0.4,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(60_000),
  })
  return { title: 'AI 边注', markdown: response.text.trim() }
}

function anchorChapterName(text: string, chapterName: string): string {
  if (!text || !chapterName) return text
  return text.replace(/本章节?|这一章|该章/g, `「${chapterName}」`)
}

export async function generateQuiz(args: {
  config: ModelConfig
  demo: boolean
  chapterId: string
}): Promise<LabQuiz> {
  const context = buildChapterContext(args.chapterId)
  const chapterName = context.chapterTitle
  if (args.demo) {
    return {
      questions: [
        {
          question: `「${chapterName}」最主要的主张是什么？`,
          kind: '主旨',
          answer: '用一句话概括这一章的核心断言。',
          source: `「${chapterName}」读薄稿`,
        },
        {
          question: `作者在「${chapterName}」里为什么会得出这个结论？`,
          kind: '为什么',
          answer: '梳理作者的论证链和关键前提。',
          source: `「${chapterName}」卡片`,
        },
      ],
    }
  }
  const model = createLanguageModel(args.config)
  const response = await generateText({
    model,
    system: [
      `你是阅读教练，正在为《${context.bookTitle}》的章节「${chapterName}」出题。`,
      '题目必须让读者知道在问哪一章：直接写章节名，或写出具体的概念和原文细节；不要用“本章”“这一章”“该章”这类无法定位的说法。',
    ].join('\n'),
    prompt: [
      context.text,
      '请生成 5 道真正需要理解才能回答的问题，类型尽量覆盖：主旨、为什么、比较、应用、反例/边界。',
      '每道题都要能独立读懂，避免只写“本章的观点是什么”。',
      '只输出 JSON：{"questions":[{"question":"...","kind":"主旨|为什么|比较|应用|反例","answer":"参考答案","source":"原文或读薄稿中的依据"}]}。不要输出 Markdown 代码块。',
    ].join('\n\n'),
    temperature: 0.4,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(90_000),
  })
  const parsed = parseJsonObject(response.text)
  const raw = Array.isArray(parsed?.questions) ? parsed.questions : []
  const questions: LabQuizQuestion[] = raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map((item) => ({
      question: anchorChapterName(typeof item.question === 'string' ? item.question.trim() : '', chapterName),
      kind: typeof item.kind === 'string' ? item.kind.trim() : '理解',
      answer: anchorChapterName(typeof item.answer === 'string' ? item.answer.trim() : '', chapterName),
      source: anchorChapterName(typeof item.source === 'string' ? item.source.trim() : '', chapterName),
    }))
    .filter((item) => item.question && item.answer)
    .slice(0, 8)
  if (questions.length === 0) throw new Error('这组题目没有生成成功，请重试。')
  return { questions }
}

export async function checkQuizAnswer(args: {
  config: ModelConfig
  demo: boolean
  chapterId: string
  question: string
  answer: string
}): Promise<LabAnswerCheck> {
  if (args.demo) {
    return {
      verdict: args.answer.trim().length > 20 ? 'partial' : 'off',
      feedback: '演示模式：正式模型会对照本章卡片检查你覆盖了哪些点、哪里理解偏了。',
      missing: ['关键前提', '边界条件'],
    }
  }
  const context = buildChapterContext(args.chapterId)
  const chapterName = context.chapterTitle
  const model = createLanguageModel(args.config)
  const response = await generateText({
    model,
    system: [
      `你是阅读教练，正在检查读者对《${context.bookTitle}》章节「${chapterName}」的回答。`,
      '反馈里直接写章节名或具体概念，不要用“本章”“这一章”这类无法定位的说法。',
    ].join('\n'),
    prompt: [
      context.text,
      `问题：${args.question}`,
      `读者的回答：${args.answer}`,
      '请判断回答质量并给出具体反馈。只输出 JSON：{"verdict":"good|partial|off","feedback":"...","missing":["..."]}。不要输出代码块。',
    ].join('\n\n'),
    temperature: 0.2,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(60_000),
  })
  const parsed = parseJsonObject(response.text)
  const verdict = parsed?.verdict === 'good' || parsed?.verdict === 'partial' || parsed?.verdict === 'off'
    ? parsed.verdict
    : 'partial'
  return {
    verdict,
    feedback: anchorChapterName(typeof parsed?.feedback === 'string' ? parsed.feedback.trim() : '', chapterName),
    missing: Array.isArray(parsed?.missing)
      ? parsed.missing
          .filter((item): item is string => typeof item === 'string')
          .map((item) => anchorChapterName(item, chapterName))
          .slice(0, 6)
      : [],
  }
}

export async function suggestConceptMerges(args: {
  config: ModelConfig
  demo: boolean
}): Promise<LabMergeGroup[]> {
  const tags = listLibraryTags()
  if (tags.length < 2) return []
  if (args.demo) {
    const groups = new Map<string, string[]>()
    for (const item of tags) {
      const key = item.tag.slice(0, 2)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(item.tag)
    }
    return [...groups.values()]
      .filter((items) => items.length > 1)
      .slice(0, 3)
      .map((items) => ({ canonical: items[0]!, tags: items, reason: '演示模式：名称相近', noteCount: items.length }))
  }
  const model = createLanguageModel(args.config)
  const response = await generateText({
    model,
    system: '你是知识库整理助手，只处理标签同义词，不改动标签之外的任何内容。',
    prompt: [
      `标签及笔记数：${JSON.stringify(tags.slice(0, 120))}`,
      '找出真正需要合并的同义或近义标签组（每组至少 2 个，最多 6 个）。不要把上下位概念硬合并。',
      '只输出 JSON：{"groups":[{"canonical":"建议标准名","tags":["a","b"],"reason":"为什么合并","noteCount":数字}]}。不要输出代码块。',
    ].join('\n\n'),
    temperature: 0.2,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(60_000),
  })
  const parsed = parseJsonObject(response.text)
  const groups = Array.isArray(parsed?.groups) ? parsed.groups : []
  const counts = new Map(tags.map((item) => [item.tag, item.count]))
  return groups
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map((item) => {
      const groupTags = Array.isArray(item.tags)
        ? item.tags.filter((tag): tag is string => typeof tag === 'string' && counts.has(tag)).slice(0, 8)
        : []
      return {
        canonical: typeof item.canonical === 'string' ? item.canonical.trim() : '',
        tags: groupTags,
        reason: typeof item.reason === 'string' ? item.reason.trim() : '',
        noteCount: groupTags.reduce((sum, tag) => sum + (counts.get(tag) ?? 0), 0),
      }
    })
    .filter((item) => item.canonical && item.tags.length >= 2)
    .slice(0, 8)
}

const DUPLICATE_CARD_KINDS = new Set(['point', 'claim'])
const MIN_DUPLICATE_SEMANTIC = 0.9
const MIN_DUPLICATE_LEXICAL = 0.45
const STRONG_DUPLICATE_LEXICAL = 0.82

function normalizeComparable(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function bigramCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (let index = 0; index < text.length - 1; index++) {
    const gram = text.slice(index, index + 2)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  return counts
}

interface PreparedCard {
  note: ReturnType<typeof listMapNotes>['notes'][number]
  text: string
  grams: Map<string, number>
}

function prepareCard(note: PreparedCard['note']): PreparedCard {
  const text = normalizeComparable(note.content || note.title)
  return { note, text, grams: bigramCounts(text) }
}

/** 语义只负责召回；真正是否重复要正文有足够重合，避免同主题卡片被误删。 */
function lexicalOverlap(left: PreparedCard, right: PreparedCard): number {
  if (!left.text || !right.text) return 0
  if (left.text === right.text) return 1
  const shorter = left.text.length <= right.text.length ? left.text : right.text
  const longer = left.text.length <= right.text.length ? right.text : left.text
  const containment = shorter.length >= 12 && longer.includes(shorter) ? 0.9 : 0
  const leftGrams = left.text.length <= right.text.length ? left.grams : right.grams
  const rightGrams = left.text.length <= right.text.length ? right.grams : left.grams
  let overlap = 0
  for (const [gram, count] of leftGrams) {
    const other = rightGrams.get(gram)
    if (other) overlap += Math.min(count, other)
  }
  const total = Math.max(0, left.text.length - 1) + Math.max(0, right.text.length - 1)
  const dice = total > 0 ? (2 * overlap) / total : 0
  return Math.max(containment, dice)
}

export function findDuplicateNotes(): LabDuplicatePair[] {
  const { notes } = listMapNotes(500)
  const candidates = notes
    .filter((note) => DUPLICATE_CARD_KINDS.has(note.kind) && note.chapterId)
    .map(prepareCard)
  const pairs: Array<{ keep: PreparedCard; merge: PreparedCard; score: number }> = []
  for (let index = 0; index < candidates.length; index++) {
    const left = candidates[index]!
    for (let other = index + 1; other < candidates.length; other++) {
      const right = candidates[other]!
      if (left.note.bookId !== right.note.bookId) continue
      // 卡片的意义绑定在章节语境里；跨章相似只算相关，不进入去重队列。
      if (left.note.chapterId !== right.note.chapterId) continue
      const lexical = lexicalOverlap(left, right)
      const semantic =
        left.note.vector && right.note.vector && left.note.vector.length === right.note.vector.length
          ? cosine(left.note.vector, right.note.vector)
          : 0
      if (lexical < STRONG_DUPLICATE_LEXICAL && (semantic < MIN_DUPLICATE_SEMANTIC || lexical < MIN_DUPLICATE_LEXICAL)) {
        continue
      }
      const score = Math.round((semantic > 0 ? (semantic + lexical) / 2 : lexical) * 100) / 100
      pairs.push({ keep: left, merge: right, score })
    }
  }
  return pairs
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ keep, merge, score }) => ({
      keepId: keep.note.id,
      keepTitle: keep.note.title,
      keepBookTitle: keep.note.bookTitle,
      keepChapterId: keep.note.chapterId,
      keepChapterTitle: keep.note.chapterTitle,
      keepPreview: keep.note.preview,
      mergeId: merge.note.id,
      mergeTitle: merge.note.title,
      mergeBookTitle: merge.note.bookTitle,
      mergeChapterId: merge.note.chapterId,
      mergeChapterTitle: merge.note.chapterTitle,
      mergePreview: merge.note.preview,
      score,
    }))
}

export async function generateExperiment(args: {
  config: ModelConfig
  demo: boolean
  goal: string
}): Promise<LabExperiment> {
  const goal = args.goal.trim()
  if (!goal) throw new Error('先写一个想实践的目标。')
  let title = '阅读行动实验'
  let steps = `1. 把「${goal}」变成一个本周可执行的动作。\n2. 连续观察 3 天并记录。\n3. 周末回看结果。`
  let duration = '7 天'
  if (!args.demo) {
    const model = createLanguageModel(args.config)
    const response = await generateText({
      model,
      system: '你是阅读实践教练，把书里的方法变成小而具体的行为实验。',
      prompt: [
        `目标：${goal}`,
        '请设计一个 3–7 天内能完成的行动实验，必须具体、低门槛、可以观察结果。',
        '只输出 JSON：{"title":"实验名","steps":"1. ...\\n2. ...","duration":"3 天|7 天"}。不要输出代码块。',
      ].join('\n\n'),
      temperature: 0.5,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(60_000),
    })
    const parsed = parseJsonObject(response.text)
    title = typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title.trim() : title
    steps = typeof parsed?.steps === 'string' && parsed.steps.trim() ? parsed.steps.trim() : steps
    duration = typeof parsed?.duration === 'string' && parsed.duration.trim() ? parsed.duration.trim() : duration
  }
  return createExperiment({ title, goal, steps, duration })
}

function buildContext(request: LabRequest): LabContext {
  if (request.chapterId) return buildChapterContext(request.chapterId)
  if (request.bookIds && request.bookIds.length > 0) {
    const books = request.bookIds.map((id) => getBookSummary(id)).filter((book) => Boolean(book))
    const text = books.map((book) => bookDigest(book!.id)).join('\n\n---\n\n').slice(0, 24_000)
    return { label: books.map((book) => `《${book!.title}》`).join('、'), text, bookTitle: '', chapterTitle: '' }
  }
  if (request.tool === 'knowledge-gaps') {
    const map = buildKnowledgeMap()
    const concepts = map.nodes.filter((node) => node.type === 'concept')
    const books = map.nodes.filter((node) => node.type === 'book')
    const edges = map.edges.filter((edge) => edge.kind === 'tag')
    return {
      label: '全库概念图',
      bookTitle: '',
      chapterTitle: '',
      text: [
        `概念：${concepts.map((node) => `${node.label}(${node.noteCount})`).join('、')}`,
        `书：${books.map((node) => node.label).join('、')}`,
        `关系：${edges.map((edge) => `${edge.source}↔${edge.target}`).join('、')}`,
      ].join('\n'),
    }
  }
  if (request.tool === 'weekly-review') {
    const notes = listLibraryNotes({ limit: 120 })
    const recent = notes.filter((note) => Date.now() - new Date(note.updatedAt).getTime() <= 7 * 24 * 60 * 60 * 1000).slice(0, 40)
    const chosen = recent.length > 0 ? recent : notes.slice(0, 40)
    const activeBooks = new Set(chosen.map((note) => note.bookTitle))
    return {
      label: '最近一周',
      bookTitle: '',
      chapterTitle: '',
      text: `最近一周：${chosen.length} 条笔记，来自 ${activeBooks.size} 本书。\n\n${notesDigest(chosen)}`,
    }
  }
  if (request.tool === 'annual-report') {
    const notes = listLibraryNotes({ limit: 300 })
    const books = listBooks()
    const tags = [...new Set(notes.flatMap((note) => note.tags))].slice(0, 40)
    return {
      label: '年度阅读',
      bookTitle: '',
      chapterTitle: '',
      text: `书：${books.map((book) => `《${book.title}》`).join('、')}\n笔记：${notes.length} 条；反复出现的概念：${tags.join('、') || '暂无'}。\n\n${notesDigest(notes)}`,
    }
  }
  let notes = request.question?.trim()
    ? listLibraryNotes({ query: request.question.trim(), limit: 50 })
    : listLibraryNotes({ limit: 120 })
  if (notes.length === 0) notes = listLibraryNotes({ limit: 120 })
  return {
    label: '全库笔记',
    bookTitle: '',
    chapterTitle: '',
    text: `${listBooks().map((book) => `《${book.title}》`).join('、')}\n\n${notesDigest(notes)}`,
  }
}

function buildChapterContext(chapterId: string): LabContext {
  const chapter = getChapter(chapterId)
  const book = getBookSummary(chapter.bookId)
  const notes = listNotes(chapter.bookId, chapterId)
  const condensed = notes.find((note) => note.kind === 'condensed')?.content ?? ''
  const cards = notes
    .filter((note) => note.kind === 'point' || note.kind === 'claim')
    .map((note) => `- [${note.kind}] ${note.title}：${note.content}${note.role ? `（作用：${note.role}）` : ''}`)
    .join('\n')
  return {
    label: `《${book?.title ?? ''}》· ${chapter.title}`,
    bookTitle: book?.title ?? '',
    chapterTitle: chapter.title,
    text: [
      `书名《${book?.title ?? ''}》，章节「${chapter.title}」。`,
      chapter.text.slice(0, 12_000),
      condensed ? `读薄稿：\n${condensed.slice(0, 5_000)}` : '',
      cards ? `核心卡片：\n${cards.slice(0, 6_000)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 24_000),
  }
}

function bookDigest(bookId: string): string {
  const book = getBookSummary(bookId)
  const chapters = getChapters(bookId)
  const notes = listNotes(bookId)
  return [
    `书名《${book?.title ?? ''}》，作者 ${book?.author ?? '未知'}。`,
    `章节：${chapters.map((chapter) => chapter.title).join('；')}`,
    notesDigest(notes).slice(0, 16_000),
  ].join('\n\n')
}

function notesDigest(notes: Note[]): string {
  return notes
    .slice(0, 100)
    .map((note) => {
      const content = note.kind === 'condensed' ? note.content.slice(0, 2_000) : note.content.slice(0, 700)
      return `[${note.kind}] ${note.title}（${note.tags.join('/') || '无标签'}）\n${content}`
    })
    .join('\n\n')
    .slice(0, 24_000)
}

function reportTitle(tool: LabRequest['tool']): string {
  const titles: Partial<Record<LabRequest['tool'], string>> = {
    'cross-book-synthesis': '跨书综述',
    'argument-map': '论证地图',
    'weekly-review': '本周阅读复盘',
    'reading-path': '阅读路径',
    'view-timeline': '观点演变',
    'knowledge-gaps': '知识缺口',
    podcast: '双人播客脚本',
    'chapter-annotations': '章节边注',
    'entity-network': '人物与引用',
    'fact-check': '事实核查',
    'annual-report': '年度阅读报告',
  }
  return titles[tool] ?? 'AI 工作台'
}

function demoReport(request: LabRequest, context: LabContext): string {
  const q = request.question?.trim() || '这次阅读'
  return [
    `## ${reportTitle(request.tool)}`,
    `演示模式生成，基于 ${context.label}。`,
    '',
    `### 核心结论`,
    `围绕「${q}」，正式模型会综合读薄稿、卡片和原文，给出带引用的判断。`,
    '',
    '### 可以继续追问',
    '- 哪些观点互相支持？',
    '- 哪些地方存在冲突或边界？',
    '- 下一步最值得读什么？',
  ].join('\n')
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let index = 0; index < a.length; index++) {
    dot += a[index]! * b[index]!
    na += a[index]! * a[index]!
    nb += b[index]! * b[index]!
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb)
}


export async function analyzePdfPage(args: {
  config: ModelConfig
  demo: boolean
  bookId: string
  page: number
}): Promise<LabReport> {
  const book = getBookRecord(args.bookId)
  if (!book) throw new Error('这本书不存在。')
  if (book.format !== 'pdf') throw new Error('只有 PDF 支持按页理解。')
  if (process.platform !== 'darwin') throw new Error('当前系统暂不支持页面 OCR。')
  const page = Math.floor(args.page)
  if (!Number.isFinite(page) || page < 1) throw new Error('页码无效。')
  const script = findPdfPageScript()
  let stdout = ''
  try {
    const result = await execFileAsync('swift', [script, book.filePath, String(page)], {
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    })
    stdout = result.stdout
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`这一页没有读出文字（${detail.slice(0, 120)}）。`)
  }
  const ocr = stdout.trim().slice(0, 20_000)
  if (!ocr) throw new Error('这一页没有识别出文字，可能是空白页或纯图片。')
  if (args.demo) {
    return {
      title: `页面理解 · 第 ${page} 页`,
      markdown: `## 本机 OCR\n\n${ocr}\n\n> 演示模式：正式模型会进一步解释图表、纠正 OCR 错误，并联系你的笔记。`,
    }
  }
  const model = createLanguageModel(args.config)
  const response = await generateText({
    model,
    system: '你是「页边」的页面阅读助手，负责解释扫描页和图表。',
    prompt: [
      `书名《${book.title}》，第 ${page} 页的本机 OCR 文字：\n${ocr}`,
      '请用 Markdown 解释这一页在说什么：先纠正明显的 OCR 错误，再概括内容；如果像图表，指出坐标轴、关键数据、趋势和它支持的结论；最后说一句和这本书主题/读者笔记的联系。',
      '只使用页面文字和可推断的版式信息，不要编造看不见的细节。',
    ].join('\n\n'),
    temperature: 0.3,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(90_000),
  })
  return { title: `页面理解 · 第 ${page} 页`, markdown: response.text.trim() }
}

function findPdfPageScript(): string {
  const candidates = [
    path.join(process.cwd(), 'scripts', 'pdf-page.swift'),
    path.join(__dirname, '..', 'scripts', 'pdf-page.swift'),
    path.join(__dirname, '..', '..', 'scripts', 'pdf-page.swift'),
  ]
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) throw new Error('找不到 PDF 页面识别脚本。')
  return found
}
