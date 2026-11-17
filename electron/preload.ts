import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

import type { DeepLinkTarget } from '../shared/deep-link.js'

import type {
  AiJobCancelTarget,
  AiJobSnapshot,
  AiUsageSummary,
  NoteQualitySummary,
  SyncSnapshot,
  MergeSnapshotResult,
  SyncStatus,
  WebDavConfigInput,
  WebDavConfigView,
  PdfAnnotation,
  PdfAnnotationColor,
  AppNotice,
  AppInfo,
  BackupInfo,
  BookComposeOptions,
  BookComposeProgress,
  BookComposeResult,
  ComposeSectionRewriteInput,
  ComposeSectionRewriteResult,
  CompareComposeInput,
  CompareComposeResult,
  CompareNotesInput,
  CompareNotesResult,
  BookGenerationDoneEvent,
  BookGenerationOptions,
  BookGenerationProgress,
  BookGenre,
  BookShelfStatus,
  BookSummary,
  ChapterContent,
  ChapterAiJobs,
  BookAiJobs,
  ChapterTranslatedEvent,
  ChapterTranslationErrorEvent,
  ChapterTranslationProgress,
  BookTranslationDoneEvent,
  BookTranslationInfo,
  BookTranslationOptions,
  BookTranslationProgress,
  ChapterFlag,
  ChapterMeta,
  ChatAnswer,
  BookFormatDoneEvent,
  BookFormatOptions,
  BookFormatProgress,
  ClassifyResult,
  ContentApplyAction,
  ContentApplyResult,
  ContentFilter,
  ContentItem,
  ContentStatus,
  BackgroundTaskRecord,
  DoclingStatus,
  DoclingProgressEvent,
  ImageUnderstandingResult,
  CodeAssistResult,
  ChapterContentSaveResult,
  TrashedChapter,
  TrashedBook,
  FormatChapterOptions,
  FormatResult,
  FeynmanResult,
  SessionSummary,
  SessionSummaryInput,
  GenerationDoneEvent,
  GenerationErrorEvent,
  GenerationPartialEvent,
  AiModelListInput,
  AiModelListResult,
  HighlightImportOptions,
  HighlightImportResult,
  ImportBookOptions,
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
  LocalModelDetection,
  LibraryNote,
  LibraryNoteAudit,
  Note,
  NoteDraft,
  NotePatch,
  NotesExportResult,
  OcrDoneEvent,
  PageResult,
  OcrErrorEvent,
  OcrImportOptions,
  OcrImportStarted,
  TtsAudio,
  TtsStatus,
  TtsSynthesisRequest,
  OcrJob,
  OcrProgress,
  ReaderMark,
  ReaderMarkStyle,
  ReaderStyle,
  RelatedNote,
  ReadingApi,
  RendererErrorReport,
  SaveFileResult,
  ShareCopyInput,
  ShareCopyResult,
  SaveImagesResult,
  ReadingBookmark,
  ReadingBookmarkDraft,
  ReadingPositionInput,
  ReadingPositionRecord,
  ReadingPlanInput,
  ReadingPlanRecord,
  ReadingStatsData,
  UiPreferences,
  WeeklyReviewRecord,
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
  importBook: (options?: ImportBookOptions) =>
    ipcRenderer.invoke('books:import', options) as Promise<BookSummary | null>,
  getDoclingStatus: () => ipcRenderer.invoke('docling:status') as Promise<DoclingStatus>,
  understandChapterImage: (chapterId: string, imageSrc: string) =>
    ipcRenderer.invoke('chapters:understand-image', chapterId, imageSrc) as Promise<ImageUnderstandingResult>,
  applyCodeFix: (chapterId: string, code: string, fixed: string) =>
    ipcRenderer.invoke('chapters:apply-code-fix', chapterId, code, fixed),
  codeAssist: (chapterId: string, code: string, mode: 'review' | 'explain' | 'fix', language?: string) =>
    ipcRenderer.invoke('chapters:code-assist', chapterId, code, mode, language) as Promise<CodeAssistResult>,
  saveChapterContent: (chapterId: string, html: string) =>
    ipcRenderer.invoke('chapters:save-content', chapterId, html) as Promise<ChapterContentSaveResult>,
  importText: (input: TextImportInput) => ipcRenderer.invoke('books:import-text', input) as Promise<BookSummary>,
  importUrl: (url: string, options?: ImportBookOptions) =>
    ipcRenderer.invoke('books:import-url', url, options) as Promise<BookSummary>,
  importScannedPdf: (options?: OcrImportOptions) =>
    ipcRenderer.invoke('books:import-ocr', options) as Promise<OcrImportStarted | null>,
  listAiModels: (input?: AiModelListInput) =>
    ipcRenderer.invoke('ai:list-models', input) as Promise<AiModelListResult>,
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
  getReadingPlan: (bookId: string) =>
    ipcRenderer.invoke('reading-plan:get', bookId) as Promise<ReadingPlanRecord | null>,
  listReadingPlans: () => ipcRenderer.invoke('reading-plan:list') as Promise<ReadingPlanRecord[]>,
  saveReadingPlan: (input: ReadingPlanInput) =>
    ipcRenderer.invoke('reading-plan:save', input) as Promise<ReadingPlanRecord>,
  deleteReadingPlan: (bookId: string) => ipcRenderer.invoke('reading-plan:delete', bookId) as Promise<void>,
  renameBook: (bookId: string, title: string, author?: string) =>
    ipcRenderer.invoke('books:rename', bookId, title, author) as Promise<BookSummary>,
  setBookShelfStatus: (bookId: string, status: BookShelfStatus) =>
    ipcRenderer.invoke('books:set-shelf-status', bookId, status) as Promise<BookSummary>,
  setBookGenre: (bookId: string, genre: BookGenre) =>
    ipcRenderer.invoke('books:genre', bookId, genre) as Promise<BookSummary>,
  renameChapter: (chapterId: string, title: string) =>
    ipcRenderer.invoke('chapters:rename', chapterId, title) as Promise<void>,
  renamePart: (bookId: string, partIndex: number, title: string) =>
    ipcRenderer.invoke('parts:rename', bookId, partIndex, title) as Promise<void>,
  reparseBook: (bookId, options?: ImportBookOptions) =>
    ipcRenderer.invoke('books:reparse', bookId, options) as Promise<BookSummary>,
  mergeBooks: (bookIds: string[], title: string, author: string) =>
    ipcRenderer.invoke('books:merge', bookIds, title, author) as Promise<BookSummary>,
  splitBook: (bookId: string, fromChapterId: string, title: string) =>
    ipcRenderer.invoke('books:split', bookId, fromChapterId, title) as Promise<BookSummary>,
  deleteBook: (bookId) => ipcRenderer.invoke('books:delete', bookId) as Promise<void>,
  listTrashedBooks: () => ipcRenderer.invoke('books:trash-list') as Promise<TrashedBook[]>,
  restoreTrashedBook: (bookId: string) =>
    ipcRenderer.invoke('books:trash-restore', bookId) as Promise<BookSummary | null>,
  purgeTrashedBook: (bookId: string) =>
    ipcRenderer.invoke('books:trash-purge', bookId) as Promise<void>,
  emptyBookTrash: () => ipcRenderer.invoke('books:trash-empty') as Promise<void>,
  formatChapter: (chapterId, instruction, options?: FormatChapterOptions) =>
    ipcRenderer.invoke('chapters:format', chapterId, instruction, options) as Promise<FormatResult>,
  formatBook: (bookId: string, options?: BookFormatOptions) =>
    ipcRenderer.invoke('chapters:format-book', bookId, options) as Promise<void>,
  cancelFormat: (target?: AiJobCancelTarget) =>
    ipcRenderer.invoke('chapters:format-cancel', target) as Promise<void>,
  translateChapter: (chapterId: string, options?: { force?: boolean }) =>
    ipcRenderer.invoke('chapters:translate', chapterId, options) as Promise<void>,
  translateBook: (bookId: string, options?: BookTranslationOptions) =>
    ipcRenderer.invoke('books:translate', bookId, options) as Promise<void>,
  getBookTranslationInfo: (bookId: string) =>
    ipcRenderer.invoke('books:translation-info', bookId) as Promise<BookTranslationInfo>,
  cancelTranslation: (target?: AiJobCancelTarget) =>
    ipcRenderer.invoke('chapters:translate-cancel', target) as Promise<void>,
  listAiJobs: () => ipcRenderer.invoke('ai:jobs-list') as Promise<AiJobSnapshot[]>,
  getChapterAiJobs: (chapterId: string) => ipcRenderer.invoke('ai:job-state', chapterId) as Promise<ChapterAiJobs>,
  getBookAiJobs: (bookId: string) => ipcRenderer.invoke('ai:book-jobs', bookId) as Promise<BookAiJobs>,
  dismissAiJob: (id: string) => ipcRenderer.invoke('ai:job-dismiss', id) as Promise<void>,
  onAiJobUpdate: (cb) => subscribe<AiJobSnapshot>('ai:job:update', cb),
  resetChapterFormat: (chapterId) => ipcRenderer.invoke('chapters:resetFormat', chapterId) as Promise<number>,
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
  listTrashedChapters: () => ipcRenderer.invoke('chapters:trash-list') as Promise<TrashedChapter[]>,
  restoreTrashedChapter: (chapterId: string) =>
    ipcRenderer.invoke('chapters:trash-restore', chapterId) as Promise<ChapterContent | null>,
  purgeTrashedChapter: (chapterId: string) =>
    ipcRenderer.invoke('chapters:trash-purge', chapterId) as Promise<void>,
  emptyChapterTrash: () => ipcRenderer.invoke('chapters:trash-empty') as Promise<number>,
  listBackgroundTasks: () => ipcRenderer.invoke('tasks:list') as Promise<BackgroundTaskRecord[]>,
  onDeepLink: (listener) => {
    const handler = (_event: IpcRendererEvent, target: DeepLinkTarget): void => listener(target)
    ipcRenderer.on('app:deep-link', handler)
    return () => ipcRenderer.removeListener('app:deep-link', handler)
  },
  onRelationGraphProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: { stage?: 'nodes' | 'edges' }): void => {
      if (payload?.stage === 'nodes' || payload?.stage === 'edges') listener(payload.stage)
    }
    ipcRenderer.on('relation:progress', handler)
    return () => ipcRenderer.removeListener('relation:progress', handler)
  },
  listNotes: (bookId, chapterId) => ipcRenderer.invoke('notes:list', bookId, chapterId) as Promise<Note[]>,
  listRelatedNotes: (bookId, tags, queryText) =>
    ipcRenderer.invoke('notes:related', bookId, tags, queryText) as Promise<RelatedNote[]>,
  createNote: (draft: NoteDraft) => ipcRenderer.invoke('notes:create', draft) as Promise<Note>,
  updateNote: (id, patch: NotePatch) => ipcRenderer.invoke('notes:update', id, patch) as Promise<Note>,
  deleteNote: (id) => ipcRenderer.invoke('notes:delete', id) as Promise<void>,
  generateNotes: (chapterId, options) =>
    ipcRenderer.invoke('notes:generate', chapterId, options) as Promise<void>,
  generateBookNotes: (bookId: string, options?: BookGenerationOptions) =>
    ipcRenderer.invoke('notes:generate-book', bookId, options) as Promise<void>,
  cancelGeneration: (target?: AiJobCancelTarget) =>
    ipcRenderer.invoke('notes:cancel', target) as Promise<void>,
  composeBook: (bookId: string, options: BookComposeOptions) =>
    ipcRenderer.invoke('book:compose', bookId, options) as Promise<BookComposeResult>,
  cancelBookCompose: (target?: AiJobCancelTarget) =>
    ipcRenderer.invoke('book:compose-cancel', target) as Promise<void>,
  rewriteComposeSection: (input: ComposeSectionRewriteInput) =>
    ipcRenderer.invoke('compose:rewrite-section', input) as Promise<ComposeSectionRewriteResult>,
  cancelComposeSectionRewrite: () =>
    ipcRenderer.invoke('compose:rewrite-section-cancel') as Promise<void>,
  expandNote: (noteId) => ipcRenderer.invoke('notes:expand', noteId) as Promise<Note>,
  compareChapterNotes: (input: CompareNotesInput) =>
    ipcRenderer.invoke('notes:compare', input) as Promise<CompareNotesResult>,
  compareBookCompose: (input: CompareComposeInput) =>
    ipcRenderer.invoke('book:compose-compare', input) as Promise<CompareComposeResult>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<SettingsView>,
  saveSettings: (patch: SettingsPatch) => ipcRenderer.invoke('settings:save', patch) as Promise<SettingsView>,
  setAppLock: (passcode: string | null) => ipcRenderer.invoke('app:set-lock', passcode) as Promise<boolean>,
  verifyAppLock: (passcode: string) => ipcRenderer.invoke('app:verify-lock', passcode) as Promise<boolean>,
  testConnection: () => ipcRenderer.invoke('settings:test') as Promise<TestResult>,
  getAppInfo: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
  getAiUsage: (days?: number) => ipcRenderer.invoke('ai:usage', days) as Promise<AiUsageSummary>,
  getNoteQuality: () => ipcRenderer.invoke('stats:note-quality') as Promise<NoteQualitySummary>,
  listPdfAnnotations: (bookId: string, page: number) =>
    ipcRenderer.invoke('pdf:annotations', bookId, page) as Promise<PdfAnnotation[]>,
  listPdfAnnotationsForBook: (bookId: string) =>
    ipcRenderer.invoke('pdf:annotations-all', bookId) as Promise<PdfAnnotation[]>,
  savePdfAnnotation: (input: {
    bookId: string
    page: number
    x: number
    y: number
    width: number
    height: number
    note?: string
    color?: PdfAnnotationColor
  }) => ipcRenderer.invoke('pdf:annotation-save', input) as Promise<PdfAnnotation>,
  updatePdfAnnotation: (id: string, patch: { note?: string; color?: PdfAnnotationColor }) =>
    ipcRenderer.invoke('pdf:annotation-update', id, patch) as Promise<PdfAnnotation>,
  deletePdfAnnotation: (id: string) => ipcRenderer.invoke('pdf:annotation-delete', id) as Promise<void>,
  getSyncStatus: () => ipcRenderer.invoke('sync:status') as Promise<SyncStatus>,
  getWebDavConfig: () => ipcRenderer.invoke('sync:webdav-config') as Promise<WebDavConfigView>,
  saveWebDavConfig: (input: WebDavConfigInput) =>
    ipcRenderer.invoke('sync:webdav-save', input) as Promise<WebDavConfigView>,
  testWebDav: () => ipcRenderer.invoke('sync:webdav-test') as Promise<{ ok: boolean; message: string }>,
  pushWebDavSnapshot: (passphrase?: string) =>
    ipcRenderer.invoke('sync:webdav-push', passphrase) as Promise<SyncSnapshot>,
  listWebDavSnapshots: () => ipcRenderer.invoke('sync:webdav-list') as Promise<SyncSnapshot[]>,
  pullWebDavSnapshot: (name: string, passphrase?: string) =>
    ipcRenderer.invoke('sync:webdav-pull', name, passphrase) as Promise<{ ok: boolean }>,
  deleteWebDavSnapshot: (name: string) => ipcRenderer.invoke('sync:webdav-delete', name) as Promise<void>,
  chooseSyncFolder: () => ipcRenderer.invoke('sync:choose-folder') as Promise<SyncStatus>,
  pushSyncSnapshot: (passphrase?: string) => ipcRenderer.invoke('sync:push', passphrase) as Promise<SyncSnapshot>,
  pullSyncSnapshot: (name: string, passphrase?: string) =>
    ipcRenderer.invoke('sync:pull', name, passphrase) as Promise<{ ok: boolean }>,
  mergeSyncSnapshot: (name: string, passphrase?: string) =>
    ipcRenderer.invoke('sync:merge', name, passphrase) as Promise<MergeSnapshotResult>,
  deleteSyncSnapshot: (name: string) => ipcRenderer.invoke('sync:delete', name) as Promise<SyncStatus>,
  openSyncFolder: () => ipcRenderer.invoke('sync:open-folder') as Promise<void>,
  openDataDir: () => ipcRenderer.invoke('app:open-data') as Promise<void>,
  createBackup: () => ipcRenderer.invoke('backup:create') as Promise<BackupInfo>,
  listBackups: () => ipcRenderer.invoke('backup:list') as Promise<BackupInfo[]>,
  restoreBackup: (id: string) => ipcRenderer.invoke('backup:restore', id) as Promise<void>,
  deleteBackup: (id: string) => ipcRenderer.invoke('backup:delete', id) as Promise<void>,
  openBackupsDir: () => ipcRenderer.invoke('backup:open-dir') as Promise<void>,
  exportBackup: (id: string) => ipcRenderer.invoke('backup:export', id) as Promise<SaveFileResult>,
  exportLibrary: () => ipcRenderer.invoke('backup:export-library') as Promise<SaveFileResult>,
  importLibrary: () => ipcRenderer.invoke('backup:import-library') as Promise<SaveFileResult>,
  exportDiagnostics: () => ipcRenderer.invoke('app:export-diagnostics') as Promise<SaveFileResult>,
  logRendererError: (report: RendererErrorReport) =>
    ipcRenderer.invoke('app:log-renderer-error', report) as Promise<void>,
  copyText: (text: string) => ipcRenderer.invoke('app:copy-text', text) as Promise<void>,
  saveTextFile: (defaultName: string, content: string, extension: 'bib' | 'ris' | 'txt') =>
    ipcRenderer.invoke('app:save-text-file', defaultName, content, extension) as Promise<SaveFileResult>,
  optimizeShareCopy: (input: ShareCopyInput) =>
    ipcRenderer.invoke('share:optimize-copy', input) as Promise<ShareCopyResult>,
  saveMarkdown: (defaultName: string, content: string) =>
    ipcRenderer.invoke('app:save-markdown', defaultName, content) as Promise<SaveFileResult>,
  saveHtml: (defaultName: string, content: string) =>
    ipcRenderer.invoke('app:save-html', defaultName, content) as Promise<SaveFileResult>,
  savePdf: (defaultName: string, html: string) =>
    ipcRenderer.invoke('app:save-pdf', defaultName, html) as Promise<SaveFileResult>,
  saveBinary: (defaultName: string, base64: string) =>
    ipcRenderer.invoke('app:save-binary', defaultName, base64) as Promise<SaveFileResult>,
  copyImage: (dataUrl: string) => ipcRenderer.invoke('app:copy-image', dataUrl) as Promise<void>,
  notifyDesktop: (title: string, body: string) =>
    ipcRenderer.invoke('app:notify', title, body) as Promise<void>,
  readBookFile: (bookId: string) =>
    ipcRenderer.invoke('books:file', bookId).then((bytes: Uint8Array) => new Uint8Array(bytes)),
  getTtsStatus: () => ipcRenderer.invoke('tts:status') as Promise<TtsStatus>,
  synthesizeTts: (request: TtsSynthesisRequest) =>
    ipcRenderer.invoke('tts:synthesize', request) as Promise<TtsAudio>,
  detectLocalModels: () => ipcRenderer.invoke('settings:detect-local') as Promise<LocalModelDetection>,
  search: (query: string) => ipcRenderer.invoke('library:search', query) as Promise<SearchResult[]>,
  searchSemantic: (query: string) => ipcRenderer.invoke('library:search-semantic', query) as Promise<SearchResult[]>,
  listLibraryNotes: (filter?: LibraryFilter) =>
    ipcRenderer.invoke('library:notes', filter) as Promise<LibraryNote[]>,
  exportNotesMarkdown: (filter?: LibraryFilter) =>
    ipcRenderer.invoke('notes:export-markdown', filter) as Promise<NotesExportResult>,
  listLibraryNotesPage: (filter?: LibraryFilter) =>
    ipcRenderer.invoke('library:notes-page', filter) as Promise<PageResult<LibraryNote>>,
  getLibraryNoteAudit: (filter?: LibraryFilter) =>
    ipcRenderer.invoke('library:notes-audit', filter) as Promise<LibraryNoteAudit>,
  listLibraryTags: (bookId) => ipcRenderer.invoke('library:tags', bookId) as Promise<TagCount[]>,
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
  generateSessionSummary: (input: SessionSummaryInput) =>
    ipcRenderer.invoke('reader:summary', input) as Promise<SessionSummary>,
  cancelSessionSummary: () => ipcRenderer.invoke('reader:summary-cancel') as Promise<void>,
  getKnowledgeMap: () => ipcRenderer.invoke('map:get') as Promise<KnowledgeMapData>,
  runLab: (request: LabRequest) => ipcRenderer.invoke('lab:run', request) as Promise<LabReport>,
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
  getReadingStats: () => ipcRenderer.invoke('reading:stats-get') as Promise<ReadingStatsData>,
  mergeReadingStats: (data: ReadingStatsData) =>
    ipcRenderer.invoke('reading:stats-merge', data) as Promise<ReadingStatsData>,
  recordReading: (day: string, seconds: number, bookId?: string | null) =>
    ipcRenderer.invoke('reading:stats-record', day, seconds, bookId) as Promise<void>,
  getUiPreferences: () => ipcRenderer.invoke('preferences:get') as Promise<UiPreferences>,
  saveUiPreferences: (patch: { autoNext?: boolean; dailyGoal?: number }) =>
    ipcRenderer.invoke('preferences:save', patch) as Promise<UiPreferences>,
  saveWeeklyReview: (input: { week: string; title: string; content: string }) =>
    ipcRenderer.invoke('weekly:save', input) as Promise<WeeklyReviewRecord>,
  listWeeklyReviews: () => ipcRenderer.invoke('weekly:list') as Promise<WeeklyReviewRecord[]>,
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
  getContentVersions: (tool: string, scope: string) =>
    ipcRenderer.invoke('content:versions', tool, scope) as Promise<ContentItem[]>,
  setContentFavorite: (id: string, favorite: boolean) =>
    ipcRenderer.invoke('content:favorite', id, favorite) as Promise<ContentItem>,
  setContentStatus: (id: string, status: ContentStatus) =>
    ipcRenderer.invoke('content:status', id, status) as Promise<ContentItem>,
  deleteContent: (id: string) => ipcRenderer.invoke('content:delete', id) as Promise<void>,
  purgeContent: (id: string) => ipcRenderer.invoke('content:purge', id) as Promise<void>,
  purgeDeletedContent: () => ipcRenderer.invoke('content:purge-all') as Promise<number>,
  applyContent: (id: string, action: ContentApplyAction) =>
    ipcRenderer.invoke('content:apply', id, action) as Promise<ContentApplyResult>,
  undoContentApply: (token: string) =>
    ipcRenderer.invoke('content:undo', token) as Promise<ContentApplyResult>,
  onGenerationPartial: (cb) => subscribe<GenerationPartialEvent>('generation:partial', cb),
  onGenerationDone: (cb) => subscribe<GenerationDoneEvent>('generation:done', cb),
  onGenerationError: (cb) => subscribe<GenerationErrorEvent>('generation:error', cb),
  onBookGenerationProgress: (cb) => subscribe<BookGenerationProgress>('book:generation:progress', cb),
  onBookGenerationDone: (cb) => subscribe<BookGenerationDoneEvent>('book:generation:done', cb),
  onDoclingProgress: (cb) => subscribe<DoclingProgressEvent>('docling:progress', cb),
  onOcrProgress: (cb) => subscribe<OcrProgress>('ocr:progress', cb),
  onOcrDone: (cb) => subscribe<OcrDoneEvent>('ocr:done', cb),
  onOcrError: (cb) => subscribe<OcrErrorEvent>('ocr:error', cb),
  onBookFormatProgress: (cb) => subscribe<BookFormatProgress>('book:format:progress', cb),
  onBookFormatDone: (cb) => subscribe<BookFormatDoneEvent>('book:format:done', cb),
  onChapterFormatted: (cb) => subscribe<FormatResult>('chapter:formatted', cb),
  onChapterTranslationProgress: (cb) =>
    subscribe<ChapterTranslationProgress>('chapter:translation:progress', cb),
  onChapterTranslated: (cb) => subscribe<ChapterTranslatedEvent>('chapter:translated', cb),
  onChapterTranslationError: (cb) =>
    subscribe<ChapterTranslationErrorEvent>('chapter:translation:error', cb),
  onBookTranslationProgress: (cb) =>
    subscribe<BookTranslationProgress>('book:translation:progress', cb),
  onBookTranslationDone: (cb) =>
    subscribe<BookTranslationDoneEvent>('book:translation:done', cb),
  onBookComposeProgress: (cb) => subscribe<BookComposeProgress>('book:compose:progress', cb),
  onSemanticReady: (cb) => subscribe<void>('semantic:ready', () => cb()),
  onAppNotice: (cb: (notice: AppNotice) => void) => subscribe<AppNotice>('app:notice', cb),
}

contextBridge.exposeInMainWorld('api', api)
