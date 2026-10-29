import { contextBridge, ipcRenderer } from 'electron'

import type {
  BookSummary,
  ChapterContent,
  ChapterFlag,
  ChapterMeta,
  ClassifyResult,
  FormatResult,
  GenerationDoneEvent,
  GenerationErrorEvent,
  GenerationPartialEvent,
  Note,
  NoteDraft,
  NotePatch,
  ReaderStyle,
  RelatedNote,
  ReadingApi,
  SettingsPatch,
  SettingsView,
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
  listRelatedNotes: (bookId, tags) =>
    ipcRenderer.invoke('notes:related', bookId, tags) as Promise<RelatedNote[]>,
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
  onGenerationPartial: (cb) => subscribe<GenerationPartialEvent>('generation:partial', cb),
  onGenerationDone: (cb) => subscribe<GenerationDoneEvent>('generation:done', cb),
  onGenerationError: (cb) => subscribe<GenerationErrorEvent>('generation:error', cb),
}

contextBridge.exposeInMainWorld('api', api)
