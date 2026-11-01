import type {
  BookSummary,
  ChapterContent,
  KnowledgeMapData,
  Note,
  ReaderMark,
  ReaderStyle,
  RelatedNote,
} from '../../shared/types.js'
import type { ShareBook, ShareCardInput, ShareNote } from '../lib/share-card.js'

export const articleHtml = `
  <div class="chapter-opener">
    <p>六月的傍晚，风从窗缝里挤进来，把桌上的稿纸吹得沙沙响。她把笔放下，第一次认真问自己：如果没有人替我安排，我到底想把时间花在哪里？</p>
    <h2>把时间花在真正重要的事情上</h2>
    <p>答案并不宏大。她想读完那本搁置了半年的书，想把母亲的旧菜谱整理出来，也想在周末的清晨独自走一段很长的路。这些事没有一件能写进简历，却让她在想到它们时，心里安静下来。</p>
    <blockquote>“所谓自由，不是想做什么就做什么，而是知道什么值得做，然后真的去做。”</blockquote>
    <p>从那以后，她给自己立了一条很笨的规矩：每周只挑三件事，写在本子最上面。其余的事情再急，也排在它们后面。奇怪的是，拒绝变得容易了，时间反而多出来。</p>
    <h2>慢一点，也没关系</h2>
    <ul>
      <li>把注意力交给正在做的事，而不是下一件事。</li>
      <li>允许自己做得不完美，先完成，再改进。</li>
      <li>在一天结束前，记下一个具体的、微小的进展。</li>
    </ul>
    <p>后来她明白，生活的秩序不是一次规划出来的，而是在一次次选择里慢慢长出来的。它不喧哗，也不需要向谁证明，只是在某个普通的傍晚，让人愿意再坐下来，写下一行字。</p>
  </div>
`

export const articleChapter: ChapterContent = {
  id: 'chapter-3',
  idx: 3,
  title: '第三章 把时间花在真正重要的事情上',
  chars: 1860,
  hidden: false,
  kind: 'content',
  reason: null,
  classifiedBy: null,
  partTitle: '第二部 看见自己',
  partIndex: 1,
  isPart: false,
  bookId: 'book-thinread-demo',
  html: articleHtml,
  text: articleHtml.replace(/<[^>]+>/g, '\n').replace(/\n{2,}/g, '\n\n').trim(),
  formattedHtml: articleHtml,
  removed: [],
  noteReport: null,
}

export const articleMarks: ReaderMark[] = [
  {
    id: 'mark-1',
    bookId: 'book-thinread-demo',
    chapterId: 'chapter-3',
    quote: '把时间花在真正重要的事情上',
    style: 'highlight',
    createdAt: '2026-09-18T10:00:00.000Z',
  },
  {
    id: 'mark-2',
    bookId: 'book-thinread-demo',
    chapterId: 'chapter-3',
    quote: '所谓自由，不是想做什么就做什么，而是知道什么值得做',
    style: 'underline',
    createdAt: '2026-09-18T10:05:00.000Z',
  },
  {
    id: 'mark-3',
    bookId: 'book-thinread-demo',
    chapterId: 'chapter-3',
    quote: '生活的秩序不是一次规划出来的',
    style: 'strikethrough',
    createdAt: '2026-09-18T10:08:00.000Z',
  },
]

export const articleEchoes: RelatedNote[] = [
  {
    id: 'note-echo-1',
    bookId: 'book-atomic-habits',
    bookTitle: '掌控习惯',
    chapterId: 'chapter-1',
    chapterTitle: '微小习惯的力量',
    title: '把选择变成默认',
    content: '与其每天重新决定，不如把重要的事放进固定的时间和位置。',
    tags: ['习惯', '行动'],
    score: 0.86,
  },
  {
    id: 'note-echo-2',
    bookId: 'book-thinread-demo',
    bookTitle: '页边样书',
    chapterId: 'chapter-2',
    chapterTitle: '第二章 拒绝的练习',
    title: '拒绝是在给重要的事让路',
    content: '每一次说不，都是在替真正想做的事保留空间。',
    tags: ['边界'],
    score: 0.74,
  },
]

export const readerStyle: ReaderStyle = {
  fontFamily: 'serif',
  fontSize: 17,
  lineHeight: 1.98,
  paragraphSpacing: 1.15,
  indent: false,
  theme: 'folio',
}

export const shareQuoteNote: ShareNote = {
  id: 'note-quote-1',
  title: '时间花在哪里，人生就在哪里',
  content: '不用把每一天都排满。先找出真正重要的事，再给它留出完整的时间。',
  quote: '所谓自由，不是想做什么就做什么，而是知道什么值得做，然后真的去做。',
  tags: ['自由', '选择', '时间'],
  bookTitle: '页边样书',
  chapterTitle: '第三章 把时间花在真正重要的事情上',
  kind: 'highlight',
}

export const shareKnowledgeNote: ShareNote = {
  id: 'note-knowledge-1',
  title: '拒绝是给重要的事让路',
  content:
    '每一次拒绝，都不是在关上一扇门，而是在替真正想做的事保留空间。判断标准不是事情看起来是否紧急，而是它是否值得占用你有限的一段时间。',
  quote: '拒绝变得容易了，时间反而多出来。',
  tags: ['边界', '精力管理'],
  bookTitle: '页边样书',
  chapterTitle: '第二章 拒绝的练习',
  kind: 'point',
}

export const shareCondensedNote: ShareNote = {
  id: 'note-condensed-1',
  title: '读薄：第三章 把时间花在真正重要的事情上',
  content:
    '这一章讲的是一个很朴素的转变：从“把每件事都做完”转向“先决定什么值得做”。作者用三个练习把注意力收回来——只挑三件事、允许不完美、每天记下一个微小进展。秩序不是规划出来的，而是在一次次选择里长出来的。',
  quote: '',
  tags: ['读薄', '时间'],
  bookTitle: '页边样书',
  chapterTitle: '第三章 把时间花在真正重要的事情上',
  kind: 'condensed',
}

export const shareDeckNotes: ShareNote[] = [
  shareQuoteNote,
  shareKnowledgeNote,
  {
    id: 'note-quote-2',
    title: '慢一点，也没关系',
    content: '允许自己做得不完美，先完成，再改进。',
    quote: '允许自己做得不完美，先完成，再改进。',
    tags: ['行动'],
    bookTitle: '页边样书',
    chapterTitle: '第三章 把时间花在真正重要的事情上',
    kind: 'highlight',
  },
]

export const shareBook: ShareBook = {
  title: '页边样书',
  author: '林一白',
  chapterCount: 12,
  noteCount: 8,
  cards: [
    { title: '拒绝是给重要的事让路', content: '每一次说不，都是在替真正想做的事保留空间。' },
    { title: '慢一点，也没关系', content: '允许自己做得不完美，先完成，再改进。' },
    { title: '记下具体的进展', content: '在一天结束前，记下一个具体的、微小的进展。' },
  ],
}

function baseShareInput(overrides: Partial<ShareCardInput> = {}): ShareCardInput {
  return {
    template: 'quote',
    theme: 'paper',
    ratio: 'portrait',
    title: shareQuoteNote.title,
    body: shareQuoteNote.content,
    quote: shareQuoteNote.quote ?? '',
    source: `${shareQuoteNote.bookTitle} · ${shareQuoteNote.chapterTitle ?? ''}`,
    tags: shareQuoteNote.tags,
    hideSource: false,
    hideTags: false,
    book: null,
    deck: null,
    ...overrides,
  }
}

export const shareInputs = {
  quotePaper: baseShareInput({ template: 'quote', theme: 'paper' }),
  quoteInk: baseShareInput({ template: 'quote', theme: 'ink' }),
  knowledgePaper: baseShareInput({
    template: 'knowledge',
    theme: 'paper',
    title: shareKnowledgeNote.title,
    body: shareKnowledgeNote.content,
    quote: shareKnowledgeNote.quote ?? '',
    source: `${shareKnowledgeNote.bookTitle} · ${shareKnowledgeNote.chapterTitle ?? ''}`,
    tags: shareKnowledgeNote.tags,
  }),
  knowledgeInk: baseShareInput({
    template: 'knowledge',
    theme: 'ink',
    title: shareKnowledgeNote.title,
    body: shareKnowledgeNote.content,
    quote: shareKnowledgeNote.quote ?? '',
    source: `${shareKnowledgeNote.bookTitle} · ${shareKnowledgeNote.chapterTitle ?? ''}`,
    tags: shareKnowledgeNote.tags,
  }),
  condensedPaper: baseShareInput({
    template: 'condensed',
    theme: 'paper',
    title: shareCondensedNote.title,
    body: shareCondensedNote.content,
    quote: '',
    source: `${shareCondensedNote.bookTitle} · ${shareCondensedNote.chapterTitle ?? ''}`,
    tags: shareCondensedNote.tags,
  }),
  condensedInk: baseShareInput({
    template: 'condensed',
    theme: 'ink',
    title: shareCondensedNote.title,
    body: shareCondensedNote.content,
    quote: '',
    source: `${shareCondensedNote.bookTitle} · ${shareCondensedNote.chapterTitle ?? ''}`,
    tags: shareCondensedNote.tags,
  }),
  bookPaper: baseShareInput({
    template: 'book',
    theme: 'paper',
    title: shareBook.title,
    body: '读完这本书，最想留下的一句话是：自由来自清楚，而不是来自更多。',
    quote: '',
    source: shareBook.author,
    tags: [],
    book: shareBook,
  }),
  bookInk: baseShareInput({
    template: 'book',
    theme: 'ink',
    title: shareBook.title,
    body: '读完这本书，最想留下的一句话是：自由来自清楚，而不是来自更多。',
    quote: '',
    source: shareBook.author,
    tags: [],
    book: shareBook,
  }),
  deckPaper: baseShareInput({
    template: 'deck',
    theme: 'paper',
    title: '页边样书 · 摘录集',
    body: '',
    quote: '',
    source: '我的读书摘录',
    tags: [],
    deck: shareDeckNotes,
  }),
  deckInk: baseShareInput({
    template: 'deck',
    theme: 'ink',
    title: '页边样书 · 摘录集',
    body: '',
    quote: '',
    source: '我的读书摘录',
    tags: [],
    deck: shareDeckNotes,
  }),
} satisfies Record<string, ShareCardInput>

export const libraryBooks: BookSummary[] = [
  {
    id: 'book-thinread-demo',
    title: '页边样书',
    author: '林一白',
    format: 'epub',
    genre: 'nonfiction',
    hasCover: false,
    chapterCount: 12,
    hiddenChapterCount: 1,
    noteCount: 8,
    totalChars: 98600,
    readChars: 41200,
    createdAt: '2026-08-02T09:00:00.000Z',
    lastOpenedAt: '2026-10-30T21:10:00.000Z',
    currentChapterId: 'chapter-3',
    currentChapterIdx: 3,
    progress: 0.42,
  },
  {
    id: 'book-atomic-habits',
    title: '掌控习惯',
    author: '詹姆斯·克利尔',
    format: 'pdf',
    genre: 'nonfiction',
    hasCover: false,
    chapterCount: 20,
    hiddenChapterCount: 0,
    noteCount: 14,
    totalChars: 152300,
    readChars: 152300,
    createdAt: '2026-06-11T08:00:00.000Z',
    lastOpenedAt: '2026-10-22T19:40:00.000Z',
    currentChapterId: 'chapter-20',
    currentChapterIdx: 20,
    progress: 1,
  },
  {
    id: 'book-night-train',
    title: '夜行列车',
    author: '陈默',
    format: 'mobi',
    genre: 'fiction',
    hasCover: false,
    chapterCount: 9,
    hiddenChapterCount: 0,
    noteCount: 0,
    totalChars: 63700,
    readChars: 0,
    createdAt: '2026-10-01T12:00:00.000Z',
    lastOpenedAt: null,
    currentChapterId: null,
    currentChapterIdx: 0,
    progress: 0,
  },
]

export const noteCardNote: Note = {
  id: 'note-card-1',
  bookId: 'book-thinread-demo',
  chapterId: 'chapter-3',
  kind: 'point',
  title: '拒绝是给重要的事让路',
  content:
    '每一次拒绝，都不是在关上一扇门，而是在替真正想做的事保留空间。判断标准不是事情看起来是否紧急，而是它是否值得占用你有限的一段时间。',
  quote: '拒绝变得容易了，时间反而多出来。',
  quoteVerified: true,
  author: 'ai',
  edited: true,
  tags: ['边界', '精力管理'],
  section: '第三段 · 慢一点，也没关系',
  importance: 5,
  role: '支撑“先选择，再完成”的主张',
  divergences: [
    { type: 'boundary', text: '当拒绝会直接影响协作关系时，需要先解释取舍，而不是直接说不。' },
    { type: 'crossbook', text: '《掌控习惯》里把这种空间称为“让好习惯更容易发生”的环境设计。' },
  ],
  createdAt: '2026-09-18T10:12:00.000Z',
  updatedAt: '2026-09-19T08:20:00.000Z',
}

export const noteCardBacklinks: Note[] = [
  {
    ...noteCardNote,
    id: 'note-card-2',
    kind: 'thought',
    title: '给每周留三个空位',
    content: '每周只挑三件事，其余事情再急也排在后面。',
    quote: null,
    tags: [],
    divergences: [],
  },
]

export const xhsNotes: Note[] = [
  noteCardNote,
  {
    ...noteCardNote,
    id: 'note-xhs-2',
    title: '注意力是有限的',
    content: '注意力不是无限资源，每一次切换都在消耗它。把手机移出视线，比反复下决心更可靠。',
    quote: '把手机放到另一个房间，比告诉自己不要看手机更可靠。',
    tags: ['注意力', '环境'],
  },
  {
    ...noteCardNote,
    id: 'note-xhs-3',
    title: '先做两分钟',
    content: '先做一个两分钟动作，再决定要不要继续；行动本身会降低下一步的摩擦。',
    quote: null,
    tags: ['行动', '习惯'],
  },
  {
    ...noteCardNote,
    id: 'note-xhs-4',
    title: '秩序是长出来的',
    content: '生活的秩序不是一次规划出来的，而是在一次次选择里慢慢长出来的。',
    quote: null,
    tags: ['秩序', '选择'],
  },
]

export const knowledgeMapFixture: KnowledgeMapData = {
  nodes: [
    {
      id: 'book-thinread-demo',
      type: 'book',
      label: '页边样书',
      bookId: 'book-thinread-demo',
      bookTitle: '页边样书',
      chapterId: null,
      chapterTitle: null,
      noteId: null,
      kind: null,
      weight: 4,
      tags: [],
      noteCount: 4,
      preview: null,
    },
    {
      id: 'book-atomic-habits',
      type: 'book',
      label: '掌控习惯',
      bookId: 'book-atomic-habits',
      bookTitle: '掌控习惯',
      chapterId: null,
      chapterTitle: null,
      noteId: null,
      kind: null,
      weight: 3,
      tags: [],
      noteCount: 2,
      preview: null,
    },
    {
      id: 'concept-boundary',
      type: 'concept',
      label: '边界',
      bookId: 'book-thinread-demo',
      bookTitle: '页边样书',
      chapterId: 'chapter-3',
      chapterTitle: '第三章 把时间花在真正重要的事情上',
      noteId: 'note-card-1',
      kind: 'point',
      weight: 3,
      tags: ['边界', '精力管理'],
      noteCount: 2,
      preview: '拒绝是给重要的事让路。',
    },
    {
      id: 'concept-habit',
      type: 'concept',
      label: '习惯',
      bookId: 'book-atomic-habits',
      bookTitle: '掌控习惯',
      chapterId: null,
      chapterTitle: null,
      noteId: null,
      kind: null,
      weight: 2,
      tags: ['习惯'],
      noteCount: 2,
      preview: '把选择变成默认。',
    },
    {
      id: 'concept-environment',
      type: 'concept',
      label: '环境设计',
      bookId: 'book-thinread-demo',
      bookTitle: '页边样书',
      chapterId: 'chapter-3',
      chapterTitle: '第三章 把时间花在真正重要的事情上',
      noteId: null,
      kind: null,
      weight: 2,
      tags: ['环境', '习惯'],
      noteCount: 2,
      preview: '把手机移到另一个房间。',
    },
  ],
  edges: [
    { id: 'e1', source: 'book-thinread-demo', target: 'concept-boundary', kind: 'book', weight: 2, cross: false },
    { id: 'e2', source: 'book-atomic-habits', target: 'concept-habit', kind: 'book', weight: 2, cross: false },
    { id: 'e3', source: 'book-thinread-demo', target: 'concept-environment', kind: 'book', weight: 2, cross: false },
    { id: 'e4', source: 'concept-habit', target: 'concept-environment', kind: 'tag', weight: 1, cross: true },
    { id: 'e5', source: 'concept-boundary', target: 'concept-environment', kind: 'semantic', weight: 1, cross: true },
  ],
  semanticReady: true,
  totalNotes: 8,
  displayedNotes: 6,
}
