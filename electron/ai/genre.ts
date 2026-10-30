import type { BookGenre } from '../../shared/types.js'

export const BOOK_GENRE_LABELS: Record<BookGenre, string> = {
  auto: '自动判断',
  nonfiction: '非虚构',
  history: '历史',
  'historical-fiction': '历史小说',
  fiction: '小说',
  detective: '侦探 / 悬疑',
  biography: '传记 / 回忆录',
  myth: '神话 / 奇幻',
  other: '其他',
}

const GENRE_RULES: Record<BookGenre, string> = {
  auto: '',
  nonfiction:
    '这是一本非虚构书。优先保留主张、论证链、机制、方法、数据结论和边界条件；不要把作者的观点磨成泛泛的口号。',
  history:
    '这是一本历史书。优先保留时间、人物、制度、因果和作者的史料判断；叙事性段落里的事实与转折不要当成铺垫删掉。',
  'historical-fiction':
    '这是一本历史小说。优先保留人物动机、阵营、时代制度、关键事件和人物弧光；不要把小说当成只有论点的非虚构来压缩。',
  fiction:
    '这是一本小说。优先保留人物、动机、冲突、转折、意象和主题线索；不要把叙事压成情节梗概，也不要把人物说的话当成作者主张。',
  detective:
    '这是一本侦探/悬疑作品。优先保留线索、嫌疑人、时间线、动机、误导和揭示；笔记和卡片标题不要提前剧透核心真相。',
  biography:
    '这是一本传记或回忆录。优先保留人物关系、时代背景、关键选择、转折和作者的自省；区分传主经历与作者评价。',
  myth:
    '这是一本神话/奇幻作品。优先保留谱系、神职、领域、禁忌、象征和世界观规则；不要把神话设定当成现实事实。',
  other: '',
}

/** 返回可直接拼进提示词的体裁约束；auto/other 不额外限制模型。 */
export function genreRule(genre: BookGenre | undefined): string {
  return genre ? GENRE_RULES[genre] : ''
}
