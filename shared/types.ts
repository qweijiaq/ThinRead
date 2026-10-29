export type BookFormat = 'epub' | 'pdf'

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
  chapterCount: number
  hiddenChapterCount: number
  noteCount: number
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

export interface LibraryNote extends Note {
  bookTitle: string
  chapterTitle: string | null
  /** 下次复习时间；从未复习过为 null。 */
  dueAt: string | null
  reviewReps: number
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

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

export interface ReviewStats {
  due: number
  total: number
  newCount: number
  reviewedToday: number
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
}

export interface SettingsPatch {
  provider: ProviderId
  baseUrl: string
  model: string
  apiKey?: string
}

export interface TestResult {
  ok: boolean
  message: string
}

export interface SaveFileResult {
  saved: boolean
  path: string | null
}

export type SearchResultType = 'book' | 'chapter' | 'note'

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

export interface AppInfo {
  version: string
  dataDir: string
  demo: boolean
}

export interface ReadingApi {
  listBooks(): Promise<BookSummary[]>
  importBook(): Promise<BookSummary | null>
  openBook(bookId: string): Promise<{ book: BookSummary; chapters: ChapterMeta[]; style: ReaderStyle }>
  reparseBook(bookId: string): Promise<BookSummary>
  deleteBook(bookId: string): Promise<void>
  formatChapter(chapterId: string, instruction?: string): Promise<FormatResult>
  resetChapterFormat(chapterId: string): Promise<void>
  saveStyle(bookId: string, style: ReaderStyle): Promise<ReaderStyle>
  getChapter(chapterId: string): Promise<ChapterContent>
  setProgress(bookId: string, chapterId: string): Promise<void>
  classifyChapters(bookId: string): Promise<ClassifyResult>
  applyChapterFlags(flags: ChapterFlag[]): Promise<void>
  deleteChapters(chapterIds: string[]): Promise<void>
  listNotes(bookId: string, chapterId?: string | null): Promise<Note[]>
  listRelatedNotes(bookId: string, tags: string[], queryText?: string): Promise<RelatedNote[]>
  listLibraryNotes(filter?: LibraryFilter): Promise<LibraryNote[]>
  listLibraryTags(bookId?: string | null): Promise<TagCount[]>
  getReviewStats(): Promise<ReviewStats>
  getReviewQueue(limit?: number): Promise<LibraryNote[]>
  reviewNote(noteId: string, rating: ReviewRating): Promise<void>
  createNote(draft: NoteDraft): Promise<Note>
  updateNote(id: string, patch: NotePatch): Promise<Note>
  deleteNote(id: string): Promise<void>
  generateNotes(chapterId: string): Promise<void>
  cancelGeneration(): Promise<void>
  expandNote(noteId: string): Promise<Note>
  getSettings(): Promise<SettingsView>
  saveSettings(patch: SettingsPatch): Promise<SettingsView>
  testConnection(): Promise<TestResult>
  getAppInfo(): Promise<AppInfo>
  openDataDir(): Promise<void>
  copyText(text: string): Promise<void>
  saveMarkdown(defaultName: string, content: string): Promise<SaveFileResult>
  search(query: string): Promise<SearchResult[]>
  onGenerationPartial(cb: (event: GenerationPartialEvent) => void): () => void
  onGenerationDone(cb: (event: GenerationDoneEvent) => void): () => void
  onGenerationError(cb: (event: GenerationErrorEvent) => void): () => void
  onSemanticReady(cb: () => void): () => void
}
