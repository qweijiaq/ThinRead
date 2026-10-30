import { contextBridge, ipcRenderer } from 'electron'

import type {
  BookComposeOptions,
  BookComposeProgress,
  BookComposeResult,
  BookGenerationDoneEvent,
  BookGenerationOptions,
  BookGenerationProgress,
  BookSummary,
  ChapterContent,
  ChapterFlag,
  ChapterMeta,
  ChatAnswer,
  ChatMode,
  ChatTurn,
  ClassifyResult,
  ContentApplyAction,
  ContentApplyResult,
  ContentFilter,
  ContentItem,
  ContentStatus,
  FormatResult,
  FeynmanResult,
  GenerationDoneEvent,
  GenerationErrorEvent,
  GenerationPartialEvent,
  KnowledgeMapData,
  LabAnswerCheck,
  LabArtifact,
  LabChatAnswer,
  LabDuplicatePair,
  LabExperiment,
  LabMergeGroup,
  LabQuiz,
  LabReport,
  LabRequest,
  LibraryFilter,
  LibraryNote,
  Note,
  NoteDraft,
  NotePatch,
  ReaderStyle,
  RelatedNote,
  ReadingApi,
  ReviewRating,
  ReviewStats,
  SaveFileResult,
  SearchResult,
  SettingsPatch,
  SettingsView,
  TagCount,
  TestResult,
} from '../shared/types.js'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: ReadingApi = {
  listBooks: () => ipcRenderer.invoke('books:list') as Promise<BookSummary[]>,
  importBook: () => ipcRenderer.invoke('books:import') as Promise<BookSummary | null>,
  openBook: (bookId) =>
    ipcRenderer.invoke('books:open', bookId) as Promise<{
      book: BookSummary
      chapters: ChapterMeta[]
      style: ReaderStyle
    }>,
  renameBook: (bookId: string, title: string) =>
    ipcRenderer.invoke('books:rename', bookId, title) as Promise<BookSummary>,
  renameChapter: (chapterId: string, title: string) =>
    ipcRenderer.invoke('chapters:rename', chapterId, title) as Promise<void>,
  renamePart: (bookId: string, partIndex: number, title: string) =>
    ipcRenderer.invoke('parts:rename', bookId, partIndex, title) as Promise<void>,
  reparseBook: (bookId) => ipcRenderer.invoke('books:reparse', bookId) as Promise<BookSummary>,
  deleteBook: (bookId) => ipcRenderer.invoke('books:delete', bookId) as Promise<void>,
  formatChapter: (chapterId, instruction) =>
    ipcRenderer.invoke('chapters:format', chapterId, instruction) as Promise<FormatResult>,
  resetChapterFormat: (chapterId) => ipcRenderer.invoke('chapters:resetFormat', chapterId) as Promise<void>,
  saveStyle: (bookId, style) => ipcRenderer.invoke('books:saveStyle', bookId, style) as Promise<ReaderStyle>,
  getChapter: (chapterId) => ipcRenderer.invoke('chapters:get', chapterId) as Promise<ChapterContent>,
  setProgress: (bookId, chapterId) => ipcRenderer.invoke('books:progress', bookId, chapterId) as Promise<void>,
  classifyChapters: (bookId) => ipcRenderer.invoke('chapters:classify', bookId) as Promise<ClassifyResult>,
  applyChapterFlags: (flags: ChapterFlag[]) => ipcRenderer.invoke('chapters:flags', flags) as Promise<void>,
  deleteChapters: (chapterIds) => ipcRenderer.invoke('chapters:delete', chapterIds) as Promise<void>,
  listNotes: (bookId, chapterId) => ipcRenderer.invoke('notes:list', bookId, chapterId) as Promise<Note[]>,
  listRelatedNotes: (bookId, tags, queryText) =>
    ipcRenderer.invoke('notes:related', bookId, tags, queryText) as Promise<RelatedNote[]>,
  createNote: (draft: NoteDraft) => ipcRenderer.invoke('notes:create', draft) as Promise<Note>,
  updateNote: (id, patch: NotePatch) => ipcRenderer.invoke('notes:update', id, patch) as Promise<Note>,
  deleteNote: (id) => ipcRenderer.invoke('notes:delete', id) as Promise<void>,
  generateNotes: (chapterId) => ipcRenderer.invoke('notes:generate', chapterId) as Promise<void>,
  generateBookNotes: (bookId: string, options?: BookGenerationOptions) =>
    ipcRenderer.invoke('notes:generate-book', bookId, options) as Promise<void>,
  cancelGeneration: () => ipcRenderer.invoke('notes:cancel') as Promise<void>,
  composeBook: (bookId: string, options: BookComposeOptions) =>
    ipcRenderer.invoke('book:compose', bookId, options) as Promise<BookComposeResult>,
  cancelBookCompose: () => ipcRenderer.invoke('book:compose-cancel') as Promise<void>,
  expandNote: (noteId) => ipcRenderer.invoke('notes:expand', noteId) as Promise<Note>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<SettingsView>,
  saveSettings: (patch: SettingsPatch) => ipcRenderer.invoke('settings:save', patch) as Promise<SettingsView>,
  testConnection: () => ipcRenderer.invoke('settings:test') as Promise<TestResult>,
  getAppInfo: () => ipcRenderer.invoke('app:info') as Promise<{ version: string; dataDir: string; demo: boolean }>,
  openDataDir: () => ipcRenderer.invoke('app:open-data') as Promise<void>,
  copyText: (text: string) => ipcRenderer.invoke('app:copy-text', text) as Promise<void>,
  saveMarkdown: (defaultName: string, content: string) =>
    ipcRenderer.invoke('app:save-markdown', defaultName, content) as Promise<SaveFileResult>,
  saveHtml: (defaultName: string, content: string) =>
    ipcRenderer.invoke('app:save-html', defaultName, content) as Promise<SaveFileResult>,
  copyImage: (dataUrl: string) => ipcRenderer.invoke('app:copy-image', dataUrl) as Promise<void>,
  search: (query: string) => ipcRenderer.invoke('library:search', query) as Promise<SearchResult[]>,
  listLibraryNotes: (filter?: LibraryFilter) =>
    ipcRenderer.invoke('library:notes', filter) as Promise<LibraryNote[]>,
  listLibraryTags: (bookId) => ipcRenderer.invoke('library:tags', bookId) as Promise<TagCount[]>,
  getReviewStats: () => ipcRenderer.invoke('review:stats') as Promise<ReviewStats>,
  getReviewQueue: (limit) => ipcRenderer.invoke('review:queue', limit) as Promise<LibraryNote[]>,
  reviewNote: (noteId: string, rating: ReviewRating) =>
    ipcRenderer.invoke('review:rate', noteId, rating) as Promise<void>,
  askChapter: (chapterId: string, question: string, history: ChatTurn[], mode: ChatMode) =>
    ipcRenderer.invoke('tutor:ask', chapterId, question, history, mode) as Promise<ChatAnswer>,
  evaluateExplanation: (chapterId: string, explanation: string) =>
    ipcRenderer.invoke('tutor:evaluate', chapterId, explanation) as Promise<FeynmanResult>,
  getKnowledgeMap: () => ipcRenderer.invoke('map:get') as Promise<KnowledgeMapData>,
  runLab: (request: LabRequest) => ipcRenderer.invoke('lab:run', request) as Promise<LabReport>,
  labChat: (request: LabRequest, history: ChatTurn[]) =>
    ipcRenderer.invoke('lab:chat', request, history) as Promise<LabChatAnswer>,
  marginNote: (chapterId: string, quote: string) =>
    ipcRenderer.invoke('lab:margin-note', chapterId, quote) as Promise<LabReport>,
  generateQuiz: (chapterId: string) => ipcRenderer.invoke('lab:quiz', chapterId) as Promise<LabQuiz>,
  checkQuizAnswer: (chapterId: string, question: string, answer: string) =>
    ipcRenderer.invoke('lab:quiz-check', chapterId, question, answer) as Promise<LabAnswerCheck>,
  suggestConceptMerges: () => ipcRenderer.invoke('lab:concept-merges') as Promise<LabMergeGroup[]>,
  mergeNoteTags: (tags: string[], canonical: string) =>
    ipcRenderer.invoke('lab:merge-tags', tags, canonical) as Promise<number>,
  findDuplicateNotes: () => ipcRenderer.invoke('lab:duplicates') as Promise<LabDuplicatePair[]>,
  mergeNotes: (keepId: string, mergeId: string) =>
    ipcRenderer.invoke('lab:merge-notes', keepId, mergeId) as Promise<Note>,
  listExperiments: () => ipcRenderer.invoke('lab:experiments') as Promise<LabExperiment[]>,
  createExperiment: (goal: string) =>
    ipcRenderer.invoke('lab:experiment-create', goal) as Promise<LabExperiment>,
  updateExperimentStatus: (id: string, status: LabExperiment['status']) =>
    ipcRenderer.invoke('lab:experiment-status', id, status) as Promise<void>,
  saveImage: (dataUrl: string, defaultName: string) =>
    ipcRenderer.invoke('app:save-image', dataUrl, defaultName) as Promise<SaveFileResult>,
  analyzePdfPage: (bookId: string, page: number) =>
    ipcRenderer.invoke('lab:pdf-page', bookId, page) as Promise<LabReport>,
  getLabArtifact: (tool: string, scope?: string) =>
    ipcRenderer.invoke('lab:artifact-get', tool, scope) as Promise<LabArtifact | null>,
  listLabArtifacts: (tool: string, limit?: number) =>
    ipcRenderer.invoke('lab:artifact-list', tool, limit) as Promise<LabArtifact[]>,
  saveLabArtifact: (input) =>
    ipcRenderer.invoke('lab:artifact-save', input) as Promise<LabArtifact>,
  updateLabArtifact: (id: string, patch: { title?: string; content?: string; meta?: string | null }) =>
    ipcRenderer.invoke('lab:artifact-update', id, patch) as Promise<LabArtifact>,
  listContent: (filter?: ContentFilter) => ipcRenderer.invoke('content:list', filter) as Promise<ContentItem[]>,
  getContent: (id: string) => ipcRenderer.invoke('content:get', id) as Promise<ContentItem | null>,
  setContentFavorite: (id: string, favorite: boolean) =>
    ipcRenderer.invoke('content:favorite', id, favorite) as Promise<ContentItem>,
  setContentStatus: (id: string, status: ContentStatus) =>
    ipcRenderer.invoke('content:status', id, status) as Promise<ContentItem>,
  deleteContent: (id: string) => ipcRenderer.invoke('content:delete', id) as Promise<void>,
  applyContent: (id: string, action: ContentApplyAction) =>
    ipcRenderer.invoke('content:apply', id, action) as Promise<ContentApplyResult>,
  onGenerationPartial: (cb) => subscribe<GenerationPartialEvent>('generation:partial', cb),
  onGenerationDone: (cb) => subscribe<GenerationDoneEvent>('generation:done', cb),
  onGenerationError: (cb) => subscribe<GenerationErrorEvent>('generation:error', cb),
  onBookGenerationProgress: (cb) => subscribe<BookGenerationProgress>('book:generation:progress', cb),
  onBookGenerationDone: (cb) => subscribe<BookGenerationDoneEvent>('book:generation:done', cb),
  onBookComposeProgress: (cb) => subscribe<BookComposeProgress>('book:compose:progress', cb),
  onSemanticReady: (cb) => subscribe<void>('semantic:ready', () => cb()),
}

contextBridge.exposeInMainWorld('api', api)
