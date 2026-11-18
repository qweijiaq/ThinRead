import type { DeepLinkTarget } from './deep-link.js'

export type BookFormat = 'epub' | 'pdf' | 'pdf-ocr' | 'mobi' | 'url' | 'text'

/** 书架状态：待读 / 在读 / 读完 / 归档。 */
export type BookShelfStatus = 'inbox' | 'reading' | 'finished' | 'archived'

/** 书籍体裁只作为生成提示，不限制任何功能。 */
export type BookGenre =
  | 'auto'
  | 'nonfiction'
  | 'history'
  | 'historical-fiction'
  | 'fiction'
  | 'detective'
  | 'biography'
  | 'myth'
  | 'other'

export type GenerationMode = 'fast' | 'standard' | 'deep'

/** 外文书籍的读薄/知识点输出语言；默认简体中文。 */
export type NotesLanguage = 'zh' | 'source'

/** 读薄/卡片是否把章节图片作为多模态输入。 */
export type VisionMode = 'auto' | 'always' | 'off'

export type NoteKind = 'condensed' | 'summary' | 'claim' | 'point' | 'question' | 'thought' | 'highlight'

export type NoteColor = 'red' | 'yellow' | 'green' | 'blue'

export type NoteAuthor = 'ai' | 'user'

export type DivergenceType = 'boundary' | 'crossbook' | 'transfer'

export interface NoteDivergence {
  type: DivergenceType
  text: string
}

export type ChapterKind = 'content' | 'front' | 'nav' | 'cover' | 'copyright' | 'ad' | 'index' | 'unknown'

export type ChapterFlagSource = 'heuristic' | 'ai' | 'user'

export interface BookSummary {
  id: string
  title: string
  author: string
  format: BookFormat
  genre: BookGenre
  hasCover: boolean
  chapterCount: number
  hiddenChapterCount: number
  noteCount: number
  /** 可见章节的总字数。 */
  totalChars: number
  /** 已读章节的累计字数。 */
  readChars: number
  createdAt: string
  lastOpenedAt: string | null
  currentChapterId: string | null
  currentChapterIdx: number
  progress: number
  shelfStatus: BookShelfStatus
}

export interface ChapterMeta {
  id: string
  idx: number
  title: string
  chars: number
  hidden: boolean
  kind: ChapterKind
  reason: string | null
  classifiedBy: ChapterFlagSource | null
  /** 属于哪一篇/部；没有分篇的书写 null。 */
  partTitle: string | null
  partIndex: number | null
  /** 这一节本身就是篇首页（有导语内容时可以打开阅读）。 */
  isPart: boolean
}

export interface ChapterContent extends ChapterMeta {
  bookId: string
  html: string | null
  text: string
  /** AI 排版后的 HTML；为空时显示原始 html。 */
  formattedHtml: string | null
  /** AI 排版时移除的内容，逐条展示给用户。 */
  removed: RemovedPart[]
  /** 上一次笔记生成的覆盖报告。 */
  noteReport: NoteReport | null
  /** AI 翻译后的正文纯文本，用于兼容旧数据和纯文本回退。 */
  translatedText: string | null
  /** AI 翻译后的 HTML，保留标题、表格和段落结构。 */
  translatedHtml: string | null
  translatedAt: string | null
}

export interface ReaderStyle {
  fontFamily: 'serif' | 'sans'
  fontSize: number
  lineHeight: number
  paragraphSpacing: number
  letterSpacing: number
  fontWeight: number
  indent: boolean
  theme: 'paper' | 'plain' | 'warm' | 'folio' | 'night'
  /** 正文版心最大宽度（px）。 */
  maxWidth: number
}

export const DEFAULT_READER_STYLE: ReaderStyle = {
  fontFamily: 'serif',
  fontSize: 17,
  lineHeight: 1.86,
  paragraphSpacing: 0.7,
  letterSpacing: 0,
  fontWeight: 400,
  indent: false,
  theme: 'folio',
  maxWidth: 720,
}

export interface RemovedPart {
  reason: string
  text: string
  verified: boolean
}

export interface FormatChapterOptions {
  /** 在 AI 排版前先在本地移除参考文献、注释、索引和延伸阅读。 */
  skipReferences?: boolean
}

export interface FormatResult {
  chapterId: string
  html: string
  removed: RemovedPart[]
  style: ReaderStyle
  note: string
  /** 排版后正文的实际字符数，用于同步章节字数与书架进度。 */
  chars: number
}

export interface Note {
  id: string
  bookId: string
  chapterId: string | null
  kind: NoteKind
  title: string
  content: string
  quote: string | null
  quoteVerified: boolean
  author: NoteAuthor
  edited: boolean
  tags: string[]
  color?: NoteColor | null
  section: string | null
  importance: number | null
  /** 这张卡片在全文中的作用：支撑什么结论。 */
  role: string | null
  /** AI 延伸，最多 3 条，类型为边界/跨书/触类。 */
  divergences: NoteDivergence[]
  createdAt: string
  updatedAt: string
}

/** 写入数据库前的 AI 笔记；id、作者和时间由存储层补齐。 */
export interface GeneratedNote {
  kind: NoteKind
  title: string
  content: string
  quote: string | null
  quoteVerified: boolean
  tags: string[]
  section?: string | null
  importance?: number | null
  role?: string | null
  divergences?: NoteDivergence[]
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export type GenerationStage =
  | 'condense'
  | 'audit-fidelity'
  | 'audit-details'
  | 'extract-cards'
  | 'refilter-cards'
  | 'expand-cards'

/** 生成过程中失败的步骤；有内容说明这次结果是降级的，不能当成完整结果。 */
export interface DegradedStep {
  stage: GenerationStage
  failed: number
  total?: number
  message?: string
}

export interface NoteReport {
  originalChars: number
  condensedChars: number
  /** 原文长度 / 读薄稿长度，例如 3.7 表示约 1/3.7。 */
  ratio: number
  sections: number
  cards: number
  divergences: number
  fidelityMissing: number
  omitted: number
  /** 未采纳的原文片段，只用于报告，不进入读薄稿正文。 */
  omittedItems?: Array<{ text: string; reason: string }>
  /** 本次生成耗时（毫秒）。 */
  durationMs: number
  /** 使用的生成档位；旧报告没有这一项。 */
  mode?: GenerationMode
  /** 本次生成累计的模型 token；旧报告可能没有。 */
  usage?: TokenUsage
  promptVersion?: string
  /** 本次送入模型的图片数量。 */
  images?: number
  /** 是否真的把图片作为视觉输入发送。 */
  visionUsed?: boolean
  /** 本次直接复用了内容哈希缓存，没有调用模型。 */
  cached?: boolean
  /** 缓存命中时省下的 token。 */
  cachedTokens?: number
  /** 失败的生成步骤；空表示完整生成。 */
  degraded?: DegradedStep[]
  model: string
  createdAt: string
}

/** 渲染层崩溃/未捕获异常上报；只用于写本地日志，不联网。 */
export interface RendererErrorReport {
  scope: string
  message: string
  stack?: string | null
  componentStack?: string | null
  url?: string | null
}

export interface RelatedNote {
  id: string
  bookId: string
  bookTitle: string
  chapterId: string | null
  chapterTitle: string | null
  title: string
  content: string
  tags: string[]
  score: number
}

export type ReaderMarkStyle = 'highlight' | 'underline' | 'strikethrough'

export interface ReaderMark {
  id: string
  bookId: string
  chapterId: string
  quote: string
  style: ReaderMarkStyle
  createdAt: string
}

export interface LibraryNote extends Note {
  bookTitle: string
  chapterTitle: string | null
}

export interface TrashedNote {
  id: string
  title: string
  kind: NoteKind
  preview: string
  bookTitle: string
  chapterTitle: string | null
  deletedAt: string
}

export interface TrashedBook {
  id: string
  title: string
  author: string
  format: BookFormat
  chapterCount: number
  noteCount: number
  deletedAt: string
}

export interface TrashedChapter {
  id: string
  title: string
  bookId: string
  bookTitle: string
  noteCount: number
  deletedAt: string
}

export interface BackgroundTaskTarget {
  id: string
  title: string
}

export interface BackgroundTaskRecord {
  id: string
  kind: 'notes' | 'format' | 'compose' | 'translate'
  bookId: string
  targets: BackgroundTaskTarget[]
  status: 'running' | 'paused' | 'done' | 'error' | 'cancelled'
  done: number
  total: number
  failures: Array<{ chapterId: string; title: string; message: string }>
  /** 任务附加参数，例如成稿的篇幅/语气选项；旧任务可能没有。 */
  meta?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type NoteAuditFilter = 'unverified' | 'noQuote' | 'edited'

export interface LibraryFilter {
  bookId?: string | null
  tag?: string | null
  /** 只看没有任何标签的笔记。 */
  untagged?: boolean
  kind?: NoteKind | null
  query?: string
  audit?: NoteAuditFilter | null
  /** 只导出/筛选指定笔记；空数组表示没有结果。 */
  ids?: string[]
  limit?: number
  offset?: number
  /** 笔记库排序：默认最近更新。 */
  sort?: 'updated' | 'created' | 'title' | 'book'
}

export interface LibraryNoteAudit {
  notes: number
  ai: number
  edited: number
  verified: number
  unverified: number
  noQuote: number
  chapterTotal: number
  chapterWithNotes: number
  chapterWithCondensed: number
}

export interface PageResult<T> {
  items: T[]
  total: number
}

export interface TagCount {
  tag: string
  count: number
}

export type ChatMode = 'answer' | 'socratic'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatCitation {
  quote: string
  verified: boolean
}

export interface ChatAnswer {
  answer: string
  citations: ChatCitation[]
}

export interface FeynmanResult {
  feedback: string
  covered: string[]
  missing: string[]
  misconceptions: string[]
}

export interface SessionSummary {
  title: string
  markdown: string
}

export interface SessionSummaryInput {
  chapterId: string
  minutes: number
}

export interface WeeklyReviewRecord {
  id: string
  week: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface ReadingPlanDay {
  date: string
  chapterIds: string[]
  chars: number
}

export interface ReadingPlanRecord {
  bookId: string
  startDate: string
  dailyMinutes: number
  days: ReadingPlanDay[]
  done: string[]
  createdAt: string
  updatedAt: string
}

export interface ReadingPlanInput {
  bookId: string
  startDate: string
  dailyMinutes: number
  days: ReadingPlanDay[]
  done: string[]
}

export interface AppNotice {
  kind: 'info' | 'error'
  text: string
}

export type CitationStyle = 'apa' | 'bibtex' | 'ris'

export interface CitationMeta {
  title: string
  author: string
  year: string
  publisher: string
  url: string
  doi: string
}

/** 模型价格（人民币 / 百万 token）；由用户填写，不内置会过期的价目表。 */
export interface AiModelPrice {
  inputPerMTokens: number
  outputPerMTokens: number
}

export type AiModelPricing = Record<string, AiModelPrice>

/**
 * 内置参考价（人民币 / 百万 token），用于首次打开时就有费用估算。
 * 数据来自各厂商 2026-11-08 前后的公开价目页；美元按 1 USD ≈ 6.73 CNY 折算。
 * DeepSeek 取高峰时段缓存未命中价，实际空闲时段会便宜一半。
 * 价格会变，设置里可以随时改写；统计页只做估算，最终以账单为准。
 */
export const AI_PRICING_REFERENCE_DATE = '2026-11-08'

export const REFERENCE_AI_PRICING: AiModelPricing = {
  'deepseek-flash': { inputPerMTokens: 2, outputPerMTokens: 8 },
  'deepseek-v4-flash': { inputPerMTokens: 2, outputPerMTokens: 8 },
  'deepseek-v4.1-flash': { inputPerMTokens: 2, outputPerMTokens: 8 },
  'deepseek-v4.1-flash-1017': { inputPerMTokens: 2, outputPerMTokens: 8 },
  'deepseek-chat': { inputPerMTokens: 2, outputPerMTokens: 8 },
  'deepseek-reasoner': { inputPerMTokens: 2, outputPerMTokens: 8 },
  'deepseek-v4-pro': { inputPerMTokens: 9, outputPerMTokens: 27 },
  'glm-5.3': { inputPerMTokens: 8, outputPerMTokens: 28 },
  'glm-5.3-flash': { inputPerMTokens: 0.8, outputPerMTokens: 2.8 },
  'glm-5.2': { inputPerMTokens: 8, outputPerMTokens: 28 },
  'glm-4.6v': { inputPerMTokens: 1, outputPerMTokens: 3 },
  'claude-sonnet-5': { inputPerMTokens: 13.5, outputPerMTokens: 67.3 },
  'claude-sonnet-5.5': { inputPerMTokens: 13.5, outputPerMTokens: 67.3 },
  'claude-opus-5': { inputPerMTokens: 33.7, outputPerMTokens: 168.3 },
  'claude-opus-5.5': { inputPerMTokens: 26.9, outputPerMTokens: 134.6 },
  'claude-haiku-5': { inputPerMTokens: 0.7, outputPerMTokens: 3.4 },
  'claude-haiku-5.5': { inputPerMTokens: 0.7, outputPerMTokens: 3.4 },
  'gpt-5.6-sol': { inputPerMTokens: 26.9, outputPerMTokens: 134.6 },
  'gpt-6-sol': { inputPerMTokens: 13.5, outputPerMTokens: 67.3 },
  'gpt-6.1-sol': { inputPerMTokens: 13.5, outputPerMTokens: 67.3 },
  'gpt-6-luna': { inputPerMTokens: 0.7, outputPerMTokens: 3.4 },
  'gpt-4o-mini': { inputPerMTokens: 1, outputPerMTokens: 4 },
  'gpt-4o': { inputPerMTokens: 16.8, outputPerMTokens: 67.3 },
  'kimi-k3': { inputPerMTokens: 20, outputPerMTokens: 100 },
  'kimi-k3.1-pro': { inputPerMTokens: 13, outputPerMTokens: 68 },
  'kimi-k3.1-pro-highspeed': { inputPerMTokens: 26, outputPerMTokens: 136 },
  'moonshot-v1-128k': { inputPerMTokens: 13.5, outputPerMTokens: 33.7 },
  'qwen3.8-max': { inputPerMTokens: 12, outputPerMTokens: 36 },
  'qwen3.8-max-0902': { inputPerMTokens: 12, outputPerMTokens: 36 },
  'qwen3.7-max': { inputPerMTokens: 12, outputPerMTokens: 36 },
  'qwen3.7-plus': { inputPerMTokens: 2, outputPerMTokens: 8 },
  'qwen-plus': { inputPerMTokens: 0.8, outputPerMTokens: 2 },
  'qwen-max': { inputPerMTokens: 2.4, outputPerMTokens: 9.6 },
  'anthropic/claude-sonnet-5': { inputPerMTokens: 13.5, outputPerMTokens: 67.3 },
  'deepseek/deepseek-chat': { inputPerMTokens: 2, outputPerMTokens: 8 },
  'openai/gpt-4o': { inputPerMTokens: 16.8, outputPerMTokens: 67.3 },
  'qwen3.8-flash': { inputPerMTokens: 1, outputPerMTokens: 3.2 },
  'qwen3.6-plus': { inputPerMTokens: 3.4, outputPerMTokens: 20.2 },
  'claude-opus-4-6': { inputPerMTokens: 33.7, outputPerMTokens: 168.3 },
  'qwen3:8b': { inputPerMTokens: 0, outputPerMTokens: 0 },
}

export interface AiUsageDay {
  date: string
  calls: number
  failed: number
  tokens: number
  inputTokens: number
  outputTokens: number
  cost: number
  cacheHits: number
  cacheTokens: number
  cacheSavings: number
}

export interface AiUsageRow {
  calls: number
  failed: number
  tokens: number
  inputTokens: number
  outputTokens: number
  cost: number
  cacheHits: number
  cacheTokens: number
  cacheSavings: number
}

export interface NoteQualitySummary {
  total: number
  ai: number
  edited: number
  quoted: number
  verified: number
  verifiedRate: number
}

export interface AiUsageSummary {
  days: AiUsageDay[]
  models: Array<AiUsageRow & { model: string }>
  steps: Array<AiUsageRow & { step: string }>
  totalCalls: number
  totalFailed: number
  totalTokens: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number
  totalCacheHits: number
  totalCacheTokens: number
  totalCacheSavings: number
}

export interface ComposeSectionRewriteInput {
  bookId: string
  fullText: string
  start: number
  end: number
}

export interface ComposeSectionRewriteResult {
  text: string
  demo?: boolean
}

export interface CompareNotesInput {
  chapterId: string
  model: string
}

export interface CompareNotesResult {
  base: ContentItem
  compare: ContentItem
}

export interface CompareComposeInput {
  bookId: string
  model: string
  options?: BookComposeOptions
}

export interface CompareComposeResult {
  base: ContentItem
  compare: ContentItem
}

export type KnowledgeNodeType = 'book' | 'note' | 'concept'

export interface KnowledgeMapNode {
  id: string
  type: KnowledgeNodeType
  label: string
  bookId: string
  bookTitle: string
  chapterId: string | null
  chapterTitle: string | null
  noteId: string | null
  kind: NoteKind | null
  weight: number
  tags: string[]
  noteCount: number | null
  preview: string | null
}

export interface KnowledgeMapEdge {
  id: string
  source: string
  target: string
  kind: 'book' | 'semantic' | 'tag'
  weight: number
  cross: boolean
}

export interface KnowledgeMapData {
  nodes: KnowledgeMapNode[]
  edges: KnowledgeMapEdge[]
  semanticReady: boolean
  totalNotes: number
  displayedNotes: number
  untaggedNotes: number
}

export type LabToolId =
  | 'author-roundtable'
  | 'cross-book-synthesis'
  | 'argument-map'
  | 'margin-note'
  | 'weekly-review'
  | 'concept-merge'
  | 'library-research'
  | 'adaptive-quiz'
  | 'devils-advocate'
  | 'reading-path'
  | 'view-timeline'
  | 'knowledge-gaps'
  | 'podcast'
  | 'chapter-annotations'
  | 'card-dedupe'
  | 'book-club'
  | 'fact-check'
  | 'annual-report'
  | 'pdf-page'

export interface LabRequest {
  tool: LabToolId
  bookIds?: string[]
  chapterId?: string
  question?: string
  text?: string
}

export interface LabReport {
  title: string
  markdown: string
}

export type RelationNodeKind = 'person' | 'organization' | 'place' | 'event' | 'concept'

export type RelationRole =
  | 'detective'
  | 'killer'
  | 'victim'
  | 'witness'
  | 'suspect'
  | 'protagonist'
  | 'supporting'
  | 'other'

export interface RelationNode {
  id: string
  label: string
  kind: RelationNodeKind
  /** 叙事角色；只有人物才有 detective/killer/...，地点/事件使用 other。 */
  role: RelationRole
  importance: number
  /** 身份、职业或社会角色，例如「内阁首辅」「船长」。 */
  identity: string
  /** 官阶、职位、称号或神职。 */
  rank: string
  /** 阵营、国家、家族、组织或神话谱系。 */
  affiliation: string
  aliases: string[]
  /** 是否为真实人物/地点或神话人物。 */
  realWorld: boolean
  /** 模型提供的百科背景；不是书内原文，需要核对。 */
  encyclopedia: string
  description: string
  /** 书中出现这一节点的章节或页码，便于回查。 */
  chapters?: string[]
}

export interface RelationEdge {
  source: string
  target: string
  /** source → target 的关系。 */
  label: string
  /** target → source 的关系，例如「被杀害」。 */
  reverseLabel: string
  kind: 'family' | 'ally' | 'rival' | 'suspect' | 'motive' | 'clue' | 'event' | 'other'
  description: string
  /** 这条关系出现的章节或页码。 */
  chapters?: string[]
}

export interface RelationGraph {
  title: string
  genre: string
  summary: string
  /** 更详细的情节摘要，侦探/历史书可以包含关键事件和揭示。 */
  plot: string
  nodes: RelationNode[]
  edges: RelationEdge[]
}

export interface LabChatAnswer {
  answer: string
}

export interface LabMergeGroup {
  canonical: string
  tags: string[]
  reason: string
  noteCount: number
}

export interface LabDuplicatePair {
  keepId: string
  keepTitle: string
  keepBookTitle: string
  keepChapterId: string | null
  keepChapterTitle: string | null
  keepPreview: string
  mergeId: string
  mergeTitle: string
  mergeBookTitle: string
  mergeChapterId: string | null
  mergeChapterTitle: string | null
  mergePreview: string
  score: number
}

export interface LabQuizQuestion {
  question: string
  kind: string
  answer: string
  source: string
}

export interface LabQuiz {
  questions: LabQuizQuestion[]
}

export interface LabAnswerCheck {
  verdict: 'good' | 'partial' | 'off'
  feedback: string
  missing: string[]
}

export interface LabArtifact {
  id: string
  tool: string
  scope: string
  title: string
  content: string
  meta: string | null
  createdAt: string
}

export type ContentKind = 'report' | 'chat' | 'quiz' | 'notes' | 'format' | 'compose' | 'suggestion' | 'pdf' | 'graph' | 'other'

export type ContentStatus = 'draft' | 'adopted' | 'archived' | 'deleted'

export interface ContentItem extends LabArtifact {
  kind: ContentKind
  bookId: string | null
  chapterId: string | null
  bookTitle: string | null
  chapterTitle: string | null
  favorite: boolean
  status: ContentStatus
  updatedAt: string
  appliedNoteId: string | null
}

export interface ContentFilter {
  query?: string
  kind?: ContentKind
  tool?: string
  bookId?: string
  chapterId?: string
  favorite?: boolean
  status?: 'active' | ContentStatus | 'all'
  limit?: number
  offset?: number
  /** 全文索引给出的候选 id；只在主进程内部使用。 */
  ids?: string[]
}

export type ContentApplyAction = 'note' | 'source' | 'current'

export interface ContentApplyResult {
  appliedTo: 'note' | 'chapter' | 'current' | 'none'
  noteId?: string
  chapterId?: string
  undoToken?: string
  message: string
}

export interface NoteDraft {
  bookId: string
  chapterId?: string | null
  kind: NoteKind
  title?: string
  content: string
  quote?: string | null
  tags?: string[]
}

export interface NotePatch {
  title?: string
  content?: string
  quote?: string | null
  tags?: string[]
  color?: NoteColor | null
  kind?: NoteKind
}

export interface ChapterSuggestion {
  chapterId: string
  kind: ChapterKind
  reason: string
  confidence: number
  hidden: boolean
}

export interface ClassifyResult {
  suggestions: ChapterSuggestion[]
  mode: 'ai' | 'heuristic' | 'demo'
  error?: string
}

export interface ChapterFlag {
  chapterId: string
  hidden: boolean
  kind?: ChapterKind
  reason?: string | null
  classifiedBy?: ChapterFlagSource
}

export type ProviderId =
  | 'demo'
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'zhipu'
  | 'moonshot'
  | 'alibaba'
  | 'openrouter'
  | 'opencode'
  | 'opencode-go'
  | 'opendesign'
  | 'ollama'
  | 'lmstudio'

export interface ProviderPreset {
  id: ProviderId
  label: string
  baseUrl: string
  defaultModel: string
  suggestedModels?: string[]
  keyUrl: string
  hint: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'demo',
    label: '演示模式（无需 API Key）',
    baseUrl: '',
    defaultModel: 'demo',
    suggestedModels: ['demo'],
    keyUrl: '',
    hint: '用固定样例演示完整流程，生成的引用不可校验。',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    suggestedModels: ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    hint: '中文长文本性价比高。官方 OpenAI 端点是 api.deepseek.com；/v1 也可用。',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.3',
    suggestedModels: ['glm-5.3', 'glm-4.6v', 'glm-4-plus'],
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    hint: 'API Key 在 bigmodel.cn 的业务空间管理页创建。',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    baseUrl: '',
    defaultModel: 'claude-sonnet-5',
    suggestedModels: ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-5'],
    keyUrl: 'https://platform.claude.com/settings/keys',
    hint: '留空 Base URL 使用官方端点；Key 在 Claude 平台创建。',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.6-sol',
    suggestedModels: ['gpt-5.6-sol', 'gpt-4o-mini', 'gpt-4o'],
    keyUrl: 'https://platform.openai.com/api-keys',
    hint: '也可以填任何 OpenAI 兼容网关；模型 ID 以控制台为准。',
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k3',
    suggestedModels: ['kimi-k3', 'kimi-k3.1-pro', 'moonshot-v1-128k'],
    keyUrl: 'https://platform.kimi.com/console/api-keys',
    hint: '控制台已迁移到 platform.kimi.com；API 仍是 api.moonshot.cn/v1。',
  },
  {
    id: 'alibaba',
    label: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.8-max',
    suggestedModels: ['qwen3.8-max', 'qwen3.7-plus', 'qwen-max', 'qwen-plus'],
    keyUrl: 'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key',
    hint: '北京地域兼容地址；新账号建议改用业务空间专属域名。',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-5',
    suggestedModels: ['anthropic/claude-sonnet-5', 'deepseek/deepseek-chat', 'openai/gpt-4o'],
    keyUrl: 'https://openrouter.ai/keys',
    hint: '一个 Key 访问多家模型；模型 ID 要带厂商前缀。',
  },
  {
    id: 'opencode',
    label: 'OpenCode Zen / Console',
    baseUrl: 'https://opencode.ai/inference/openai/v1',
    defaultModel: 'qwen3.8-flash',
    suggestedModels: ['qwen3.8-flash', 'gpt-6.1-sol', 'claude-opus-4-6', 'deepseek-v4.1-flash'],
    keyUrl: 'https://opencode.ai/auth',
    hint: 'OpenCode 的按量计费网关（Zen / Console）。模型很多，保存前可以在设置里刷新完整模型列表。',
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/inference/go/openai/v1',
    defaultModel: 'gpt-6-luna',
    suggestedModels: ['gpt-6-luna', 'grok-4.7', 'kimi-k3.1-pro', 'deepseek-v4.1-flash'],
    keyUrl: 'https://opencode.ai/console/go',
    hint: 'OpenCode Go 是订阅制；统计页只记录 token，不按每 token 估算费用。',
  },
  {
    id: 'opendesign',
    label: 'OpenDesign',
    baseUrl: 'https://amr-link.open-design.ai/v1',
    defaultModel: 'deepseek-v4-flash',
    suggestedModels: [
      'deepseek-v4-flash',
      'deepseek-v4.1-flash',
      'deepseek-v4-pro',
      'glm-5.3-flash',
      'kimi-k2.7-code',
      'claude-haiku-5-5',
      'gpt-6-luna',
    ],
    keyUrl: 'https://open-design.ai/cloud/dashboard',
    hint: 'OpenDesign Cloud API Key；和 OpenDesign 客户端共用套餐额度，模型以账户里的列表为准。',
  },
  {
    id: 'ollama',
    label: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen3:8b',
    suggestedModels: ['qwen3:8b', 'llama3.1', 'llava'],
    keyUrl: '',
    hint: '本地推理，书和笔记都不出设备。',
  },
  {
    id: 'lmstudio',
    label: '本地 LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    suggestedModels: [],
    keyUrl: '',
    hint: 'LM Studio 的 OpenAI 兼容端点；本地推理，书和笔记都不出设备。',
  },
]

export interface SettingsView {
  provider: ProviderId
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
  apiKeyHint: string
  demo: boolean
  generationMode: GenerationMode
  notesLanguage: NotesLanguage
  visionMode: VisionMode
  notesModel: string
  composeModel: string
  labModel: string
  aiPricing: AiModelPricing
  aiBudgetEnabled: boolean
  aiBudgetMonthlyCny: number
  syncFolder: string
  syncLastPushAt: string
  syncLastPullAt: string
  syncLastMergeAt: string
  readwiseConfigured: boolean
  keysNeedReentry: boolean
  appLockEnabled: boolean
  qwenTtsConfigured: boolean
  qwenTtsBaseUrl: string
  qwenTtsModel: string
  qwenTtsVoiceA: string
  qwenTtsVoiceB: string
  qwenTtsVoiceEn: string
  qwenTtsPricePerK: number
  qwenTtsVoices: string[]
}

export interface SettingsPatch {
  provider: ProviderId
  baseUrl: string
  model: string
  apiKey?: string
  generationMode?: GenerationMode
  notesLanguage?: NotesLanguage
  visionMode?: VisionMode
  notesModel?: string
  composeModel?: string
  labModel?: string
  aiPricing?: AiModelPricing
  aiBudgetEnabled?: boolean
  aiBudgetMonthlyCny?: number
  readwiseToken?: string
  qwenTtsBaseUrl?: string
  qwenTtsModel?: string
  qwenTtsVoiceA?: string
  qwenTtsVoiceB?: string
  qwenTtsVoiceEn?: string
  qwenTtsPricePerK?: number
  qwenTtsVoices?: string[]
  qwenTtsKey?: string
}

export interface SyncSnapshot {
  name: string
  path: string
  createdAt: string
  size: number
  encrypted: boolean
  /** 只含数据库、不含书文件的轻量快照；只能合并，不能整库恢复。 */
  notesOnly?: boolean
}

export interface OpdsEntry {
  title: string
  author: string
  format: 'EPUB' | 'PDF'
  url: string
}

export interface WebDavConfigView {
  url: string
  username: string
  remotePath: string
  hasPassword: boolean
  lastPushAt: string
  lastPullAt: string
  autoPushDaily: boolean
  checkOnStartup: boolean
}

export interface WebDavConfigInput {
  url: string
  username: string
  password?: string
  remotePath?: string
  autoPushDaily?: boolean
  checkOnStartup?: boolean
}

export interface SyncStatus {
  folder: string
  lastPushAt: string
  lastPullAt: string
  lastMergeAt: string
  snapshots: SyncSnapshot[]
}

export interface MergeSnapshotResult {
  books: number
  chapters: number
  newBooks: string[]
  notes: number
  annotations: number
  bookmarks: number
  positions: number
  stats: number
  plans: number
  reviews: number
  skipped: number
}

export interface LocalModelDetection {
  ollama: string[]
  lmstudio: string[]
}

export interface TestResult {
  ok: boolean
  message: string
}

export interface ImportBookOptions {
  /** 导入时跳过参考文献、注释、索引和延伸阅读。 */
  skipReferences?: boolean
  /** PDF 使用 Docling 深度解析；需要本机安装 Python + Docling。 */
  deepPdf?: boolean
  /** PDF 整页视觉解析（Zerox 式）；使用当前笔记模型把页面转成 Markdown。 */
  visionPdf?: boolean
  /** 视觉解析时把上一页末尾作为上下文，改善跨页表格/代码块连续性（串行，较慢）。 */
  visionPdfMaintainFormat?: boolean
  /** 视觉解析的页码范围，例如 "1-20,25"；留空表示全部（最多 120 页）。 */
  visionPdfPages?: string
  /** 解析后额外生成表格与公式索引。 */
  visionPdfStructure?: boolean
}

export interface DoclingStatus {
  available: boolean
  version?: string
  python?: string
  error?: string
}

export interface ChapterContentSaveResult {
  html: string
  chars: number
}

export interface CodeAssistResult {
  mode: 'review' | 'explain' | 'fix'
  text: string
  html?: string
  chars?: number
  understood?: number
  skipped?: number
  changed?: boolean
  model?: string
}

export interface ImageUnderstandingResult {
  html: string
  understood: number
  skipped: number
  chars: number
  model?: string
  provider?: string
  fallback?: boolean
}

export interface DoclingProgressEvent {
  bookId?: string
  phase: 'initialize' | 'build' | 'assemble' | 'enrich' | 'pages' | 'done'
  done?: number
  total?: number
}

export interface AiModelListInput {
  provider?: ProviderId
  baseUrl?: string
  /** 测试新 Key 时可以临时传入；留空则使用已保存的 Key。 */
  apiKey?: string
}

export interface AiModelListResult {
  models: string[]
  error?: string
}

export interface TextImportInput extends ImportBookOptions {
  title?: string
  author?: string
  text: string
}

export interface OcrImportOptions {
  startPage?: number
  endPage?: number
}

export interface OcrProgress {
  current: number
  total: number
  page: number
}

export interface OcrImportStarted {
  started: boolean
  fileName: string
  jobId?: string
}

export interface OcrJob {
  id: string
  fileName: string
  filePath: string
  startPage: number
  endPage: number
  status: 'running' | 'done' | 'error' | 'cancelled' | 'interrupted'
  current: number
  total: number
  createdAt: string
  updatedAt: string
}

export interface OcrDoneEvent {
  book: BookSummary
  durationMs: number
}

export interface OcrErrorEvent {
  message: string
  cancelled: boolean
}

export interface HighlightImportResult {
  books: BookSummary[]
  highlights: number
}

export interface HighlightImportOptions {
  mergeExisting?: boolean
}

export interface SaveFileResult {
  saved: boolean
  path: string | null
}

export interface NotesExportResult extends SaveFileResult {
  count: number
  canceled?: boolean
}

export interface SaveImagesResult {
  saved: boolean
  path: string | null
  count: number
}

export interface ReadingPositionRecord {
  chapterId: string
  bookId: string
  scrollRatio: number
  scrollTop: number
  page: number | null
  updatedAt: string
}

export interface ReadingPositionInput {
  bookId: string
  chapterId: string
  scrollRatio: number
  scrollTop: number
  page?: number | null
}

export interface ReadingStatsData {
  total: number
  days: Record<string, number>
  books: Record<string, number>
}

export interface UiPreferences {
  autoNext: boolean
  dailyGoal: number
  /** 主进程是否已经保存过偏好；用于首次迁移和备份恢复时判断优先级。 */
  configured: boolean
}

export type PdfAnnotationColor = 'yellow' | 'green' | 'blue'

/** PDF 原版页面上的一块区域标注；坐标按页面宽高归一化到 0–1。 */
export interface PdfAnnotation {
  id: string
  bookId: string
  page: number
  x: number
  y: number
  width: number
  height: number
  note: string
  color: PdfAnnotationColor
  createdAt: string
  updatedAt: string
}

export interface ReadingBookmark {
  id: string
  bookId: string
  chapterId: string
  chapterTitle: string
  scrollRatio: number
  scrollTop: number
  page: number | null
  label: string
  quote: string | null
  createdAt: string
}

export interface ReadingBookmarkDraft {
  bookId: string
  chapterId: string
  scrollRatio: number
  scrollTop: number
  page?: number | null
  label: string
  quote?: string | null
}

export interface XhsCoverageMissing {
  id: string
  chapterId: string | null
  chapterTitle: string | null
  point: string
  evidence: string
}

export interface XhsCoverageAudit {
  missing: XhsCoverageMissing[]
  checkedChapters: number
  note: string
}

export interface XhsCoverageRequest {
  bookId: string
  chapterId?: string | null
  cards: Array<{ title: string; content: string; chapterTitle: string | null }>
}

export type BackupKind = 'auto' | 'manual'

export interface BackupInfo {
  id: string
  kind: BackupKind
  label: string
  createdAt: string
  bytes: number
}

export type SearchResultType = 'book' | 'chapter' | 'note' | 'content'

export interface SearchResult {
  type: SearchResultType
  id: string
  bookId: string
  bookTitle: string
  chapterId: string | null
  chapterTitle: string | null
  title: string
  snippet: string
  updatedAt: string | null
  /** 语义检索追加的笔记结果。 */
  source?: 'keyword' | 'semantic'
  score?: number
}

export interface TtsVoice {
  id: string
  label: string
  language: string
  gender?: 'female' | 'male' | 'unknown'
}

export interface TtsStatus {
  qwen: {
    configured: boolean
    baseUrl: string
    model: string
    voiceA: string
    voiceB: string
    voiceEn: string
    pricePerK: number
    voices: TtsVoice[]
  }
  system: {
    available: boolean
    voices: TtsVoice[]
  }
}

export interface TtsSynthesisRequest {
  text: string
  voice: string
}

export interface TtsAudio {
  mime: string
  base64: string
}

export interface GenerationProgress {
  phase: 'condense' | 'cards' | 'expand'
  done: number
  total: number
  cards: number
}

export interface GeneratePartial {
  summary?: string
  claims?: Array<{ claim?: string; quote?: string }>
  questions?: string[]
  concepts?: string[]
  progress?: GenerationProgress
}

export interface GenerationPartialEvent {
  chapterId: string
  partial: GeneratePartial
}

export interface GenerationDoneEvent {
  chapterId: string
  notes: Note[]
  report: NoteReport | null
}

export interface GenerationErrorEvent {
  chapterId: string
  message: string
}

export type AiJobKind = 'notes' | 'format' | 'compose' | 'translate'
export type AiJobStatus = 'running' | 'done' | 'error' | 'cancelled'

/** 单章 AI 任务快照：切章或切视图后用它重新接上进行中的任务。 */
export interface AiJobSnapshot {
  id: string
  kind: AiJobKind
  chapterId: string
  bookId: string
  title: string
  status: AiJobStatus
  detail: string
  done: number
  total: number
  error?: string
  partial?: GeneratePartial
  composeProgress?: BookComposeProgress
  /** 成稿任务的生成选项，应用重启后继续时复用。 */
  composeOptions?: BookComposeOptions
  /** 单章排版选项，应用重启后继续时复用。 */
  formatOptions?: FormatChapterOptions
  updatedAt: string
}

export interface ChapterAiJobs {
  notes: AiJobSnapshot | null
  format: AiJobSnapshot | null
  translate: AiJobSnapshot | null
}

export interface BookAiJobs {
  compose: AiJobSnapshot | null
}

export interface AiJobCancelTarget {
  chapterId?: string
  bookId?: string
}

export interface BookTranslationInfo {
  /** 整本书是否以外文为主；只有 true 时界面才显示翻译入口。 */
  foreign: boolean
  language: string
  ratio: number
  total: number
  translated: number
}

export interface BookTranslationOptions {
  /** 忽略已有译文，全部重新翻译。 */
  force?: boolean
  /** 只处理还没有译文的章节。 */
  onlyMissing?: boolean
  /** 只处理这些章节；用于任务中心重试失败章节。 */
  chapterIds?: string[]
}

export interface BookTranslationProgress {
  bookId: string
  title: string
  done: number
  total: number
  translated: number
  message?: string
}

export interface BookTranslationDoneEvent {
  bookId: string
  translated: number
  skipped: number
  failed: Array<{ chapterId: string; title: string; message: string }>
  cancelled: boolean
  error?: string
}

export interface ChapterTranslationProgress {
  chapterId: string
  done: number
  total: number
  message?: string
}

export interface ChapterTranslatedEvent {
  chapterId: string
  text: string
  html: string
  translatedAt: string
}

export interface ChapterTranslationErrorEvent {
  chapterId: string
  message: string
}

export interface BookFormatOptions extends FormatChapterOptions {
  /** 只处理还没有 AI 排版结果的章节；默认 false。 */
  onlyMissing?: boolean
  /** 只重试这些章节；不传表示全部可见章节。 */
  chapterIds?: string[]
}

export interface BookFormatProgress {
  bookId: string
  chapterId: string
  title: string
  index: number
  total: number
  status: 'start' | 'done' | 'error' | 'skipped'
  done: number
  message?: string
}

export interface BookFormatDoneEvent {
  bookId: string
  formatted: number
  skipped: number
  failed: Array<{ chapterId: string; title: string; message: string }>
  cancelled: boolean
}

export interface BookGenerationOptions {
  /** 只补还没有读薄稿的章节；默认 true。 */
  onlyMissing?: boolean
  /** 只重试这些章节；不传表示全部可见章节。 */
  chapterIds?: string[]
}

export interface BookGenerationChapter {
  chapterId: string
  title: string
  index: number
  total: number
  status: 'start' | 'done' | 'error' | 'skipped'
  message?: string
  notes?: number
}

export interface BookGenerationProgress extends BookGenerationChapter {
  bookId: string
  done: number
}

export interface BookGenerationDoneEvent {
  bookId: string
  generated: number
  skipped: number
  existing: number
  failed: Array<{ chapterId: string; title: string; message: string }>
  cancelled: boolean
}

export type BookComposeLength = 'tight' | 'full'
export type BookComposeVoice = 'calm' | 'personal' | 'sharp'

export interface BookComposeOptions {
  length: BookComposeLength
  voice: BookComposeVoice
}

export interface BookComposeProgress {
  stage: 'collect' | 'rewrite' | 'polish' | 'assemble'
  done: number
  total: number
  message: string
}

export interface BookComposeResult {
  title: string
  markdown: string
  sourceChapters: number
  sourceChars: number
  outputChars: number
  durationMs: number
  usage?: TokenUsage
  promptVersion?: string
  model: string
  createdAt: string
  options: BookComposeOptions
}

export interface AppInfo {
  version: string
  dataDir: string
  demo: boolean
  lockEnabled: boolean
}

export interface ShareCopyInput {
  title: string
  body: string
  kind?: string
}

export interface ShareCopyResult {
  title: string
  points: string[]
  note?: string
}

export interface GenerateNotesOptions {
  /** 忽略缓存，强制重新调用模型。 */
  fresh?: boolean
}

export interface ReadingApi {
  listBooks(): Promise<BookSummary[]>
  importBook(options?: ImportBookOptions): Promise<BookSummary | null>
  listOpds(url: string): Promise<OpdsEntry[]>
  importOpdsBook(entry: OpdsEntry): Promise<BookSummary>
  cancelBookImport(): Promise<void>
  getDoclingStatus(): Promise<DoclingStatus>
  understandChapterImage(chapterId: string, imageSrc: string): Promise<ImageUnderstandingResult>
  codeAssist(chapterId: string, code: string, mode: 'review' | 'explain' | 'fix', language?: string): Promise<CodeAssistResult>
  applyCodeFix(chapterId: string, code: string, fixed: string): Promise<{ changed: boolean; html?: string; chars?: number }>
  saveChapterContent(chapterId: string, html: string): Promise<ChapterContentSaveResult>
  onDoclingProgress(cb: (event: DoclingProgressEvent) => void): () => void
  importText(input: TextImportInput): Promise<BookSummary>
  importUrl(url: string, options?: ImportBookOptions): Promise<BookSummary>
  importScannedPdf(options?: OcrImportOptions): Promise<OcrImportStarted | null>
  listAiModels(input?: AiModelListInput): Promise<AiModelListResult>
  cancelOcrImport(): Promise<void>
  listOcrJobs(): Promise<OcrJob[]>
  resumeOcrJob(id: string): Promise<OcrImportStarted | null>
  syncReadwise(): Promise<HighlightImportResult>
  testReadwise(token?: string): Promise<TestResult>
  importHighlights(options?: HighlightImportOptions): Promise<HighlightImportResult | null>
  importWechatHighlights(options?: HighlightImportOptions): Promise<HighlightImportResult | null>
  openBook(bookId: string): Promise<{ book: BookSummary; chapters: ChapterMeta[]; style: ReaderStyle }>
  getReadingPlan(bookId: string): Promise<ReadingPlanRecord | null>
  listReadingPlans(): Promise<ReadingPlanRecord[]>
  saveReadingPlan(input: ReadingPlanInput): Promise<ReadingPlanRecord>
  deleteReadingPlan(bookId: string): Promise<void>
  renameBook(bookId: string, title: string, author?: string): Promise<BookSummary>
  setBookShelfStatus(bookId: string, status: BookShelfStatus): Promise<BookSummary>
  setBookGenre(bookId: string, genre: BookGenre): Promise<BookSummary>
  renameChapter(chapterId: string, title: string): Promise<void>
  renamePart(bookId: string, partIndex: number, title: string): Promise<void>
  reparseBook(bookId: string, options?: ImportBookOptions): Promise<BookSummary>
  mergeBooks(bookIds: string[], title: string, author: string): Promise<BookSummary>
  splitBook(bookId: string, fromChapterId: string, title: string): Promise<BookSummary>
  deleteBook(bookId: string): Promise<void>
  listTrashedBooks(): Promise<TrashedBook[]>
  restoreTrashedBook(bookId: string): Promise<BookSummary | null>
  purgeTrashedBook(bookId: string): Promise<void>
  emptyBookTrash(): Promise<void>
  formatChapter(chapterId: string, instruction?: string, options?: FormatChapterOptions): Promise<FormatResult>
  formatBook(bookId: string, options?: BookFormatOptions): Promise<void>
  cancelFormat(target?: AiJobCancelTarget): Promise<void>
  translateChapter(chapterId: string, options?: { force?: boolean }): Promise<void>
  translateBook(bookId: string, options?: BookTranslationOptions): Promise<void>
  getBookTranslationInfo(bookId: string): Promise<BookTranslationInfo>
  cancelTranslation(target?: AiJobCancelTarget): Promise<void>
  listAiJobs(): Promise<AiJobSnapshot[]>
  getChapterAiJobs(chapterId: string): Promise<ChapterAiJobs>
  getBookAiJobs(bookId: string): Promise<BookAiJobs>
  dismissAiJob(id: string): Promise<void>
  onAiJobUpdate(cb: (event: AiJobSnapshot) => void): () => void
  resetChapterFormat(chapterId: string): Promise<number>
  saveStyle(bookId: string, style: ReaderStyle): Promise<ReaderStyle>
  getChapter(chapterId: string): Promise<ChapterContent>
  setProgress(bookId: string, chapterId: string): Promise<void>
  getBookCover(bookId: string): Promise<string | null>
  listChapterMarks(chapterId: string): Promise<ReaderMark[]>
  createChapterMark(input: { chapterId: string; quote: string; style: ReaderMarkStyle }): Promise<ReaderMark>
  deleteChapterMark(id: string): Promise<void>
  classifyChapters(bookId: string): Promise<ClassifyResult>
  applyChapterFlags(flags: ChapterFlag[]): Promise<void>
  deleteChapters(chapterIds: string[]): Promise<void>
  listTrashedChapters(): Promise<TrashedChapter[]>
  restoreTrashedChapter(chapterId: string): Promise<ChapterContent | null>
  purgeTrashedChapter(chapterId: string): Promise<void>
  emptyChapterTrash(): Promise<number>
  listBackgroundTasks(): Promise<BackgroundTaskRecord[]>
  onDeepLink(listener: (target: DeepLinkTarget) => void): () => void
  onRelationGraphProgress(listener: (stage: 'nodes' | 'edges') => void): () => void
  listNotes(bookId: string, chapterId?: string | null): Promise<Note[]>
  listRelatedNotes(bookId: string, tags: string[], queryText?: string): Promise<RelatedNote[]>
  listLibraryNotes(filter?: LibraryFilter): Promise<LibraryNote[]>
  exportNotesMarkdown(filter?: LibraryFilter): Promise<NotesExportResult>
  listLibraryNotesPage(filter?: LibraryFilter): Promise<PageResult<LibraryNote>>
  getLibraryNoteAudit(filter?: LibraryFilter): Promise<LibraryNoteAudit>
  listLibraryTags(bookId?: string | null): Promise<TagCount[]>
  askChapterStream(
    chapterId: string,
    question: string,
    history: ChatTurn[],
    mode: ChatMode,
    onDelta: (text: string) => void,
  ): Promise<ChatAnswer>
  evaluateExplanation(chapterId: string, explanation: string): Promise<FeynmanResult>
  generateSessionSummary(input: SessionSummaryInput): Promise<SessionSummary>
  cancelSessionSummary(): Promise<void>
  evaluateExplanationStream(
    chapterId: string,
    explanation: string,
    onDelta: (text: string) => void,
  ): Promise<FeynmanResult>
  getKnowledgeMap(): Promise<KnowledgeMapData>
  runLab(request: LabRequest): Promise<LabReport>
  labChatStream(
    request: LabRequest,
    history: ChatTurn[],
    onDelta: (text: string) => void,
  ): Promise<LabChatAnswer>
  marginNote(chapterId: string, quote: string): Promise<LabReport>
  generateQuiz(chapterId: string): Promise<LabQuiz>
  checkQuizAnswer(chapterId: string, question: string, answer: string): Promise<LabAnswerCheck>
  suggestConceptMerges(): Promise<LabMergeGroup[]>
  mergeNoteTags(tags: string[], canonical: string): Promise<number>
  findDuplicateNotes(): Promise<LabDuplicatePair[]>
  mergeNotes(keepId: string, mergeId: string): Promise<Note>
  saveImage(dataUrl: string, defaultName: string): Promise<SaveFileResult>
  saveImages(images: Array<{ dataUrl: string; name: string }>, defaultDirName: string): Promise<SaveImagesResult>
  saveAudio(base64: string, defaultName: string): Promise<SaveFileResult>
  getReadingPosition(chapterId: string): Promise<ReadingPositionRecord | null>
  saveReadingPosition(input: ReadingPositionInput): Promise<void>
  saveReadingPage(chapterId: string, bookId: string, page: number): Promise<void>
  getReadingStats(): Promise<ReadingStatsData>
  mergeReadingStats(data: ReadingStatsData): Promise<ReadingStatsData>
  recordReading(day: string, seconds: number, bookId?: string | null): Promise<void>
  getUiPreferences(): Promise<UiPreferences>
  saveUiPreferences(patch: { autoNext?: boolean; dailyGoal?: number }): Promise<UiPreferences>
  saveWeeklyReview(input: { week: string; title: string; content: string }): Promise<WeeklyReviewRecord>
  listWeeklyReviews(): Promise<WeeklyReviewRecord[]>
  listBookmarks(bookId: string): Promise<ReadingBookmark[]>
  createBookmark(input: ReadingBookmarkDraft): Promise<ReadingBookmark>
  deleteBookmark(id: string): Promise<void>
  restoreNote(noteId: string): Promise<Note | null>
  listTrashedNotes(): Promise<TrashedNote[]>
  purgeTrashedNote(noteId: string): Promise<void>
  emptyNoteTrash(): Promise<number>
  auditXhsCoverage(input: XhsCoverageRequest): Promise<XhsCoverageAudit>
  cancelLab(): Promise<void>
  analyzePdfPage(bookId: string, page: number): Promise<LabReport>
  generateRelationGraph(bookId: string): Promise<RelationGraph>
  getLabArtifact(tool: string, scope?: string): Promise<LabArtifact | null>
  listLabArtifacts(tool: string, limit?: number): Promise<LabArtifact[]>
  saveLabArtifact(input: {
    tool: string
    scope: string
    title: string
    content: string
    meta?: string | null
    kind?: ContentKind
    bookId?: string | null
    chapterId?: string | null
  }): Promise<LabArtifact>
  updateLabArtifact(
    id: string,
    patch: { title?: string; content?: string; meta?: string | null },
  ): Promise<LabArtifact>
  listContent(filter?: ContentFilter): Promise<ContentItem[]>
  listContentPage(filter?: ContentFilter): Promise<PageResult<ContentItem>>
  getContent(id: string): Promise<ContentItem | null>
  getContentVersions(tool: string, scope: string): Promise<ContentItem[]>
  setContentFavorite(id: string, favorite: boolean): Promise<ContentItem>
  setContentStatus(id: string, status: ContentStatus): Promise<ContentItem>
  deleteContent(id: string): Promise<void>
  purgeContent(id: string): Promise<void>
  purgeDeletedContent(): Promise<number>
  applyContent(id: string, action: ContentApplyAction): Promise<ContentApplyResult>
  undoContentApply(token: string): Promise<ContentApplyResult>
  createNote(draft: NoteDraft): Promise<Note>
  updateNote(id: string, patch: NotePatch): Promise<Note>
  deleteNote(id: string): Promise<void>
  generateNotes(chapterId: string, options?: GenerateNotesOptions): Promise<void>
  generateBookNotes(bookId: string, options?: BookGenerationOptions): Promise<void>
  cancelGeneration(target?: AiJobCancelTarget): Promise<void>
  composeBook(bookId: string, options: BookComposeOptions): Promise<BookComposeResult>
  cancelBookCompose(target?: AiJobCancelTarget): Promise<void>
  rewriteComposeSection(input: ComposeSectionRewriteInput): Promise<ComposeSectionRewriteResult>
  cancelComposeSectionRewrite(): Promise<void>
  compareChapterNotes(input: CompareNotesInput): Promise<CompareNotesResult>
  compareBookCompose(input: CompareComposeInput): Promise<CompareComposeResult>
  saveHtml(defaultName: string, content: string): Promise<SaveFileResult>
  savePdf(defaultName: string, html: string): Promise<SaveFileResult>
  saveBinary(defaultName: string, base64: string): Promise<SaveFileResult>
  copyImage(dataUrl: string): Promise<void>
  notifyDesktop(title: string, body: string): Promise<void>
  expandNote(noteId: string): Promise<Note>
  compareChapterNotes(input: CompareNotesInput): Promise<CompareNotesResult>
  compareBookCompose(input: CompareComposeInput): Promise<CompareComposeResult>
  getSettings(): Promise<SettingsView>
  saveSettings(patch: SettingsPatch): Promise<SettingsView>
  setAppLock(passcode: string | null): Promise<boolean>
  verifyAppLock(passcode: string): Promise<boolean>
  testConnection(): Promise<TestResult>
  getAppInfo(): Promise<AppInfo>
  getAiUsage(days?: number): Promise<AiUsageSummary>
  listPdfAnnotations(bookId: string, page: number): Promise<PdfAnnotation[]>
  listPdfAnnotationsForBook(bookId: string): Promise<PdfAnnotation[]>
  savePdfAnnotation(input: {
    bookId: string
    page: number
    x: number
    y: number
    width: number
    height: number
    note?: string
    color?: PdfAnnotationColor
  }): Promise<PdfAnnotation>
  updatePdfAnnotation(id: string, patch: { note?: string; color?: PdfAnnotationColor }): Promise<PdfAnnotation>
  deletePdfAnnotation(id: string): Promise<void>
  getNoteQuality(): Promise<NoteQualitySummary>
  getSyncStatus(): Promise<SyncStatus>
  getWebDavConfig(): Promise<WebDavConfigView>
  saveWebDavConfig(input: WebDavConfigInput): Promise<WebDavConfigView>
  testWebDav(): Promise<{ ok: boolean; message: string }>
  pushWebDavSnapshot(passphrase?: string): Promise<SyncSnapshot>
  pushWebDavNotesSnapshot(passphrase?: string): Promise<SyncSnapshot>
  listWebDavSnapshots(): Promise<SyncSnapshot[]>
  pullWebDavSnapshot(name: string, passphrase?: string): Promise<{ ok: boolean }>
  mergeWebDavSnapshot(name: string, passphrase?: string): Promise<MergeSnapshotResult>
  deleteWebDavSnapshot(name: string): Promise<void>
  chooseSyncFolder(): Promise<SyncStatus>
  pushSyncSnapshot(passphrase?: string): Promise<SyncSnapshot>
  pullSyncSnapshot(name: string, passphrase?: string): Promise<{ ok: boolean }>
  mergeSyncSnapshot(name: string, passphrase?: string): Promise<MergeSnapshotResult>
  deleteSyncSnapshot(name: string): Promise<SyncStatus>
  openSyncFolder(): Promise<void>
  openDataDir(): Promise<void>
  createBackup(): Promise<BackupInfo>
  listBackups(): Promise<BackupInfo[]>
  restoreBackup(id: string): Promise<void>
  deleteBackup(id: string): Promise<void>
  openBackupsDir(): Promise<void>
  exportBackup(id: string): Promise<SaveFileResult>
  exportLibrary(): Promise<SaveFileResult>
  importLibrary(): Promise<SaveFileResult>
  exportDiagnostics(): Promise<SaveFileResult>
  logRendererError(report: RendererErrorReport): Promise<void>
  copyText(text: string): Promise<void>
  saveTextFile(defaultName: string, content: string, extension: 'bib' | 'ris' | 'txt'): Promise<SaveFileResult>
  optimizeShareCopy(input: ShareCopyInput): Promise<ShareCopyResult>
  saveMarkdown(defaultName: string, content: string): Promise<SaveFileResult>
  readBookFile(bookId: string): Promise<Uint8Array>
  getTtsStatus(): Promise<TtsStatus>
  synthesizeTts(request: TtsSynthesisRequest): Promise<TtsAudio>
  detectLocalModels(): Promise<LocalModelDetection>
  search(query: string): Promise<SearchResult[]>
  searchSemantic(query: string): Promise<SearchResult[]>
  onGenerationPartial(cb: (event: GenerationPartialEvent) => void): () => void
  onGenerationDone(cb: (event: GenerationDoneEvent) => void): () => void
  onGenerationError(cb: (event: GenerationErrorEvent) => void): () => void
  onBookGenerationProgress(cb: (event: BookGenerationProgress) => void): () => void
  onBookGenerationDone(cb: (event: BookGenerationDoneEvent) => void): () => void
  onOcrProgress(cb: (event: OcrProgress) => void): () => void
  onOcrDone(cb: (event: OcrDoneEvent) => void): () => void
  onOcrError(cb: (event: OcrErrorEvent) => void): () => void
  onBookFormatProgress(cb: (event: BookFormatProgress) => void): () => void
  onBookFormatDone(cb: (event: BookFormatDoneEvent) => void): () => void
  onChapterFormatted(cb: (event: FormatResult) => void): () => void
  onChapterTranslationProgress(cb: (event: ChapterTranslationProgress) => void): () => void
  onChapterTranslated(cb: (event: ChapterTranslatedEvent) => void): () => void
  onChapterTranslationError(cb: (event: ChapterTranslationErrorEvent) => void): () => void
  onBookTranslationProgress(cb: (event: BookTranslationProgress) => void): () => void
  onBookTranslationDone(cb: (event: BookTranslationDoneEvent) => void): () => void
  onBookComposeProgress(cb: (event: BookComposeProgress) => void): () => void
  onSemanticReady(cb: () => void): () => void
  onAppNotice(cb: (notice: AppNotice) => void): () => void
}
