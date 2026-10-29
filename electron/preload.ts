import { contextBridge, ipcRenderer } from 'electron'

import type {
  BookSummary,
  ChapterContent,
  ChapterFlag,
  ChapterMeta,
  ChatAnswer,
  ChatMode,
  ChatTurn,
  ClassifyResult,
  FormatResult,
  FeynmanResult,
  GenerationDoneEvent,
  GenerationErrorEvent,
  GenerationPartialEvent,
  KnowledgeMapData,
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
  cancelGeneration: () => ipcRenderer.invoke('notes:cancel') as Promise<void>,
  expandNote: (noteId) => ipcRenderer.invoke('notes:expand', noteId) as Promise<Note>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<SettingsView>,
  saveSettings: (patch: SettingsPatch) => ipcRenderer.invoke('settings:save', patch) as Promise<SettingsView>,
  testConnection: () => ipcRenderer.invoke('settings:test') as Promise<TestResult>,
  getAppInfo: () => ipcRenderer.invoke('app:info') as Promise<{ version: string; dataDir: string; demo: boolean }>,
  openDataDir: () => ipcRenderer.invoke('app:open-data') as Promise<void>,
  copyText: (text: string) => ipcRenderer.invoke('app:copy-text', text) as Promise<void>,
  saveMarkdown: (defaultName: string, content: string) =>
    ipcRenderer.invoke('app:save-markdown', defaultName, content) as Promise<SaveFileResult>,
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
  onGenerationPartial: (cb) => subscribe<GenerationPartialEvent>('generation:partial', cb),
  onGenerationDone: (cb) => subscribe<GenerationDoneEvent>('generation:done', cb),
  onGenerationError: (cb) => subscribe<GenerationErrorEvent>('generation:error', cb),
  onSemanticReady: (cb) => subscribe<void>('semantic:ready', () => cb()),
}

contextBridge.exposeInMainWorld('api', api)
