import type { LabToolId } from '../../shared/types.js'

export type LabToolKind = 'chat' | 'report' | 'quiz' | 'merge' | 'dedupe' | 'pdf'

export interface LabTool {
  id: LabToolId
  group: string
  title: string
  description: string
  kind: LabToolKind
  books?: 'none' | 'single' | 'multi'
  chapter?: boolean
  question?: boolean
  questionLabel?: string
  questionPlaceholder?: string
}

/**
 * 工作台只保留四类任务：研究、深读、学习、整理。
 * 分享已回到成书页，关系图取代了实体网络，语音和行动实验不再单独占入口。
 */
export const LAB_TOOLS: LabTool[] = [
  {
    id: 'library-research',
    group: '研究',
    title: '全库研究',
    description: '跨所有书和笔记提问，答案带书名与章节依据。',
    kind: 'chat',
    books: 'none',
  },
  {
    id: 'author-roundtable',
    group: '研究',
    title: '作者圆桌',
    description: '让一位或两位作者回答你的质疑，或让两位作者互相回应。',
    kind: 'chat',
    books: 'multi',
    questionLabel: '你想问作者什么？',
  },
  {
    id: 'devils-advocate',
    group: '研究',
    title: '魔鬼代言人',
    description: 'AI 站在反方挑战这一章，逼你把理解说清楚。',
    kind: 'chat',
    books: 'single',
    chapter: true,
  },
  {
    id: 'book-club',
    group: '研究',
    title: '多角色读书会',
    description: '初学者、怀疑者和实践者围绕这一章轮流发言。',
    kind: 'chat',
    books: 'single',
    chapter: true,
  },
  {
    id: 'cross-book-synthesis',
    group: '研究',
    title: '跨书综述',
    description: '选几本书和一个主题，生成带引用的共同点、分歧和盲点。',
    kind: 'report',
    books: 'multi',
    question: true,
    questionLabel: '综述主题',
    questionPlaceholder: '例如：这几本书如何理解习惯的形成？',
  },
  {
    id: 'reading-path',
    group: '研究',
    title: '阅读路径',
    description: '给一个目标，从书库里排出一条按顺序阅读的路线。',
    kind: 'report',
    books: 'multi',
    question: true,
    questionLabel: '学习目标',
    questionPlaceholder: '例如：30 天理解习惯形成',
  },
  {
    id: 'weekly-review',
    group: '研究',
    title: '每周复盘',
    description: '把最近一周的笔记整理成一份安静的复盘。',
    kind: 'report',
    books: 'none',
  },
  {
    id: 'annual-report',
    group: '研究',
    title: '年度阅读报告',
    description: '回顾读过的书、反复出现的概念和观点变化。',
    kind: 'report',
    books: 'none',
  },
  {
    id: 'argument-map',
    group: '深读',
    title: '论证地图',
    description: '把一章拆成主张、前提、证据和反例的层次树。',
    kind: 'report',
    books: 'single',
    chapter: true,
  },
  {
    id: 'chapter-annotations',
    group: '深读',
    title: '全章边注',
    description: '为整章生成克制的页边注，只解释真正有信息增量的地方。',
    kind: 'report',
    books: 'single',
    chapter: true,
  },
  {
    id: 'margin-note',
    group: '深读',
    title: 'AI 边注',
    description: '粘贴一句原文，生成一条解释、呼应或反例的边注。',
    kind: 'report',
    books: 'single',
    chapter: true,
    question: true,
    questionLabel: '选中的原文',
    questionPlaceholder: '粘贴你想批注的一段原文…',
  },
  {
    id: 'view-timeline',
    group: '深读',
    title: '观点演变',
    description: '围绕一个概念，看你从早期到现在的理解变化。',
    kind: 'report',
    books: 'none',
    question: true,
    questionLabel: '概念或关键词',
    questionPlaceholder: '例如：意志力',
  },
  {
    id: 'knowledge-gaps',
    group: '深读',
    title: '知识缺口',
    description: '分析概念图里的孤立主题、冲突和下一步值得补的内容。',
    kind: 'report',
    books: 'none',
  },
  {
    id: 'fact-check',
    group: '深读',
    title: '事实核查',
    description: '逐条核查本章的事实性主张，区分库内依据和需要外部核查。',
    kind: 'report',
    books: 'single',
    chapter: true,
  },
  {
    id: 'pdf-page',
    group: '深读',
    title: '扫描页 / 图表理解',
    description: '渲染 PDF 某一页，用本机 OCR 读取文字，再解释图表、版式和关键数据。',
    kind: 'pdf',
    books: 'none',
  },
  {
    id: 'podcast',
    group: '深读',
    title: '双人播客',
    description: '把章节变成一段主持人与作者视角的对谈脚本，可直接听。',
    kind: 'report',
    books: 'single',
    chapter: true,
  },
  {
    id: 'adaptive-quiz',
    group: '学习',
    title: '自适应出题',
    description: '按当前章节生成主旨、为什么、比较、应用和反例题，并检查自由回答。',
    kind: 'quiz',
    books: 'single',
    chapter: true,
  },
  {
    id: 'concept-merge',
    group: '整理',
    title: '概念合并',
    description: '找出重复或近义的标签，合并成一张更干净的概念表。',
    kind: 'merge',
    books: 'none',
  },
  {
    id: 'card-dedupe',
    group: '整理',
    title: '卡片去重',
    description: '找出同一本书里高度相似的卡片，合并内容和证据。',
    kind: 'dedupe',
    books: 'none',
  },
]

export function labTool(id: LabToolId): LabTool | undefined {
  return LAB_TOOLS.find((tool) => tool.id === id)
}
