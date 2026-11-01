import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

import type {
  BackupInfo,
  BookComposeOptions,
  BookComposeProgress,
  BookComposeResult,
  BookGenerationDoneEvent,
  BookGenerationOptions,
  BookGenerationProgress,
  BookGenre,
  BookSummary,
  ChapterContent,
  ChapterFlag,
  ChapterMeta,
  ChatAnswer,
  ChatMode,
  ChatTurn,
  BookFormatDoneEvent,
  BookFormatOptions,
  BookFormatProgress,
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
  HighlightImportOptions,
  HighlightImportResult,
  KnowledgeMapData,
  LabAnswerCheck,
  LabArtifact,
  LabChatAnswer,
  LabDuplicatePair,
  LabMergeGroup,
  LabQuiz,
  LabReport,
  LabRequest,
  RelationGraph,
  LibraryFilter,
  LibraryNote,
  Note,
  NoteDraft,
  NotePatch,
  OcrDoneEvent,
  PageResult,
  OcrErrorEvent,
  OcrImportOptions,
  OcrImportStarted,
  TtsAudio,
  TtsStatus,
  TtsVoice,
  TtsSynthesisRequest,
  OcrJob,
  OcrProgress,
  ReaderMark,
  ReaderMarkStyle,
  ReaderStyle,
  RelatedNote,
  ReadingApi,
  SaveFileResult,
  SaveImagesResult,
  ReadingBookmark,
  ReadingBookmarkDraft,
  ReadingPositionInput,
  ReadingPositionRecord,
  XhsCoverageRequest,
  XhsCoverageAudit,
  SearchResult,
  SettingsPatch,
  SettingsView,
  TagCount,
  TrashedNote,
  TestResult,
  TextImportInput,
} from '../shared/types.js'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

function subscribeStream(channel: string, id: string, onDelta: (text: string) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: { id?: unknown; text?: unknown }): void => {
    if (payload?.id === id && typeof payload.text === 'string') onDelta(payload.text)
  }
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

function streamId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const api: ReadingApi = {
  listBooks: () => ipcRenderer.invoke('books:list') as Promise<BookSummary[]>,
  importBook: () => ipcRenderer.invoke('books:import') as Promise<BookSummary | null>,
  importText: (input: TextImportInput) => ipcRenderer.invoke('books:import-text', input) as Promise<BookSummary>,
  importUrl: (url: string) => ipcRenderer.invoke('books:import-url', url) as Promise<BookSummary>,
  importScannedPdf: (options?: OcrImportOptions) =>
    ipcRenderer.invoke('books:import-ocr', options) as Promise<OcrImportStarted | null>,
  cancelOcrImport: () => ipcRenderer.invoke('books:import-ocr-cancel') as Promise<void>,
  listOcrJobs: () => ipcRenderer.invoke('ocr:jobs') as Promise<OcrJob[]>,
  resumeOcrJob: (id: string) => ipcRenderer.invoke('ocr:resume', id) as Promise<OcrImportStarted | null>,
  syncReadwise: () => ipcRenderer.invoke('readwise:sync') as Promise<HighlightImportResult>,
  testReadwise: (token?: string) => ipcRenderer.invoke('readwise:test', token) as Promise<TestResult>,
  importHighlights: (options?: HighlightImportOptions) =>
    ipcRenderer.invoke('books:import-highlights', options) as Promise<HighlightImportResult | null>,
  importWechatHighlights: (options?: HighlightImportOptions) =>
    ipcRenderer.invoke('books:import-wechat-highlights', options) as Promise<HighlightImportResult | null>,
  openBook: (bookId) =>
    ipcRenderer.invoke('books:open', bookId) as Promise<{
      book: BookSummary
      chapters: ChapterMeta[]
      style: ReaderStyle
    }>,
  renameBook: (bookId: string, title: string) =>
    ipcRenderer.invoke('books:rename', bookId, title) as Promise<BookSummary>,
  setBookGenre: (bookId: string, genre: BookGenre) =>
    ipcRenderer.invoke('books:genre', bookId, genre) as Promise<BookSummary>,
  renameChapter: (chapterId: string, title: string) =>
    ipcRenderer.invoke('chapters:rename', chapterId, title) as Promise<void>,
  renamePart: (bookId: string, partIndex: number, title: string) =>
    ipcRenderer.invoke('parts:rename', bookId, partIndex, title) as Promise<void>,
  reparseBook: (bookId) => ipcRenderer.invoke('books:reparse', bookId) as Promise<BookSummary>,
  mergeBooks: (bookIds: string[], title: string, author: string) =>
    ipcRenderer.invoke('books:merge', bookIds, title, author) as Promise<BookSummary>,
  splitBook: (bookId: string, fromChapterId: string, title: string) =>
    ipcRenderer.invoke('books:split', bookId, fromChapterId, title) as Promise<BookSummary>,
  deleteBook: (bookId) => ipcRenderer.invoke('books:delete', bookId) as Promise<void>,
  formatChapter: (chapterId, instruction) =>
    ipcRenderer.invoke('chapters:format', chapterId, instruction) as Promise<FormatResult>,
  formatBook: (bookId: string, options?: BookFormatOptions) =>
    ipcRenderer.invoke('chapters:format-book', bookId, options) as Promise<void>,
  cancelFormat: () => ipcRenderer.invoke('chapters:format-cancel') as Promise<void>,
  resetChapterFormat: (chapterId) => ipcRenderer.invoke('chapters:resetFormat', chapterId) as Promise<void>,
  saveStyle: (bookId, style) => ipcRenderer.invoke('books:saveStyle', bookId, style) as Promise<ReaderStyle>,
  getChapter: (chapterId) => ipcRenderer.invoke('chapters:get', chapterId) as Promise<ChapterContent>,
  setProgress: (bookId, chapterId) => ipcRenderer.invoke('books:progress', bookId, chapterId) as Promise<void>,
  getBookCover: (bookId: string) => ipcRenderer.invoke('books:cover', bookId) as Promise<string | null>,
  listChapterMarks: (chapterId: string) => ipcRenderer.invoke('marks:list', chapterId) as Promise<ReaderMark[]>,
  createChapterMark: (input: { chapterId: string; quote: string; style: ReaderMarkStyle }) =>
    ipcRenderer.invoke('marks:create', input) as Promise<ReaderMark>,
  deleteChapterMark: (id: string) => ipcRenderer.invoke('marks:delete', id) as Promise<void>,
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
  createBackup: () => ipcRenderer.invoke('backup:create') as Promise<BackupInfo>,
  listBackups: () => ipcRenderer.invoke('backup:list') as Promise<BackupInfo[]>,
  restoreBackup: (id: string) => ipcRenderer.invoke('backup:restore', id) as Promise<void>,
  deleteBackup: (id: string) => ipcRenderer.invoke('backup:delete', id) as Promise<void>,
  openBackupsDir: () => ipcRenderer.invoke('backup:open-dir') as Promise<void>,
  exportBackup: (id: string) => ipcRenderer.invoke('backup:export', id) as Promise<SaveFileResult>,
  copyText: (text: string) => ipcRenderer.invoke('app:copy-text', text) as Promise<void>,
  saveMarkdown: (defaultName: string, content: string) =>
    ipcRenderer.invoke('app:save-markdown', defaultName, content) as Promise<SaveFileResult>,
  saveHtml: (defaultName: string, content: string) =>
    ipcRenderer.invoke('app:save-html', defaultName, content) as Promise<SaveFileResult>,
  savePdf: (defaultName: string, html: string) =>
    ipcRenderer.invoke('app:save-pdf', defaultName, html) as Promise<SaveFileResult>,
  saveBinary: (defaultName: string, base64: string) =>
    ipcRenderer.invoke('app:save-binary', defaultName, base64) as Promise<SaveFileResult>,
  copyImage: (dataUrl: string) => ipcRenderer.invoke('app:copy-image', dataUrl) as Promise<void>,
  readBookFile: (bookId: string) =>
    ipcRenderer.invoke('books:file', bookId).then((bytes: Uint8Array) => new Uint8Array(bytes)),
  getTtsStatus: () => ipcRenderer.invoke('tts:status') as Promise<TtsStatus>,
  synthesizeTts: (request: TtsSynthesisRequest) =>
    ipcRenderer.invoke('tts:synthesize', request) as Promise<TtsAudio>,
  getBeatraVoices: () => ipcRenderer.invoke('tts:beatra-voices') as Promise<TtsVoice[]>,
  testBeatra: (token?: string) => ipcRenderer.invoke('tts:test-beatra', token) as Promise<TestResult>,
  importBeatraCredential: () =>
    ipcRenderer.invoke('tts:import-beatra-credential') as Promise<TestResult>,
  openKokoroDir: () => ipcRenderer.invoke('tts:open-kokoro-dir') as Promise<void>,
  search: (query: string) => ipcRenderer.invoke('library:search', query) as Promise<SearchResult[]>,
  searchSemantic: (query: string) => ipcRenderer.invoke('library:search-semantic', query) as Promise<SearchResult[]>,
  listLibraryNotes: (filter?: LibraryFilter) =>
    ipcRenderer.invoke('library:notes', filter) as Promise<LibraryNote[]>,
  listLibraryNotesPage: (filter?: LibraryFilter) =>
    ipcRenderer.invoke('library:notes-page', filter) as Promise<PageResult<LibraryNote>>,
  listLibraryTags: (bookId) => ipcRenderer.invoke('library:tags', bookId) as Promise<TagCount[]>,
  askChapter: (chapterId: string, question: string, history: ChatTurn[], mode: ChatMode) =>
    ipcRenderer.invoke('tutor:ask', chapterId, question, history, mode) as Promise<ChatAnswer>,
  askChapterStream: (chapterId, question, history, mode, onDelta) => {
    const id = streamId()
    const unsubscribe = subscribeStream('tutor:ask-delta', id, onDelta)
    return ipcRenderer
      .invoke('tutor:ask-stream', chapterId, question, history, mode, id)
      .finally(unsubscribe) as Promise<ChatAnswer>
  },
  evaluateExplanation: (chapterId: string, explanation: string) =>
    ipcRenderer.invoke('tutor:evaluate', chapterId, explanation) as Promise<FeynmanResult>,
  evaluateExplanationStream: (chapterId, explanation, onDelta) => {
    const id = streamId()
    const unsubscribe = subscribeStream('tutor:feynman-delta', id, onDelta)
    return ipcRenderer
      .invoke('tutor:evaluate-stream', chapterId, explanation, id)
      .finally(unsubscribe) as Promise<FeynmanResult>
  },
  getKnowledgeMap: () => ipcRenderer.invoke('map:get') as Promise<KnowledgeMapData>,
  runLab: (request: LabRequest) => ipcRenderer.invoke('lab:run', request) as Promise<LabReport>,
  labChat: (request: LabRequest, history: ChatTurn[]) =>
    ipcRenderer.invoke('lab:chat', request, history) as Promise<LabChatAnswer>,
  labChatStream: (request, history, onDelta) => {
    const id = streamId()
    const unsubscribe = subscribeStream('lab:chat-delta', id, onDelta)
    return ipcRenderer
      .invoke('lab:chat-stream', request, history, id)
      .finally(unsubscribe) as Promise<LabChatAnswer>
  },
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
  saveImage: (dataUrl: string, defaultName: string) =>
    ipcRenderer.invoke('app:save-image', dataUrl, defaultName) as Promise<SaveFileResult>,
  saveImages: (images: Array<{ dataUrl: string; name: string }>, defaultDirName: string) =>
    ipcRenderer.invoke('app:save-images', images, defaultDirName) as Promise<SaveImagesResult>,
  saveAudio: (base64: string, defaultName: string) =>
    ipcRenderer.invoke('app:save-audio', base64, defaultName) as Promise<SaveFileResult>,
  getReadingPosition: (chapterId: string) =>
    ipcRenderer.invoke('reading:position-get', chapterId) as Promise<ReadingPositionRecord | null>,
  saveReadingPosition: (input: ReadingPositionInput) =>
    ipcRenderer.invoke('reading:position-save', input) as Promise<void>,
  saveReadingPage: (chapterId: string, bookId: string, page: number) =>
    ipcRenderer.invoke('reading:page-save', chapterId, bookId, page) as Promise<void>,
  listBookmarks: (bookId: string) =>
    ipcRenderer.invoke('bookmarks:list', bookId) as Promise<ReadingBookmark[]>,
  createBookmark: (input: ReadingBookmarkDraft) =>
    ipcRenderer.invoke('bookmarks:create', input) as Promise<ReadingBookmark>,
  deleteBookmark: (id: string) =>
    ipcRenderer.invoke('bookmarks:delete', id) as Promise<void>,
  restoreNote: (noteId: string) =>
    ipcRenderer.invoke('notes:restore', noteId) as Promise<Note | null>,
  listTrashedNotes: () => ipcRenderer.invoke('notes:trash-list') as Promise<TrashedNote[]>,
  purgeTrashedNote: (noteId: string) => ipcRenderer.invoke('notes:trash-purge', noteId) as Promise<void>,
  emptyNoteTrash: () => ipcRenderer.invoke('notes:trash-empty') as Promise<number>,
  auditXhsCoverage: (input: XhsCoverageRequest) =>
    ipcRenderer.invoke('xhs:coverage', input) as Promise<XhsCoverageAudit>,
  cancelLab: () => ipcRenderer.invoke('lab:cancel') as Promise<void>,
  analyzePdfPage: (bookId: string, page: number) =>
    ipcRenderer.invoke('lab:pdf-page', bookId, page) as Promise<LabReport>,
  generateRelationGraph: (bookId: string) =>
    ipcRenderer.invoke('lab:relation-graph', bookId) as Promise<RelationGraph>,
  getLabArtifact: (tool: string, scope?: string) =>
    ipcRenderer.invoke('lab:artifact-get', tool, scope) as Promise<LabArtifact | null>,
  listLabArtifacts: (tool: string, limit?: number) =>
    ipcRenderer.invoke('lab:artifact-list', tool, limit) as Promise<LabArtifact[]>,
  saveLabArtifact: (input) =>
    ipcRenderer.invoke('lab:artifact-save', input) as Promise<LabArtifact>,
  updateLabArtifact: (id: string, patch: { title?: string; content?: string; meta?: string | null }) =>
    ipcRenderer.invoke('lab:artifact-update', id, patch) as Promise<LabArtifact>,
  listContent: (filter?: ContentFilter) => ipcRenderer.invoke('content:list', filter) as Promise<ContentItem[]>,
  listContentPage: (filter?: ContentFilter) =>
    ipcRenderer.invoke('content:list-page', filter) as Promise<PageResult<ContentItem>>,
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
  onOcrProgress: (cb) => subscribe<OcrProgress>('ocr:progress', cb),
  onOcrDone: (cb) => subscribe<OcrDoneEvent>('ocr:done', cb),
  onOcrError: (cb) => subscribe<OcrErrorEvent>('ocr:error', cb),
  onBookFormatProgress: (cb) => subscribe<BookFormatProgress>('book:format:progress', cb),
  onBookFormatDone: (cb) => subscribe<BookFormatDoneEvent>('book:format:done', cb),
  onChapterFormatted: (cb) => subscribe<FormatResult>('chapter:formatted', cb),
  onBookComposeProgress: (cb) => subscribe<BookComposeProgress>('book:compose:progress', cb),
  onSemanticReady: (cb) => subscribe<void>('semantic:ready', () => cb()),
}

contextBridge.exposeInMainWorld('api', api)
