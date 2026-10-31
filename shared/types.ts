export type BookFormat = 'epub' | 'pdf' | 'pdf-ocr' | 'mobi' | 'url' | 'text'

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

export type NoteKind = 'condensed' | 'summary' | 'claim' | 'point' | 'question' | 'thought' | 'highlight'

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
}

export interface ReaderStyle {
  fontFamily: 'serif' | 'sans'
  fontSize: number
  lineHeight: number
  paragraphSpacing: number
  indent: boolean
  theme: 'paper' | 'plain' | 'warm' | 'folio'
}

export const DEFAULT_READER_STYLE: ReaderStyle = {
  fontFamily: 'serif',
  fontSize: 17,
  lineHeight: 1.98,
  paragraphSpacing: 1.15,
  indent: false,
  theme: 'folio',
}

export interface RemovedPart {
  reason: string
  text: string
  verified: boolean
}

export interface FormatResult {
  chapterId: string
  html: string
  removed: RemovedPart[]
  style: ReaderStyle
  note: string
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
  section: string | null
  importance: number | null
  /** 这张卡片在全文中的作用：支撑什么结论。 */
  role: string | null
  /** AI 延伸，最多 3 条，类型为边界/跨书/触类。 */
  divergences: NoteDivergence[]
  createdAt: string
  updatedAt: string
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
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
  model: string
  createdAt: string
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

export interface LibraryFilter {
  bookId?: string | null
  tag?: string | null
  kind?: NoteKind | null
  query?: string
  limit?: number
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
}

export type ContentApplyAction = 'note' | 'source' | 'current'

export interface ContentApplyResult {
  appliedTo: 'note' | 'chapter' | 'current' | 'none'
  noteId?: string
  chapterId?: string
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
  | 'ollama'

export interface ProviderPreset {
  id: ProviderId
  label: string
  baseUrl: string
  defaultModel: string
  keyUrl: string
  hint: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'demo',
    label: '演示模式（无需 API Key）',
    baseUrl: '',
    defaultModel: 'demo',
    keyUrl: '',
    hint: '用固定样例演示完整流程，生成的引用不可校验。',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-flash',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    hint: '中文长文本性价比高，适合逐章生成。',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.3',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    hint: 'OpenAI 兼容端点，中文书籍表现稳定。',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    baseUrl: '',
    defaultModel: 'claude-sonnet-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    hint: '留空 Base URL 使用官方端点。',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.6-sol',
    keyUrl: 'https://platform.openai.com/api-keys',
    hint: '也可以填任何 OpenAI 兼容网关的地址。',
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k3',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    hint: '国际版可改为 https://api.moonshot.ai/v1。',
  },
  {
    id: 'alibaba',
    label: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.8-max',
    keyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    hint: 'OpenAI 兼容模式。',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-5',
    keyUrl: 'https://openrouter.ai/keys',
    hint: '一个 Key 访问多家模型。',
  },
  {
    id: 'ollama',
    label: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen3:8b',
    keyUrl: '',
    hint: '本地推理，书和笔记都不出设备。',
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
}

export interface SettingsPatch {
  provider: ProviderId
  baseUrl: string
  model: string
  apiKey?: string
  generationMode?: GenerationMode
}

export interface TestResult {
  ok: boolean
  message: string
}

export interface TextImportInput {
  title?: string
  author?: string
  text: string
}

export interface OcrProgress {
  current: number
  total: number
  page: number
}

export interface OcrImportStarted {
  started: boolean
  fileName: string
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

export interface SaveFileResult {
  saved: boolean
  path: string | null
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

export interface BookFormatOptions {
  /** 只处理还没有 AI 排版结果的章节；默认 false。 */
  onlyMissing?: boolean
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
}

export interface ReadingApi {
  listBooks(): Promise<BookSummary[]>
  importBook(): Promise<BookSummary | null>
  importText(input: TextImportInput): Promise<BookSummary>
  importUrl(url: string): Promise<BookSummary>
  importScannedPdf(): Promise<OcrImportStarted | null>
  cancelOcrImport(): Promise<void>
  importHighlights(): Promise<HighlightImportResult | null>
  openBook(bookId: string): Promise<{ book: BookSummary; chapters: ChapterMeta[]; style: ReaderStyle }>
  renameBook(bookId: string, title: string): Promise<BookSummary>
  setBookGenre(bookId: string, genre: BookGenre): Promise<BookSummary>
  renameChapter(chapterId: string, title: string): Promise<void>
  renamePart(bookId: string, partIndex: number, title: string): Promise<void>
  reparseBook(bookId: string): Promise<BookSummary>
  mergeBooks(bookIds: string[], title: string, author: string): Promise<BookSummary>
  splitBook(bookId: string, fromChapterId: string, title: string): Promise<BookSummary>
  deleteBook(bookId: string): Promise<void>
  formatChapter(chapterId: string, instruction?: string): Promise<FormatResult>
  formatBook(bookId: string, options?: BookFormatOptions): Promise<void>
  cancelFormat(): Promise<void>
  resetChapterFormat(chapterId: string): Promise<void>
  saveStyle(bookId: string, style: ReaderStyle): Promise<ReaderStyle>
  getChapter(chapterId: string): Promise<ChapterContent>
  setProgress(bookId: string, chapterId: string): Promise<void>
  listChapterMarks(chapterId: string): Promise<ReaderMark[]>
  createChapterMark(input: { chapterId: string; quote: string; style: ReaderMarkStyle }): Promise<ReaderMark>
  deleteChapterMark(id: string): Promise<void>
  classifyChapters(bookId: string): Promise<ClassifyResult>
  applyChapterFlags(flags: ChapterFlag[]): Promise<void>
  deleteChapters(chapterIds: string[]): Promise<void>
  listNotes(bookId: string, chapterId?: string | null): Promise<Note[]>
  listRelatedNotes(bookId: string, tags: string[], queryText?: string): Promise<RelatedNote[]>
  listLibraryNotes(filter?: LibraryFilter): Promise<LibraryNote[]>
  listLibraryTags(bookId?: string | null): Promise<TagCount[]>
  askChapter(chapterId: string, question: string, history: ChatTurn[], mode: ChatMode): Promise<ChatAnswer>
  evaluateExplanation(chapterId: string, explanation: string): Promise<FeynmanResult>
  getKnowledgeMap(): Promise<KnowledgeMapData>
  runLab(request: LabRequest): Promise<LabReport>
  labChat(request: LabRequest, history: ChatTurn[]): Promise<LabChatAnswer>
  marginNote(chapterId: string, quote: string): Promise<LabReport>
  generateQuiz(chapterId: string): Promise<LabQuiz>
  checkQuizAnswer(chapterId: string, question: string, answer: string): Promise<LabAnswerCheck>
  suggestConceptMerges(): Promise<LabMergeGroup[]>
  mergeNoteTags(tags: string[], canonical: string): Promise<number>
  findDuplicateNotes(): Promise<LabDuplicatePair[]>
  mergeNotes(keepId: string, mergeId: string): Promise<Note>
  saveImage(dataUrl: string, defaultName: string): Promise<SaveFileResult>
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
  getContent(id: string): Promise<ContentItem | null>
  setContentFavorite(id: string, favorite: boolean): Promise<ContentItem>
  setContentStatus(id: string, status: ContentStatus): Promise<ContentItem>
  deleteContent(id: string): Promise<void>
  applyContent(id: string, action: ContentApplyAction): Promise<ContentApplyResult>
  createNote(draft: NoteDraft): Promise<Note>
  updateNote(id: string, patch: NotePatch): Promise<Note>
  deleteNote(id: string): Promise<void>
  generateNotes(chapterId: string): Promise<void>
  generateBookNotes(bookId: string, options?: BookGenerationOptions): Promise<void>
  cancelGeneration(): Promise<void>
  composeBook(bookId: string, options: BookComposeOptions): Promise<BookComposeResult>
  cancelBookCompose(): Promise<void>
  saveHtml(defaultName: string, content: string): Promise<SaveFileResult>
  saveBinary(defaultName: string, base64: string): Promise<SaveFileResult>
  copyImage(dataUrl: string): Promise<void>
  expandNote(noteId: string): Promise<Note>
  getSettings(): Promise<SettingsView>
  saveSettings(patch: SettingsPatch): Promise<SettingsView>
  testConnection(): Promise<TestResult>
  getAppInfo(): Promise<AppInfo>
  openDataDir(): Promise<void>
  createBackup(): Promise<BackupInfo>
  listBackups(): Promise<BackupInfo[]>
  restoreBackup(id: string): Promise<void>
  deleteBackup(id: string): Promise<void>
  openBackupsDir(): Promise<void>
  exportBackup(id: string): Promise<SaveFileResult>
  copyText(text: string): Promise<void>
  saveMarkdown(defaultName: string, content: string): Promise<SaveFileResult>
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
  onBookComposeProgress(cb: (event: BookComposeProgress) => void): () => void
  onSemanticReady(cb: () => void): () => void
}
