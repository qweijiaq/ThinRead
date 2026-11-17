import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { app, BrowserWindow, ClipboardItem, Notification, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import type { IpcMainInvokeEvent, OpenDialogOptions } from 'electron'

import { backupsDir, createBackup, deleteBackup, exportBackup, importBackupArchive, listBackups, restoreBackup } from './backup.js'
import { buildDiagnosticsArchive } from './diagnostics.js'
import { logErrorEvent } from './logger.js'
import { bookStorageDir } from './safe-path.js'

import {
  applyChapterFlags,
  applyContent,
  undoContentApply,
  createChapterMark,
  createNote,
  createOcrJob,
  getOcrJob,
  listOcrJobs,
  updateOcrJob,
  deleteChapterMark,
  deleteContent,
  purgeContent,
  purgeDeletedContent,
  deleteChapters,
  listTrashedChapters,
  restoreTrashedChapter,
  purgeTrashedChapter,
  emptyChapterTrash,
  trashNote,
  restoreTrashedNote,
  listTrashedNotes,
  purgeTrashedNote,
  emptyNoteTrash,
  getReadingPosition,
  saveReadingPosition,
  saveReadingPage,
  getReadingPlan,
  listReadingPlans,
  saveReadingPlan,
  deleteReadingPlan,
  getReadingStatsRecord,
  mergeReadingStatsRecord,
  recordReadingStats,
  saveWeeklyReview,
  listWeeklyReviews,
  listBookmarks,
  createBookmark,
  deleteBookmark,
  deleteBook as deleteBookRow,
  snapshotBookForTrash,
  saveBookTrash,
  listTrashedBooks,
  restoreTrashedBook,
  purgeTrashedBook,
  emptyBookTrash,
  deleteBackgroundTask,
  getBookCover,
  getBookRecord,
  updateBookCover,
  getBookStyle,
  getBookSummary,
  getBookTranslationInfo,
  mergeBooks,
  splitBook,
  getChapter,
  getChapters,
  getContent,
  listContentVersions,
  getLabArtifact,
  getNote,
  listLabArtifacts,
  listBooks,
  listChapterMarks,
  listContent,
  listContentPage,
  listLibraryNotes,
  listLibraryNotesPage,
  getLibraryNoteAudit,
  listLibraryTags,
  listNotes,
  listRelatedNotes,
  mergeNotes,
  mergeNoteTags,
  replaceAiNotes,
  replaceBookChapters,
  resetChapterFormat,
  renameBook,
  renameChapter,
  renamePart,
  saveBookStyle,
  saveChapterFormat,
  saveChapterContent,
  saveChapterTranslation,
  saveLabArtifact,
  setBookGenre,
  setContentFavorite,
  setContentStatus,
  updateLabArtifact,
  saveNoteDivergences,
  saveNoteReport,
  setProgress,
  updateNote,
  listBackgroundTasks,
  upsertBackgroundTask,
  updateBackgroundTask,
} from './db.js'
import { searchLibrary } from './search.js'
import {
  dismissAiJob,
  getAiJob,
  listAiJobs,
  patchAiJob,
  publishAiJob,
  type JobSender,
} from './ai/jobs.js'
import { classifyChapters } from './ai/classify.js'
import { listProviderModels } from './ai/models.js'
import { optimizeShareCopy } from './ai/share-copy.js'
import { auditXhsCoverage } from './ai/xhs-coverage.js'
import { formatChapter as formatChapterWithAI } from './ai/format.js'
import { translateChapter } from './ai/translate.js'
import { runBookTranslation, selectTranslatableChapters } from './book-translate.js'
import {
  analyzePdfPage,
  checkQuizAnswer,
  generateRelationGraph,
  findDuplicateNotes,
  generateQuiz,
  labChat,
  marginNote,
  runLab,
  suggestConceptMerges,
} from './ai/lab.js'
import { composeBook } from './ai/book-compose.js'
import { rewriteComposeSection } from './ai/section-rewrite.js'
import { expandPoint, generateChapterNotes } from './ai/notes.js'
import { createLanguageModel } from './ai/provider.js'
import type { ModelConfig } from './ai/provider.js'
import { askChapter, evaluateExplanation } from './ai/tutor.js'
import { generateSessionSummary } from './ai/session-summary.js'
import { traceAsync, tracedGenerateText } from './ai/trace.js'
import { classifyImportedChapters, importBookFile, importHighlightEntries, importHighlightsFile, importScannedPdf, importTextBook, importUrlBook, reparseBookFile } from './import.js'
import { renderHtmlToPdf } from './pdf.js'
import { buildKnowledgeMap } from './knowledge-map.js'
import { configureSemantic, semanticRelatedNotes, semanticSearchNotes, warmSemanticIndex } from './semantic.js'
import { getActiveSettings, getProviderApiKey, getReadwiseToken, getSettingsView, getUiPreferences, getAppLockEnabled, isDemoMode, saveSettings, saveUiPreferences, setAppLockPasscode, verifyAppLockPasscode } from './settings.js'
import { fetchReadwiseEntries } from './readwise.js'
import { parseWechatReadingNotes } from './parsers/wechat-reading.js'
import { getDoclingStatus } from './parsers/docling.js'
import { htmlToText, sanitizeChapterHtml, stripEditorArtifacts } from './html.js'
import { understandImageInChapter } from './image-understanding.js'
import { resolveVisionModel } from './ai/vision-model.js'
import { isVisionError } from './ai/note-images.js'
import { explainCode, fixCode, insertCodeUnderstanding, replaceCodeBlock, reviewCode } from './ai/code-assist.js'
import { getTtsStatus, synthesizeTts } from './tts.js'
import { exportNotesMarkdown } from './note-export.js'
import { searchIndexAsync, searchIndexIds } from './search-index.js'
import type {
  AiJobCancelTarget,
  AiJobSnapshot,
  AiModelListInput,
  BookComposeProgress,
  BookComposeResult,
  BookFormatDoneEvent,
  BookFormatProgress,
  BookTranslationDoneEvent,
  BookTranslationProgress,
  BookGenre,
  FormatChapterOptions,
  FormatResult,
  BookGenerationDoneEvent,
  BookGenerationProgress,
  ChapterFlag,
  ChatMode,
  ContentApplyAction,
  ContentFilter,
  ContentStatus,
  ChatTurn,
  CompareComposeInput,
  CompareNotesInput,
  ComposeSectionRewriteInput,
  GeneratePartial,
  HighlightImportResult,
  ImportBookOptions,
  LabRequest,
  LibraryFilter,
  LocalModelDetection,
  Note,
  NoteReport,
  OcrDoneEvent,
  OcrErrorEvent,
  OcrImportOptions,
  OcrImportStarted,
  ReaderStyle,
  ReadingPlanInput,
  SaveFileResult,
  SaveImagesResult,
  SessionSummaryInput,
  SettingsPatch,
  TestResult,
  TtsSynthesisRequest,
  ReadingBookmark,
  ReadingBookmarkDraft,
  ReadingPositionInput,
  XhsCoverageRequest,
  RendererErrorReport,
} from '../shared/types.js'
import type { TutorContext } from './ai/tutor.js'
import {
  bookComposeArgs,
  bookFormatArgs,
  bookGenerateArgs,
  bookIdArgs,
  bookTranslateArgs,
  bookReparseArgs,
  chapterFormatArgs,
  chapterIdArgs,
  chapterIdsArgs,
  labArtifactArgs,
  mergeBooksArgs,
  noteDraftArgs,
  noteIdArgs,
  chapterUnderstandImageArgs,
  chapterApplyCodeFixArgs,
  chapterCodeAssistArgs,
  chapterSaveContentArgs,
  notePatchArgs,
  notesGenerateArgs,
  saveTextArgs,
  saveTextFileArgs,
  splitBookArgs,
  textImportArgs,
} from '../shared/ipc-schemas.js'

import { registerExtrasIpc } from './ipc/extras.js'
import { parseIpc } from './ipc/parse.js'

type ReadwiseProbe = { status: number } | { error: string }

async function probeReadwise(url: string, token: string, scheme: string): Promise<ReadwiseProbe> {
  try {
    const response = await fetch(url, {
      headers: { Authorization: `${scheme} ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    return { status: response.status }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function probeLabel(probe: ReadwiseProbe): string {
  return 'status' in probe ? `HTTP ${probe.status}` : probe.error
}

function probeSucceeded(probe: ReadwiseProbe, statuses: number[]): boolean {
  return 'status' in probe && statuses.includes(probe.status)
}

interface ActiveNotesRun {
  key: string
  chapterId: string
  bookId: string
  controller: AbortController
}

const activeComposes = new Map<string, AbortController>()
let activeFormat: AbortController | null = null
let activeFormatBookId: string | null = null
const activeChapterFormats = new Map<string, AbortController>()
const activeTranslations = new Map<string, AbortController>()
const activeBookTranslations = new Map<string, AbortController>()
let activeOcr: { controller: AbortController; fileName: string; jobId: string } | null = null
let activeLab: AbortController | null = null
let activeSummary: AbortController | null = null
let activeSection: AbortController | null = null
let activeCompare: AbortController | null = null
let activeComposeCompare: AbortController | null = null

const notesRuns = new Map<string, ActiveNotesRun>()

function notifyPreviousTaskCancelled(sender: JobSender): void {
  try {
    if (!sender.isDestroyed()) sender.send('app:notice', { kind: 'info', text: '已取消上一个 AI 任务。' })
  } catch {
    // 窗口已关闭时忽略。
  }
}

function cancelNotesRuns(target?: AiJobCancelTarget, sender?: JobSender | null): void {
  for (const [key, run] of notesRuns) {
    if (target?.chapterId && run.chapterId !== target.chapterId) continue
    if (target?.bookId && run.bookId !== target.bookId) continue
    run.controller.abort()
    notesRuns.delete(key)
    if (run.chapterId) {
      patchAiJob(sender ?? null, `ai-notes:${run.chapterId}`, {
        status: 'cancelled',
        detail: '已取消',
        error: undefined,
      })
    }
  }
}

function cancelFormats(target?: AiJobCancelTarget, sender?: JobSender | null): void {
  for (const [chapterId, controller] of activeChapterFormats) {
    if (target?.chapterId && chapterId !== target.chapterId) continue
    if (target?.bookId) {
      try {
        if (getChapter(chapterId).bookId !== target.bookId) continue
      } catch {
        continue
      }
    }
    controller.abort()
    activeChapterFormats.delete(chapterId)
    patchAiJob(sender ?? null, `ai-format:${chapterId}`, {
      status: 'cancelled',
      detail: '已取消',
      error: undefined,
    })
  }
  if (!target?.chapterId && (!target?.bookId || activeFormatBookId === target.bookId)) {
    activeFormat?.abort()
    activeFormat = null
    activeFormatBookId = null
  }
}

function cancelComposeRuns(target?: AiJobCancelTarget, sender?: JobSender | null): void {
  for (const [bookId, controller] of activeComposes) {
    if (target?.bookId && bookId !== target.bookId) continue
    controller.abort()
    activeComposes.delete(bookId)
    patchAiJob(sender ?? null, `ai-compose:${bookId}`, {
      status: 'cancelled',
      detail: '已取消合并',
      error: undefined,
    })
  }
}

function cancelTranslations(target?: AiJobCancelTarget, sender?: JobSender | null): void {
  // 全书翻译独占一本书；按书取消时连同它内部的章节任务一起停掉。
  if (!target?.chapterId) {
    for (const [bookId, controller] of activeBookTranslations) {
      if (target?.bookId && bookId !== target.bookId) continue
      controller.abort()
      activeBookTranslations.delete(bookId)
    }
  }
  for (const [chapterId, controller] of activeTranslations) {
    if (target?.chapterId && chapterId !== target.chapterId) continue
    if (target?.bookId) {
      try {
        if (getChapter(chapterId).bookId !== target.bookId) continue
      } catch {
        // 章节已经不存在时也取消。
      }
    }
    controller.abort()
    activeTranslations.delete(chapterId)
    patchAiJob(sender ?? null, `ai-translate:${chapterId}`, {
      status: 'cancelled',
      detail: '已取消翻译',
      error: undefined,
    })
  }
}

function cancelAllAiJobs(): void {
  cancelNotesRuns()
  cancelFormats()
  cancelTranslations()
  cancelComposeRuns()
  activeLab?.abort()
  activeLab = null
  activeSummary?.abort()
  activeSummary = null
  activeSection?.abort()
  activeSection = null
  activeCompare?.abort()
  activeCompare = null
  activeComposeCompare?.abort()
  activeComposeCompare = null
}

interface NotesRun {
  settings: ReturnType<typeof getActiveSettings>
  controller: AbortController
  sender: JobSender
  send(channel: string, payload: unknown): void
  release(): void
  isCurrent(): boolean
  /** 同一 runKey 已被更新的任务替换（不是用户取消）。 */
  isSuperseded(): boolean
}

/** 单章生成和整本生成共用：按 runKey 隔离，切章不会取消别的章节。 */
function beginNotesRun(
  event: IpcMainInvokeEvent,
  chapterId: string,
  runKey = chapterId ? `chapter:${chapterId}` : 'book',
  bookId = '',
): NotesRun {
  const existing = notesRuns.get(runKey)
  if (existing) {
    notifyPreviousTaskCancelled(event.sender)
    existing.controller.abort()
    notesRuns.delete(runKey)
  }
  const settings = getActiveSettings('notes')
  if (settings.provider !== 'demo' && settings.provider !== 'ollama' && settings.provider !== 'lmstudio' && !settings.apiKey) {
    throw new Error('还没有配置 API Key。请打开右上角设置，选择模型并填入 Key。')
  }
  const controller = new AbortController()
  notesRuns.set(runKey, { key: runKey, chapterId, bookId, controller })
  const sender = event.sender
  return {
    settings,
    controller,
    sender,
    send(channel, payload) {
      if (!sender.isDestroyed()) sender.send(channel, payload)
    },
    release() {
      if (notesRuns.get(runKey)?.controller === controller) notesRuns.delete(runKey)
    },
    isCurrent() {
      return notesRuns.get(runKey)?.controller === controller
    },
    isSuperseded() {
      const current = notesRuns.get(runKey)
      return Boolean(current && current.controller !== controller)
    },
  }
}

function beginLabSignal(sender: {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}): AbortSignal {
  if (activeLab) notifyPreviousTaskCancelled(sender)
  activeLab?.abort()
  activeLab = new AbortController()
  return activeLab.signal
}

async function generateChapterToDb(
  chapterId: string,
  settings: ReturnType<typeof getActiveSettings>,
  signal: AbortSignal,
  onPartial: (partial: GeneratePartial) => void,
  options?: { fresh?: boolean },
): Promise<{ notes: Note[]; report: NoteReport }> {
  const chapter = getChapter(chapterId)
  const book = getBookSummary(chapter.bookId)
  if (!book) throw new Error('找不到章节所属的书')
  const result = await generateChapterNotes(
    {
      bookTitle: book.title,
      chapterTitle: chapter.title,
      chapterText: chapter.text,
      chapterHtml: chapter.formattedHtml ?? chapter.html ?? '',
      config: settings,
      genre: book.genre,
      mode: settings.generationMode,
      notesLanguage: settings.notesLanguage,
      visionMode: settings.visionMode,
      lookupRelatedNotes: (concepts: string[]) =>
        listRelatedNotes(chapter.bookId, concepts, 4).map((item) => ({
          bookTitle: item.bookTitle,
          chapterTitle: item.chapterTitle ?? '',
          title: item.title,
          content: item.content.slice(0, 300),
        })),
      demo: settings.provider === 'demo',
      cacheDir: path.join(app.getPath('userData'), 'notes-cache'),
      fresh: options?.fresh === true,
    },
    onPartial,
    signal,
  )
  if (signal.aborted) throw new Error('生成已取消')
  const notes = replaceAiNotes(chapterId, result.notes)
  saveNoteReport(chapterId, result.report)
  // 每次生成留一份可恢复的快照；内容库和管理页从这里读取历史。
  saveLabArtifact({
    tool: 'chapter-notes',
    scope: `chapter:${chapterId}`,
    title: `${book.title} · ${chapter.title} · 笔记`,
    kind: 'notes',
    bookId: chapter.bookId,
    chapterId,
    content: JSON.stringify({ notes: result.notes, report: result.report }),
    meta: JSON.stringify({ bookId: chapter.bookId, chapterId, chapterTitle: chapter.title }),
  })
  return { notes, report: result.report }
}

function formatSourceHtml(chapter: ReturnType<typeof getChapter>): string {
  const escapeHtml = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // 图片理解已经写进 formatted_html 时，以它作为排版源，避免再次排版把说明丢掉。
  if (chapter.formattedHtml?.includes('image-understanding')) return chapter.formattedHtml
  return (
    chapter.html ??
    chapter.text
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
      .join('')
  )
}

async function formatChapterToDb(
  chapterId: string,
  instruction: string | undefined,
  signal?: AbortSignal,
  options: FormatChapterOptions = {},
): Promise<FormatResult> {
  const chapter = getChapter(chapterId)
  const style = getBookStyle(chapter.bookId)
  const config = getActiveSettings()
  const sourceHtml = formatSourceHtml(chapter)
  const sourceText = sourceHtml.includes('image-understanding') ? htmlToText(sourceHtml) : chapter.text
  const result = await traceAsync(
    { step: 'format-chapter', scope: chapterId, model: config.model, promptVersion: 'format-v3' },
    () =>
      formatChapterWithAI({
        chapterTitle: chapter.title,
        html: sourceHtml,
        originalText: sourceText,
        currentHtml: chapter.formattedHtml,
        currentRemoved: chapter.removed,
        instruction,
        style,
        skipReferences: options.skipReferences === true,
        config,
        signal,
      }),
  )
  if (signal?.aborted) throw new Error('排版已取消')
  const chars = saveChapterFormat(chapterId, result.html, result.removed)
  const savedStyle = saveBookStyle(chapter.bookId, result.style)
  saveLabArtifact({
    tool: 'chapter-format',
    scope: `chapter:${chapterId}`,
    title: `${chapter.title} · AI 排版`,
    kind: 'format',
    bookId: chapter.bookId,
    chapterId,
    content: JSON.stringify({ html: result.html, removed: result.removed, style: savedStyle, note: result.note }),
    meta: JSON.stringify({ bookId: chapter.bookId, chapterId, chapterTitle: chapter.title }),
  })
  return {
    chapterId,
    html: result.html,
    removed: result.removed,
    style: savedStyle,
    note: result.note,
    chars,
  }
}

function tutorContextFor(chapterId: string): TutorContext {
  const chapter = getChapter(chapterId)
  const book = getBookSummary(chapter.bookId)
  const notes = listNotes(chapter.bookId, chapterId)
  return {
    bookTitle: book?.title ?? '',
    chapterTitle: chapter.title,
    chapterText: chapter.text,
    condensed: notes.find((note) => note.kind === 'condensed')?.content ?? '',
    cards: notes
      .filter((note) => note.kind === 'point' || note.kind === 'claim')
      .map((note) => ({
        title: note.title,
        content: note.content,
        role: note.role,
        quote: note.quote,
      })),
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null, dataDir: string): void {
  configureSemantic(dataDir, () => {
    getWindow()?.webContents.send('semantic:ready')
  })

  async function autoBackup(label: string): Promise<void> {
    try {
      createBackup(dataDir, 'auto', label)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`操作前自动备份失败，已取消本次操作：${detail}`)
    }
  }

  function startOcrImport(
    sender: { isDestroyed(): boolean; send(channel: string, payload: unknown): void },
    filePath: string,
    range: OcrImportOptions,
    existing?: ReturnType<typeof getOcrJob>,
  ): OcrImportStarted {
    activeOcr?.controller.abort()
    const controller = new AbortController()
    const fileName = existing?.fileName ?? path.basename(filePath)
    const job =
      existing ??
      createOcrJob({
        fileName,
        filePath,
        startPage: Math.max(1, Math.floor(range.startPage ?? 1)),
        endPage: Math.max(0, Math.floor(range.endPage ?? 0)),
      })
    activeOcr = { controller, fileName, jobId: job.id }
    updateOcrJob(job.id, { status: 'running' })
    const send = (channel: string, payload: unknown): void => {
      if (!sender.isDestroyed()) sender.send(channel, payload)
    }
    const startedAt = Date.now()
    void (async () => {
      try {
        const book = await importScannedPdf(
          filePath,
          dataDir,
          (progress) => {
            updateOcrJob(job.id, { status: 'running', current: progress.current, total: progress.total })
            send('ocr:progress', progress)
          },
          controller.signal,
          { startPage: job.startPage, endPage: job.endPage },
        )
        if (controller.signal.aborted) return
        updateOcrJob(job.id, { status: 'done' })
        send('ocr:done', { book, durationMs: Date.now() - startedAt } satisfies OcrDoneEvent)
      } catch (error) {
        const cancelled = controller.signal.aborted
        updateOcrJob(job.id, { status: cancelled ? 'cancelled' : 'error' })
        send('ocr:error', {
          message: cancelled ? 'OCR 已取消' : error instanceof Error ? error.message : String(error),
          cancelled,
        } satisfies OcrErrorEvent)
      } finally {
        if (activeOcr?.controller === controller) activeOcr = null
      }
    })()
    return { started: true, fileName, jobId: job.id }
  }

  ipcMain.handle('books:list', () => listBooks())

  ipcMain.handle('books:import', async (event, importOptions?: ImportBookOptions) => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '导入电子书',
          properties: ['openFile'],
          filters: [{ name: '电子书', extensions: ['epub', 'pdf', 'mobi', 'azw3', 'docx', 'html', 'htm', 'md', 'markdown', 'txt'] }],
        })
      : await dialog.showOpenDialog({
          title: '导入电子书',
          properties: ['openFile'],
          filters: [{ name: '电子书', extensions: ['epub', 'pdf', 'mobi', 'azw3', 'docx', 'html', 'htm', 'md', 'markdown', 'txt'] }],
        })
    if (result.canceled || result.filePaths.length === 0) return null

    return importBookFile(
      result.filePaths[0]!,
      dataDir,
      {
        skipReferences: importOptions?.skipReferences === true,
        deepPdf: importOptions?.deepPdf === true,
        visionPdf: importOptions?.visionPdf === true,
        visionPdfMaintainFormat: importOptions?.visionPdfMaintainFormat === true,
      },
      (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('docling:progress', progress)
      },
    )
  })

  ipcMain.handle('docling:status', () => getDoclingStatus(dataDir))

  ipcMain.handle('books:import-text', async (_event, rawInput: unknown) => {
    const [input] = parseIpc('books:import-text', textImportArgs, [rawInput])
    return importTextBook(input, dataDir)
  })

  ipcMain.handle('books:import-url', async (_event, url: string, importOptions?: ImportBookOptions) => {
    if (typeof url !== 'string') throw new Error('网址无效。')
    return importUrlBook(url, dataDir, {
      skipReferences: importOptions?.skipReferences === true,
    })
  })

  ipcMain.handle('books:import-highlights', async (_event, importOptions?: { mergeExisting?: boolean }): Promise<HighlightImportResult | null> => {
    const win = getWindow()
    const options: OpenDialogOptions = {
      title: '导入划线',
      properties: ['openFile'],
      filters: [{ name: 'Readwise / Kindle', extensions: ['csv', 'txt'] }],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return importHighlightsFile(result.filePaths[0]!, dataDir, { mergeExisting: importOptions?.mergeExisting === true })
  })

  ipcMain.handle('books:import-wechat-highlights', async (_event, importOptions?: { mergeExisting?: boolean }): Promise<HighlightImportResult | null> => {
    const win = getWindow()
    const options: OpenDialogOptions = {
      title: '导入微信读书笔记',
      properties: ['openFile'],
      filters: [{ name: '微信读书笔记', extensions: ['txt', 'md', 'markdown', 'html', 'htm'] }],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const text = await fs.readFile(result.filePaths[0]!, 'utf8')
    const entries = parseWechatReadingNotes(text)
    if (entries.length === 0) {
      throw new Error('没有从文件里读出微信读书划线。请确认文件是微信读书笔记，或把复制的笔记内容保存为 .txt 后重试。')
    }
    return importHighlightEntries(entries, dataDir, { mergeExisting: importOptions?.mergeExisting === true })
  })

  ipcMain.handle('books:import-ocr', async (event, range?: OcrImportOptions): Promise<OcrImportStarted | null> => {
    const win = getWindow()
    const options: OpenDialogOptions = {
      title: '导入扫描版 PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return startOcrImport(event.sender, result.filePaths[0]!, range ?? {})
  })

  ipcMain.handle('books:import-ocr-cancel', () => {
    activeOcr?.controller.abort()
  })

  ipcMain.handle('readwise:test', async (_event, inputToken?: string): Promise<TestResult> => {
    const token = typeof inputToken === 'string' && inputToken.trim() ? inputToken.trim() : getReadwiseToken()
    if (!token) return { ok: false, message: '还没有配置 Readwise API Token。' }

    const classic: string[] = []
    let classicScheme = ''
    for (const scheme of ['Token', 'Bearer']) {
      const probe = await probeReadwise('https://readwise.io/api/v2/auth/', token, scheme)
      classic.push(`${scheme}: ${probeLabel(probe)}`)
      if (probeSucceeded(probe, [200, 204])) {
        classicScheme = scheme
        break
      }
    }

    const reader = await probeReadwise('https://readwise.io/api/v3/list/?limit=1', token, 'Token')
    const readerOk = probeSucceeded(reader, [200])

    if (classicScheme && readerOk) {
      return { ok: true, message: `Readwise 连接成功：常规划线和 Reader 接口都可用（${classicScheme}）。` }
    }
    if (classicScheme) {
      return {
        ok: true,
        message: `Readwise 连接成功：常规划线可用（${classicScheme}），Reader 接口不可用（${probeLabel(reader)}）。`,
      }
    }
    if (readerOk) {
      return {
        ok: true,
        message: `Readwise 连接成功：Reader 接口可用，常规划线接口不可用（${classic.join('；')}）。`,
      }
    }
    return {
      ok: false,
      message: `Readwise 连接失败：常规划线（${classic.join('；')}），Reader（${probeLabel(reader)}）。`,
    }
  })

  ipcMain.handle('readwise:sync', async (): Promise<HighlightImportResult> => {
    const token = getReadwiseToken()
    if (!token) throw new Error('还没有配置 Readwise API Token。请先在设置里填写。')
    const entries = await fetchReadwiseEntries(token)
    if (entries.length === 0) {
      throw new Error('Readwise 账号没有返回任何划线。请确认 Token 有权限访问 Readwise 划线和 Reader 文档，或改用 Readwise 的 CSV 导出后手动导入。')
    }
    return importHighlightEntries(entries, dataDir, { mergeExisting: true })
  })

  ipcMain.handle('ocr:jobs', () => listOcrJobs())

  ipcMain.handle('ocr:resume', (event, id: string): OcrImportStarted | null => {
    if (typeof id !== 'string') throw new Error('OCR 任务无效。')
    const job = getOcrJob(id)
    if (!job) return null
    return startOcrImport(event.sender, job.filePath, { startPage: job.startPage, endPage: job.endPage }, job)
  })

  ipcMain.handle('books:open', (_event, bookId: string) => {
    const book = getBookSummary(bookId)
    if (!book) throw new Error('找不到这本书')
    return { book, chapters: getChapters(bookId), style: getBookStyle(bookId) }
  })

  ipcMain.handle('reading-plan:get', (_event, bookId: string) => getReadingPlan(bookId))

  ipcMain.handle('reading-plan:list', () => listReadingPlans())

  ipcMain.handle('reading-plan:save', (_event, input: ReadingPlanInput) => saveReadingPlan(input))

  ipcMain.handle('reading-plan:delete', (_event, bookId: string) => {
    deleteReadingPlan(bookId)
  })

  ipcMain.handle('books:rename', (_event, bookId: string, title: string, author?: string) =>
    renameBook(bookId, title, typeof author === 'string' ? author : undefined),
  )

  ipcMain.handle('books:genre', (_event, bookId: string, genre: BookGenre) => setBookGenre(bookId, genre))

  ipcMain.handle('chapters:rename', (_event, chapterId: string, title: string) => {
    renameChapter(chapterId, title)
  })

  ipcMain.handle('parts:rename', (_event, bookId: string, partIndex: number, title: string) => {
    renamePart(bookId, partIndex, title)
  })

  ipcMain.handle('books:saveStyle', (_event, bookId: string, style: ReaderStyle) =>
    saveBookStyle(bookId, style),
  )

  ipcMain.handle('chapters:understand-image', async (_event, rawChapterId: unknown, rawImageSrc: unknown) => {
    const [chapterId, imageSrc] = parseIpc('chapters:understand-image', chapterUnderstandImageArgs, [
      rawChapterId,
      rawImageSrc,
    ])
    const chapter = getChapter(chapterId)
    const book = getBookSummary(chapter.bookId)
    const settings = getActiveSettings('notes')
    if (settings.provider === 'demo') throw new Error('演示模式不支持图片理解，请先在设置里配置真实视觉模型。')

    const run = async (
      config: ModelConfig,
      model: string,
      provider: ModelConfig['provider'],
      fallback: boolean,
    ) => {
      const result = await traceAsync(
        {
          step: 'image-understanding',
          scope: chapterId,
          model,
          promptVersion: 'image-understanding-v1',
        },
        () =>
          understandImageInChapter({
            chapterId,
            imageSrc,
            config,
            demo: false,
            bookTitle: book?.title ?? '',
            signal: AbortSignal.timeout(120_000),
          }),
      )
      const chars = saveChapterFormat(chapterId, result.html, chapter.removed)
      return { ...result, chars, model, provider, fallback }
    }

    try {
      // 先直接尝试当前模型：有些模型（例如 DeepSeek 的某些版本）不在常见视觉名单里，
      // 但实际能接收图片；只有明确是图片能力错误时才回退到其他服务商。
      return await run(settings, settings.model, settings.provider, false)
    } catch (error) {
      if (!isVisionError(error)) throw error
      const vision = await resolveVisionModel({ provider: settings.provider, model: settings.model })
      return await run(vision.config, vision.model, vision.provider, true)
    }
  })

  ipcMain.handle('chapters:save-content', async (_event, rawChapterId: unknown, rawHtml: unknown) => {
    const [chapterId, html] = parseIpc('chapters:save-content', chapterSaveContentArgs, [
      rawChapterId,
      rawHtml,
    ])
    const clean = sanitizeChapterHtml(stripEditorArtifacts(html))
    if (!htmlToText(clean).trim()) throw new Error('正文不能为空。')
    const chars = saveChapterContent(chapterId, clean)
    return { html: clean, chars }
  })

  ipcMain.handle('chapters:apply-code-fix', async (_event, rawChapterId: unknown, rawCode: unknown, rawFixed: unknown) => {
    const [chapterId, code, fixed] = parseIpc('chapters:apply-code-fix', chapterApplyCodeFixArgs, [
      rawChapterId,
      rawCode,
      rawFixed,
    ])
    const chapter = getChapter(chapterId)
    const source = chapter.formattedHtml ?? chapter.html ?? ''
    if (!source.trim()) throw new Error('这一章没有可理解的代码。')
    const replaced = replaceCodeBlock(source, code, fixed)
    if (!replaced.changed || !replaced.html) return { changed: false }
    const chars = saveChapterFormat(chapterId, replaced.html, chapter.removed)
    return { changed: true, html: replaced.html, chars }
  })

  ipcMain.handle('chapters:code-assist', async (_event, rawChapterId: unknown, rawCode: unknown, rawMode: unknown, rawLanguage: unknown) => {
    const [chapterId, code, mode, language] = parseIpc('chapters:code-assist', chapterCodeAssistArgs, [
      rawChapterId,
      rawCode,
      rawMode,
      rawLanguage,
    ])
    const chapter = getChapter(chapterId)
    const book = getBookSummary(chapter.bookId)
    const settings = getActiveSettings('notes')
    if (settings.provider === 'demo') throw new Error('演示模式不支持代码检查，请先配置真实模型。')
    const common = {
      config: settings,
      demo: false,
      code,
      language: language ?? '',
      chapterTitle: chapter.title,
      bookTitle: book?.title ?? '',
      signal: AbortSignal.timeout(120_000),
    }
    if (mode === 'review') {
      const text = await traceAsync(
        { step: 'code-review', scope: chapterId, model: settings.model, promptVersion: 'code-review-v1' },
        () => reviewCode(common),
      )
      return { mode, text, model: settings.model }
    }
    const source = chapter.formattedHtml ?? chapter.html ?? ''
    if (!source.trim()) throw new Error('这一章没有可理解的代码。')
    if (mode === 'fix') {
      const fixed = await traceAsync(
        { step: 'code-fix', scope: chapterId, model: settings.model, promptVersion: 'code-fix-v2' },
        () => fixCode(common),
      )
      return { mode, text: fixed, model: settings.model }
    }
    const text = await traceAsync(
      { step: 'code-explain', scope: chapterId, model: settings.model, promptVersion: 'code-explain-v1' },
      () => explainCode(common),
    )
    const inserted = insertCodeUnderstanding(source, code, text)
    const chars = inserted.html ? saveChapterFormat(chapterId, inserted.html, chapter.removed) : undefined
    return {
      mode,
      text,
      html: inserted.html,
      chars,
      understood: inserted.understood,
      skipped: inserted.skipped,
      model: settings.model,
    }
  })

  ipcMain.handle('chapters:format', async (event, rawChapterId: unknown, rawInstruction: unknown, rawOptions: unknown) => {
    const [chapterId, instruction, options] = parseIpc('chapters:format', chapterFormatArgs, [
      rawChapterId,
      rawInstruction,
      rawOptions,
    ])
    const previous = activeChapterFormats.get(chapterId)
    if (previous) {
      notifyPreviousTaskCancelled(event.sender)
      previous.abort()
    }
    const chapter = getChapter(chapterId)
    const controller = new AbortController()
    activeChapterFormats.set(chapterId, controller)
    const sender = event.sender
    const jobId = `ai-format:${chapterId}`
    const baseDetail = options?.skipReferences ? '正在排版（忽略参考文献）' : '正在排版'
    publishAiJob(sender, {
      id: jobId,
      kind: 'format',
      chapterId,
      bookId: chapter.bookId,
      title: chapter.title,
      status: 'running',
      detail: baseDetail,
      done: 0,
      total: 1,
      ...(options ? { formatOptions: options } : {}),
      updatedAt: new Date().toISOString(),
    })
    const startedAt = Date.now()
    const heartbeat = setInterval(() => {
      const seconds = Math.round((Date.now() - startedAt) / 1000)
      patchAiJob(sender, jobId, { detail: `${baseDetail} · 已用 ${seconds} 秒` })
    }, 15_000)
    try {
      const result = await formatChapterToDb(chapterId, instruction, controller.signal, options)
      const current = activeChapterFormats.get(chapterId) === controller
      if (current) {
        if (!sender.isDestroyed()) sender.send('chapter:formatted', result)
        patchAiJob(sender, jobId, {
          status: 'done',
          detail: `完成 · ${result.chars.toLocaleString()} 字`,
          done: 1,
          total: 1,
        })
      }
      return result
    } catch (error) {
      const current = activeChapterFormats.get(chapterId) === controller
      const aborted = controller.signal.aborted
      const message = aborted
        ? '排版已取消'
        : error instanceof Error
          ? error.message
          : String(error)
      if (current) {
        patchAiJob(sender, jobId, {
          status: aborted ? 'cancelled' : 'error',
          detail: message,
          error: aborted ? undefined : message,
        })
      }
      throw error
    } finally {
      clearInterval(heartbeat)
      if (activeChapterFormats.get(chapterId) === controller) activeChapterFormats.delete(chapterId)
    }
  })

  ipcMain.handle('chapters:format-book', (event, rawBookId: unknown, rawOptions: unknown) => {
    const [bookId, options] = parseIpc('chapters:format-book', bookFormatArgs, [rawBookId, rawOptions])
    if (activeFormat) notifyPreviousTaskCancelled(event.sender)
    activeFormat?.abort()
    activeFormat = null
    activeFormatBookId = null
    const book = getBookSummary(bookId)
    if (!book) throw new Error('找不到这本书。')
    const visible = getChapters(bookId).filter((chapter) => !chapter.hidden)
    const onlyMissing = options?.onlyMissing === true
    const allowed = Array.isArray(options?.chapterIds) ? new Set(options.chapterIds) : null
    const scope = allowed ? visible.filter((chapter) => allowed.has(chapter.id)) : visible
    const targets = onlyMissing
      ? scope.filter((chapter) => {
          try {
            return !getChapter(chapter.id).formattedHtml
          } catch {
            return false
          }
        })
      : scope
    // 整本排版接管目标章节：取消这些章节单独跑的排版，避免同一章并发写入。
    for (const chapter of targets) {
      const running = activeChapterFormats.get(chapter.id)
      if (!running) continue
      running.abort()
      activeChapterFormats.delete(chapter.id)
      patchAiJob(event.sender, `ai-format:${chapter.id}`, { status: 'cancelled', detail: '已并入整本排版' })
    }
    let skipped = scope.length - targets.length
    const controller = new AbortController()
    activeFormat = controller
    activeFormatBookId = bookId
    const sender = event.sender
    const send = (channel: string, payload: unknown): void => {
      if (!sender.isDestroyed()) sender.send(channel, payload)
    }

    void (async () => {
      const taskId = `format:${bookId}`
      upsertBackgroundTask({
        id: taskId,
        kind: 'format',
        bookId,
        targets: targets.map((chapter) => ({ id: chapter.id, title: chapter.title })),
        status: 'running',
      })
      let formatted = 0
      const failed: BookFormatDoneEvent['failed'] = []
      const startedAt = Date.now()
      let currentIndex = 0
      let currentId = ''
      let currentTitle = ''
      const heartbeat = setInterval(() => {
        if (controller.signal.aborted || !currentTitle) return
        const seconds = Math.round((Date.now() - startedAt) / 1000)
        send('book:format:progress', {
          bookId,
          chapterId: currentId,
          title: currentTitle,
          index: currentIndex,
          total: targets.length,
          status: 'start',
          done: Math.max(0, currentIndex - 1),
          message: `正在排版 · 已用 ${seconds} 秒`,
        } satisfies BookFormatProgress)
      }, 15_000)
      for (let index = 0; index < targets.length; index++) {
        if (controller.signal.aborted) break
        const meta = targets[index]!
        currentIndex = index + 1
        currentId = meta.id
        currentTitle = meta.title
        send('book:format:progress', {
          bookId,
          chapterId: meta.id,
          title: meta.title,
          index: index + 1,
          total: targets.length,
          status: 'start',
          done: index,
          message: '正在排版',
        } satisfies BookFormatProgress)
        try {
          const chapter = getChapter(meta.id)
          if (chapter.text.trim().length < 80) {
            skipped++
            currentTitle = ''
            send('book:format:progress', {
              bookId,
              chapterId: meta.id,
              title: meta.title,
              index: index + 1,
              total: targets.length,
              status: 'skipped',
              done: index + 1,
              message: '正文太短，已跳过',
            } satisfies BookFormatProgress)
            updateBackgroundTask(taskId, { done: index + 1, failures: failed })
            continue
          }
          const result = await formatChapterToDb(meta.id, undefined, controller.signal, {
            skipReferences: options?.skipReferences === true,
          })
          formatted++
          currentTitle = ''
          send('chapter:formatted', result)
          send('book:format:progress', {
            bookId,
            chapterId: meta.id,
            title: meta.title,
            index: index + 1,
            total: targets.length,
            status: 'done',
            done: index + 1,
          } satisfies BookFormatProgress)
          updateBackgroundTask(taskId, { done: index + 1, failures: failed })
        } catch (error) {
          currentTitle = ''
          if (controller.signal.aborted) break
          const message = error instanceof Error ? error.message : String(error)
          failed.push({ chapterId: meta.id, title: meta.title, message })
          send('book:format:progress', {
            bookId,
            chapterId: meta.id,
            title: meta.title,
            index: index + 1,
            total: targets.length,
            status: 'error',
            done: index + 1,
            message,
          } satisfies BookFormatProgress)
          updateBackgroundTask(taskId, { done: index + 1, failures: failed })
        }
      }
      clearInterval(heartbeat)
      // 被新的整本排版接管时，旧任务不要再覆盖新任务的进度。
      const superseded = activeFormat !== null && activeFormat !== controller
      if (!superseded) {
        updateBackgroundTask(taskId, {
          status: controller.signal.aborted ? 'paused' : failed.length > 0 ? 'error' : 'done',
          done: formatted + skipped + failed.length,
          failures: failed,
        })
        send('book:format:done', {
          bookId,
          formatted,
          skipped,
          failed,
          cancelled: controller.signal.aborted,
        } satisfies BookFormatDoneEvent)
      }
      if (activeFormat === controller) {
        activeFormat = null
        activeFormatBookId = null
      }
    })()
  })

  ipcMain.handle('chapters:format-cancel', (event, target?: AiJobCancelTarget) => {
    cancelFormats(target, event.sender)
  })

  ipcMain.handle('chapters:translate', (event, rawChapterId: unknown, rawOptions?: unknown) => {
    const [chapterId] = parseIpc('chapters:translate', chapterIdArgs, [rawChapterId])
    const force = Boolean(
      rawOptions && typeof rawOptions === 'object' && (rawOptions as { force?: unknown }).force === true,
    )
    const chapter = getChapter(chapterId)
    const book = getBookSummary(chapter.bookId)
    if (!book) throw new Error('找不到章节所属的书。')
    if (activeBookTranslations.has(chapter.bookId)) {
      throw new Error('全书翻译正在进行，请等它完成后再重试单章。')
    }
    if (!getBookTranslationInfo(chapter.bookId).foreign) {
      throw new Error('这本书看起来主要是中文，不需要翻译。')
    }
    if (!force && (chapter.translatedHtml?.trim() || chapter.translatedText?.trim())) {
      if (!event.sender.isDestroyed()) {
        event.sender.send('chapter:translated', {
          chapterId,
          text: chapter.translatedText ?? '',
          html: chapter.translatedHtml ?? '',
          translatedAt: chapter.translatedAt ?? new Date().toISOString(),
        })
      }
      return
    }

    const previous = activeTranslations.get(chapterId)
    previous?.abort()
    const controller = new AbortController()
    activeTranslations.set(chapterId, controller)
    const sender = event.sender
    const send = (channel: string, payload: unknown): void => {
      if (!sender.isDestroyed()) sender.send(channel, payload)
    }
    const jobId = `ai-translate:${chapterId}`
    publishAiJob(sender, {
      id: jobId,
      kind: 'translate',
      chapterId,
      bookId: chapter.bookId,
      title: chapter.title,
      status: 'running',
      detail: '准备翻译',
      done: 0,
      total: 0,
      updatedAt: new Date().toISOString(),
    })

    void (async () => {
      try {
        const result = await translateChapter({
          bookTitle: book.title,
          chapterTitle: chapter.title,
          html: chapter.formattedHtml ?? chapter.html ?? '',
          text: chapter.text,
          config: getActiveSettings('notes'),
          signal: controller.signal,
          onProgress: (done, total) => {
            if (activeTranslations.get(chapterId) !== controller) return
            send('chapter:translation:progress', { chapterId, done, total, message: `翻译 ${done}/${total}` })
            patchAiJob(sender, jobId, {
              detail: `翻译 ${done}/${total}`,
              done,
              total: Math.max(1, total),
            })
          },
        })
        if (controller.signal.aborted || activeTranslations.get(chapterId) !== controller) return
        const { translatedAt } = saveChapterTranslation(chapterId, result.html, result.text)
        send('chapter:translated', {
          chapterId,
          text: result.text,
          html: result.html,
          translatedAt,
        })
        patchAiJob(sender, jobId, {
          status: 'done',
          detail: `完成 · ${result.text.length.toLocaleString()} 字`,
          done: 1,
          total: 1,
        })
      } catch (error) {
        if (activeTranslations.get(chapterId) !== controller) return
        const aborted = controller.signal.aborted
        const message = aborted
          ? '翻译已取消'
          : error instanceof Error
            ? error.message
            : String(error)
        send('chapter:translation:error', { chapterId, message })
        patchAiJob(sender, jobId, {
          status: aborted ? 'cancelled' : 'error',
          detail: message,
          error: aborted ? undefined : message,
        })
      } finally {
        if (activeTranslations.get(chapterId) === controller) activeTranslations.delete(chapterId)
      }
    })()
  })

  ipcMain.handle('chapters:translate-cancel', (event, target?: AiJobCancelTarget) => {
    cancelTranslations(target, event.sender)
  })

  ipcMain.handle('books:translation-info', (_event, rawBookId: unknown) => {
    const [bookId] = parseIpc('books:translation-info', bookIdArgs, [rawBookId])
    return getBookTranslationInfo(bookId)
  })

  ipcMain.handle('books:translate', (event, rawBookId: unknown, rawOptions?: unknown) => {
    const [bookId, options] = parseIpc('books:translate', bookTranslateArgs, [rawBookId, rawOptions])
    const book = getBookSummary(bookId)
    if (!book) throw new Error('找不到这本书。')
    const info = getBookTranslationInfo(bookId)
    if (!info.foreign) throw new Error('这本书看起来主要是中文，不需要翻译。')

    const previous = activeBookTranslations.get(bookId)
    previous?.abort()
    const controller = new AbortController()
    activeBookTranslations.set(bookId, controller)
    const sender = event.sender
    const send = (channel: string, payload: unknown): void => {
      if (!sender.isDestroyed()) sender.send(channel, payload)
    }
    const taskId = `translate:${bookId}`
    const targets = selectTranslatableChapters(bookId, options).map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
    }))
    if (targets.length === 0) {
      activeBookTranslations.delete(bookId)
      throw new Error('没有可翻译的章节。')
    }
    upsertBackgroundTask({
      id: taskId,
      kind: 'translate',
      bookId,
      targets,
      status: 'running',
      done: 0,
      meta: { translateOptions: options ?? {} },
    })
    send('book:translation:progress', {
      bookId,
      title: book.title,
      done: 0,
      total: targets.length,
      translated: info.translated,
      message: '准备翻译',
    } satisfies BookTranslationProgress)

    void (async () => {
      try {
        const result = await runBookTranslation({
          bookId,
          options,
          signal: controller.signal,
          onProgress: (progress) => {
            if (activeBookTranslations.get(bookId) !== controller) return
            updateBackgroundTask(taskId, { status: 'running', done: progress.done })
            send('book:translation:progress', {
              bookId,
              title: book.title,
              done: progress.done,
              total: progress.total,
              translated: progress.translated,
              message: progress.message ?? progress.title,
            } satisfies BookTranslationProgress)
          },
          onChapterTranslated: (chapter) => {
            if (activeBookTranslations.get(bookId) !== controller) return
            send('chapter:translated', chapter)
          },
        })
        if (activeBookTranslations.get(bookId) !== controller) return
        updateBackgroundTask(taskId, {
          status: result.cancelled ? 'paused' : result.failed.length > 0 ? 'error' : 'done',
          done: result.translated + result.skipped + result.failed.length,
          failures: result.failed,
        })
        send('book:translation:done', {
          bookId,
          translated: result.translated,
          skipped: result.skipped,
          failed: result.failed,
          cancelled: result.cancelled,
        } satisfies BookTranslationDoneEvent)
      } catch (error) {
        if (activeBookTranslations.get(bookId) !== controller) return
        const aborted = controller.signal.aborted
        const message = aborted
          ? '翻译已取消'
          : error instanceof Error
            ? error.message
            : String(error)
        updateBackgroundTask(taskId, { status: aborted ? 'paused' : 'error' })
        send('book:translation:done', {
          bookId,
          translated: 0,
          skipped: 0,
          failed: [],
          cancelled: aborted,
          ...(aborted ? {} : { error: message }),
        } satisfies BookTranslationDoneEvent)
      } finally {
        if (activeBookTranslations.get(bookId) === controller) activeBookTranslations.delete(bookId)
      }
    })()
  })

  ipcMain.handle('ai:jobs-list', () => listAiJobs())

  ipcMain.handle('ai:job-state', (_event, chapterId: string) => ({
    notes: getAiJob(`ai-notes:${chapterId}`) ?? null,
    format: getAiJob(`ai-format:${chapterId}`) ?? null,
    translate: getAiJob(`ai-translate:${chapterId}`) ?? null,
  }))

  ipcMain.handle('ai:book-jobs', (_event, bookId: string) => ({
    compose: getAiJob(`ai-compose:${bookId}`) ?? null,
  }))

  ipcMain.handle('ai:job-dismiss', (_event, id: string) => {
    if (!dismissAiJob(id)) return
    deleteBackgroundTask(id)
  })

  ipcMain.handle('chapters:resetFormat', (_event, chapterId: string) => resetChapterFormat(chapterId))

  ipcMain.handle('books:reparse', async (event, rawBookId: unknown, rawOptions: unknown) => {
    const [bookId, options] = parseIpc('books:reparse', bookReparseArgs, [rawBookId, rawOptions])
    cancelNotesRuns({ bookId }, event.sender)
    cancelFormats({ bookId }, event.sender)
    cancelTranslations({ bookId }, event.sender)
    const record = getBookRecord(bookId)
    if (!record) throw new Error('找不到这本书')
    await autoBackup(`重新解析《${record.title}》前`)
    const parsed = await reparseBookFile(
      record,
      dataDir,
      {
        skipReferences: options?.skipReferences === true,
        deepPdf: options?.deepPdf === true,
      },
      (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('docling:progress', { ...progress, bookId })
      },
    )
    const chapters = classifyImportedChapters(parsed.chapters)
    return replaceBookChapters(bookId, { title: parsed.title, author: parsed.author, chapters })
  })

  ipcMain.handle('books:merge', async (_event, rawIds: unknown, rawTitle: unknown, rawAuthor: unknown) => {
    const [bookIds, title, author] = parseIpc('books:merge', mergeBooksArgs, [rawIds, rawTitle, rawAuthor])
    const ids = [...new Set(bookIds)]
    const target = getBookSummary(ids[0]!)
    if (!target) throw new Error('找不到要合并的第一本书。')
    await autoBackup(`合并 ${ids.length} 本书前`)
    const targetDir = path.join(dataDir, 'books', target.id)
    await fs.mkdir(targetDir, { recursive: true })
    // 先校验所有要删除的目录，避免合并成功后才发现某个 id 非法、留下半套数据。
    const removableDirs = ids.slice(1).map((id) => bookStorageDir(dataDir, id))
    const mergedText = ids
      .flatMap((id) => getChapters(id).map((chapter) => `# ${chapter.title}\n\n${getChapter(chapter.id).text}`))
      .join('\n\n')
    const mergedPath = path.join(targetDir, 'source-merged.txt')
    await fs.writeFile(mergedPath, mergedText, 'utf8')
    try {
      const merged = mergeBooks(ids, title ?? '', author ?? '', mergedPath)
      await Promise.all(removableDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
      return merged
    } catch (error) {
      await fs.rm(mergedPath, { force: true })
      throw error
    }
  })

  ipcMain.handle('books:split', async (_event, rawBookId: unknown, rawChapterId: unknown, rawTitle: unknown) => {
    const [bookId, fromChapterId, title] = parseIpc('books:split', splitBookArgs, [
      rawBookId,
      rawChapterId,
      rawTitle,
    ])
    const book = getBookSummary(bookId)
    if (!book) throw new Error('找不到这本书。')
    const chapters = getChapters(bookId)
    const splitIndex = chapters.findIndex((chapter) => chapter.id === fromChapterId)
    if (splitIndex <= 0 || splitIndex >= chapters.length) throw new Error('拆分点两侧都必须有章节。')
    await autoBackup(`拆分《${book.title}》前`)
    const newBookId = crypto.randomUUID()
    const bookDir = path.join(dataDir, 'books', newBookId)
    await fs.mkdir(bookDir, { recursive: true })
    const movedText = chapters
      .slice(splitIndex)
      .map((chapter) => `# ${chapter.title}\n\n${getChapter(chapter.id).text}`)
      .join('\n\n')
    const storedPath = path.join(bookDir, 'source.txt')
    await fs.writeFile(storedPath, movedText, 'utf8')
    const originalDir = path.join(dataDir, 'books', bookId)
    await fs.mkdir(originalDir, { recursive: true })
    const prefixPath = path.join(originalDir, 'source-split.txt')
    const prefixText = chapters
      .slice(0, splitIndex)
      .map((chapter) => `# ${chapter.title}\n\n${getChapter(chapter.id).text}`)
      .join('\n\n')
    await fs.writeFile(prefixPath, prefixText, 'utf8')
    try {
      return splitBook(bookId, fromChapterId, title ?? '', storedPath, newBookId, prefixPath)
    } catch (error) {
      await fs.rm(bookDir, { recursive: true, force: true })
      throw error
    }
  })

  ipcMain.handle('books:delete', async (event, rawBookId: unknown) => {
    const [bookId] = parseIpc('books:delete', bookIdArgs, [rawBookId])
    cancelNotesRuns({ bookId }, event.sender)
    cancelFormats({ bookId }, event.sender)
    cancelTranslations({ bookId }, event.sender)
    const record = getBookRecord(bookId)
    if (record) await autoBackup(`删除《${record.title}》前`)
    const payload = snapshotBookForTrash(bookId)
    if (!payload) throw new Error('这本书不存在。')
    const bookDir = bookStorageDir(dataDir, bookId)
    const trashDir = path.join(dataDir, 'trash', 'books', bookId)
    await fs.mkdir(path.dirname(trashDir), { recursive: true })
    await fs.rm(trashDir, { recursive: true, force: true }).catch(() => undefined)
    let moved = false
    try {
      await fs.rename(bookDir, trashDir)
      moved = true
    } catch {
      // 原始目录已经不存在时仍然保留数据库快照。
    }
    try {
      saveBookTrash(bookId, payload, path.relative(dataDir, trashDir))
      deleteBookRow(bookId)
    } catch (error) {
      if (moved) await fs.rename(trashDir, bookDir).catch(() => undefined)
      throw error
    }
  })

  ipcMain.handle('books:trash-list', () => listTrashedBooks())

  ipcMain.handle('books:trash-restore', async (_event, rawBookId: unknown) => {
    const [bookId] = parseIpc('books:trash-restore', bookIdArgs, [rawBookId])
    const book = restoreTrashedBook(bookId)
    if (!book) throw new Error('回收站里没有这本书，或原书已经存在。')
    const trashDir = path.join(dataDir, 'trash', 'books', bookId)
    const bookDir = bookStorageDir(dataDir, bookId)
    try {
      await fs.mkdir(path.dirname(bookDir), { recursive: true })
      await fs.rename(trashDir, bookDir)
    } catch {
      // 源文件可能已被清理；数据库行仍能恢复阅读和笔记。
    }
    return book
  })

  const removeTrashDir = async (relative: string): Promise<void> => {
    if (!relative.startsWith('trash/books/')) return
    const target = path.resolve(dataDir, relative)
    const root = path.resolve(dataDir, 'trash', 'books')
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) return
    await fs.rm(target, { recursive: true, force: true })
  }

  ipcMain.handle('books:trash-purge', async (_event, rawBookId: unknown) => {
    const [bookId] = parseIpc('books:trash-purge', bookIdArgs, [rawBookId])
    const relative = purgeTrashedBook(bookId)
    if (relative) await removeTrashDir(relative)
  })

  ipcMain.handle('books:trash-empty', async () => {
    const dirs = emptyBookTrash()
    await Promise.all(dirs.map((relative) => removeTrashDir(relative)))
  })

  ipcMain.handle('chapters:get', (_event, chapterId: string) => getChapter(chapterId))

  ipcMain.handle('books:progress', (_event, bookId: string, chapterId: string) => {
    setProgress(bookId, chapterId)
  })

  ipcMain.handle('reading:position-get', (_event, chapterId: string) =>
    typeof chapterId === 'string' ? getReadingPosition(chapterId) : null,
  )

  ipcMain.handle('reading:position-save', (_event, input: ReadingPositionInput) => {
    if (!input || typeof input !== 'object') throw new Error('阅读位置无效。')
    saveReadingPosition({
      bookId: String(input.bookId),
      chapterId: String(input.chapterId),
      scrollRatio: Number(input.scrollRatio),
      scrollTop: Number(input.scrollTop),
      page: input.page == null ? null : Number(input.page),
    })
  })

  ipcMain.handle('reading:page-save', (_event, chapterId: string, bookId: string, page: number) => {
    if (typeof chapterId !== 'string' || typeof bookId !== 'string') throw new Error('阅读页码无效。')
    saveReadingPage(chapterId, bookId, Number(page))
  })

  ipcMain.handle('reading:stats-get', () => getReadingStatsRecord())

  ipcMain.handle('reading:stats-merge', (_event, raw: unknown) => mergeReadingStatsRecord(raw))

  ipcMain.handle('reading:stats-record', (_event, day: string, seconds: number, bookId?: string | null) => {
    if (typeof day !== 'string') throw new Error('阅读日期无效。')
    recordReadingStats(day, Number(seconds), typeof bookId === 'string' ? bookId : null)
  })

  ipcMain.handle('settings:detect-local', async (): Promise<LocalModelDetection> => {
    const [ollama, lmstudio] = await Promise.all([
      listProviderModels({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' }),
      listProviderModels({ provider: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1' }),
    ])
    return { ollama: ollama.models, lmstudio: lmstudio.models }
  })

  ipcMain.handle('preferences:get', () => getUiPreferences())

  ipcMain.handle('preferences:save', (_event, patch: unknown) => {
    if (!patch || typeof patch !== 'object') throw new Error('偏好设置无效。')
    const input = patch as { autoNext?: unknown; dailyGoal?: unknown }
    return saveUiPreferences({
      ...(typeof input.autoNext === 'boolean' ? { autoNext: input.autoNext } : {}),
      ...(input.dailyGoal !== undefined ? { dailyGoal: Number(input.dailyGoal) } : {}),
    })
  })

  ipcMain.handle('weekly:save', (_event, input: { week: string; title: string; content: string }) => {
    if (!input || typeof input.week !== 'string' || typeof input.content !== 'string') {
      throw new Error('周复盘参数无效。')
    }
    return saveWeeklyReview({
      week: input.week,
      title: typeof input.title === 'string' ? input.title : '',
      content: input.content,
    })
  })

  ipcMain.handle('weekly:list', () => listWeeklyReviews())

  ipcMain.handle('bookmarks:list', (_event, bookId: string) =>
    typeof bookId === 'string' ? listBookmarks(bookId) : [],
  )

  ipcMain.handle('bookmarks:create', (_event, input: ReadingBookmarkDraft) => {
    if (!input || typeof input !== 'object') throw new Error('书签参数无效。')
    return createBookmark({
      bookId: String(input.bookId),
      chapterId: String(input.chapterId),
      scrollRatio: Number(input.scrollRatio),
      scrollTop: Number(input.scrollTop),
      page: input.page == null ? null : Number(input.page),
      label: String(input.label ?? '书签'),
      quote: input.quote == null ? null : String(input.quote),
    }) satisfies ReadingBookmark
  })

  ipcMain.handle('bookmarks:delete', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('书签无效。')
    deleteBookmark(id)
  })

  ipcMain.handle('books:file', async (_event, bookId: string) => {
    if (typeof bookId !== 'string') throw new Error('书籍参数无效。')
    const record = getBookRecord(bookId)
    if (!record || (record.format !== 'pdf' && record.format !== 'pdf-ocr')) {
      throw new Error('这本书没有可查看的原始 PDF。')
    }
    return new Uint8Array(await fs.readFile(record.filePath))
  })

  ipcMain.handle('tts:status', () => getTtsStatus())

  ipcMain.handle('tts:synthesize', async (_event, request: TtsSynthesisRequest) => {
    if (!request || typeof request !== 'object') throw new Error('语音参数无效。')
    return synthesizeTts(request)
  })

  ipcMain.handle('books:cover', async (_event, bookId: string) => {
    if (typeof bookId !== 'string') return null
    const stored = getBookCover(bookId)
    if (stored) return stored
    const record = getBookRecord(bookId)
    if (!record || record.format !== 'epub') return null
    try {
      const { parseEpub } = await import('./parsers/epub.js')
      const parsed = parseEpub(await fs.readFile(record.filePath), record.filePath)
      if (!parsed.cover) return null
      const coverPath = path.join(path.dirname(record.filePath), `cover${parsed.cover.extension}`)
      await fs.writeFile(coverPath, parsed.cover.data)
      updateBookCover(bookId, coverPath)
      return getBookCover(bookId)
    } catch {
      return null
    }
  })

  ipcMain.handle('chapters:classify', async (_event, bookId: string) => {
    const chapters = getChapters(bookId).map((chapter) => ({
      id: chapter.id,
      idx: chapter.idx,
      title: chapter.title,
      text: getChapter(chapter.id).text,
    }))
    return classifyChapters(chapters, getActiveSettings())
  })

  ipcMain.handle('chapters:flags', (_event, flags: ChapterFlag[]) => {
    applyChapterFlags(flags)
  })

  ipcMain.handle('chapters:delete', async (event, rawChapterIds: unknown) => {
    const [chapterIds] = parseIpc('chapters:delete', chapterIdsArgs, [rawChapterIds])
    for (const chapterId of chapterIds) {
      cancelNotesRuns({ chapterId }, event.sender)
      cancelFormats({ chapterId }, event.sender)
      cancelTranslations({ chapterId }, event.sender)
    }
    await autoBackup(`删除 ${chapterIds.length} 个章节前`)
    deleteChapters(chapterIds)
  })

  ipcMain.handle('chapters:trash-list', () => listTrashedChapters())

  ipcMain.handle('chapters:trash-restore', (_event, chapterId: string) => {
    if (typeof chapterId !== 'string') throw new Error('章节无效。')
    return restoreTrashedChapter(chapterId)
  })

  ipcMain.handle('chapters:trash-purge', (_event, chapterId: string) => {
    if (typeof chapterId !== 'string') throw new Error('章节无效。')
    purgeTrashedChapter(chapterId)
  })

  ipcMain.handle('chapters:trash-empty', () => emptyChapterTrash())

  ipcMain.handle('tasks:list', () => listBackgroundTasks())

  ipcMain.handle('library:search', async (_event, query: string) => {
    if (typeof query !== 'string') return []
    const term = query.replace(/\s+/g, ' ').trim()
    if (!term) return []
    return (await searchIndexAsync(term)) ?? searchLibrary(term)
  })

  ipcMain.handle('library:search-semantic', async (_event, query: string) => {
    if (typeof query !== 'string' || query.trim().length < 4) return []
    const semantic = await semanticSearchNotes(query, 12).catch(() => null)
    return (semantic ?? []).map((note) => ({
      type: 'note' as const,
      id: note.id,
      bookId: note.bookId,
      bookTitle: note.bookTitle,
      chapterId: note.chapterId,
      chapterTitle: note.chapterTitle,
      title: note.title,
      snippet: note.content.replace(/\s+/g, ' ').trim().slice(0, 180),
      updatedAt: null,
      source: 'semantic' as const,
      score: note.score,
    }))
  })

  ipcMain.handle('library:notes', (_event, filter?: LibraryFilter) =>
    listLibraryNotes(filter && typeof filter === 'object' ? filter : {}),
  )

  ipcMain.handle('library:notes-page', (_event, filter?: LibraryFilter) =>
    listLibraryNotesPage(filter && typeof filter === 'object' ? filter : {}),
  )

  ipcMain.handle('library:notes-audit', (_event, filter?: LibraryFilter) =>
    getLibraryNoteAudit(filter && typeof filter === 'object' ? filter : {}),
  )

  ipcMain.handle('library:tags', (_event, bookId?: string | null) =>
    listLibraryTags(typeof bookId === 'string' ? bookId : null),
  )

  ipcMain.handle('tutor:evaluate', async (_event, chapterId: string, explanation: string) => {
    if (typeof chapterId !== 'string' || typeof explanation !== 'string') throw new Error('解释无效。')
    const config = getActiveSettings()
    return traceAsync(
      { step: 'tutor-feynman', scope: chapterId, model: config.model, promptVersion: 'tutor-v1' },
      () =>
        evaluateExplanation({
          config,
          demo: isDemoMode(),
          context: tutorContextFor(chapterId),
          explanation,
        }),
    )
  })

  ipcMain.handle(
    'tutor:ask-stream',
    async (
      event,
      chapterId: string,
      question: string,
      history: ChatTurn[],
      mode: ChatMode,
      requestId: string,
    ) => {
      if (typeof chapterId !== 'string' || typeof question !== 'string') throw new Error('问题无效。')
      if (typeof requestId !== 'string') throw new Error('请求无效。')
      const send = (text: string): void => {
        if (!event.sender.isDestroyed()) event.sender.send('tutor:ask-delta', { id: requestId, text })
      }
      const config = getActiveSettings()
      return traceAsync(
        { step: 'tutor-ask', scope: chapterId, model: config.model, promptVersion: 'tutor-v1' },
        () =>
          askChapter(
            {
              config,
              demo: isDemoMode(),
              context: tutorContextFor(chapterId),
              question,
              history: Array.isArray(history) ? history : [],
              mode: mode === 'socratic' ? 'socratic' : 'answer',
            },
            send,
          ),
      )
    },
  )

  ipcMain.handle('tutor:evaluate-stream', async (event, chapterId: string, explanation: string, requestId: string) => {
    if (typeof chapterId !== 'string' || typeof explanation !== 'string') throw new Error('解释无效。')
    if (typeof requestId !== 'string') throw new Error('请求无效。')
    const send = (text: string): void => {
      if (!event.sender.isDestroyed()) event.sender.send('tutor:feynman-delta', { id: requestId, text })
    }
    const config = getActiveSettings()
    return traceAsync(
      { step: 'tutor-feynman', scope: chapterId, model: config.model, promptVersion: 'tutor-v1' },
      () =>
        evaluateExplanation(
          {
            config,
            demo: isDemoMode(),
            context: tutorContextFor(chapterId),
            explanation,
          },
          send,
        ),
    )
  })

  ipcMain.handle('reader:summary', async (_event, input: SessionSummaryInput) => {
    if (!input || typeof input.chapterId !== 'string') throw new Error('阅读小结参数无效。')
    const chapter = getChapter(input.chapterId)
    const book = getBookSummary(chapter.bookId)
    if (!book) throw new Error('找不到章节所属的书。')
    const minutes = Math.max(1, Math.min(24 * 60, Math.round(Number(input.minutes) || 1)))
    const config = getActiveSettings('notes')
    activeSummary?.abort()
    const controller = new AbortController()
    activeSummary = controller
    try {
      return await traceAsync(
        { step: 'reader-summary', scope: chapter.id, model: config.model, promptVersion: 'reader-summary-v2' },
        () =>
          generateSessionSummary({
            config,
            demo: isDemoMode(),
            bookTitle: book.title,
            chapterTitle: chapter.title,
            chapterText: chapter.text,
            notes: listNotes(chapter.bookId, chapter.id).slice(0, 24),
            minutes,
            signal: controller.signal,
          }),
      )
    } finally {
      if (activeSummary === controller) activeSummary = null
    }
  })

  ipcMain.handle('reader:summary-cancel', () => {
    activeSummary?.abort()
    activeSummary = null
  })

  ipcMain.handle('map:get', () => {
    const map = buildKnowledgeMap()
    if (!map.semanticReady && map.displayedNotes > 0) warmSemanticIndex()
    return map
  })

  ipcMain.handle('lab:run', async (event, request: LabRequest) => {
    if (!request || typeof request !== 'object') throw new Error('任务无效。')
    const config = getActiveSettings('lab')
    return traceAsync(
      { step: `lab-run:${request.tool}`, model: config.model, promptVersion: 'lab-v1' },
      () => runLab({ config, demo: isDemoMode(), request, signal: beginLabSignal(event.sender) }),
    )
  })

  ipcMain.handle('lab:chat-stream', async (event, request: LabRequest, history: ChatTurn[], requestId: string) => {
    if (!request || typeof request !== 'object') throw new Error('任务无效。')
    if (typeof requestId !== 'string') throw new Error('请求无效。')
    const config = getActiveSettings('lab')
    const send = (text: string): void => {
      if (!event.sender.isDestroyed()) event.sender.send('lab:chat-delta', { id: requestId, text })
    }
    return traceAsync(
      { step: `lab-chat:${request.tool}`, model: config.model, promptVersion: 'lab-chat-v1' },
      () =>
        labChat(
          {
            config,
            demo: isDemoMode(),
            request,
            history: Array.isArray(history) ? history : [],
            signal: beginLabSignal(event.sender),
          },
          send,
        ),
    )
  })

  ipcMain.handle('lab:margin-note', async (event, chapterId: string, quote: string) => {
    if (typeof chapterId !== 'string' || typeof quote !== 'string') throw new Error('边注参数无效。')
    const config = getActiveSettings('lab')
    return traceAsync(
      { step: 'lab-margin-note', scope: chapterId, model: config.model, promptVersion: 'lab-v1' },
      () => marginNote({ config, demo: isDemoMode(), chapterId, quote, signal: beginLabSignal(event.sender) }),
    )
  })

  ipcMain.handle('lab:quiz', async (event, chapterId: string) => {
    if (typeof chapterId !== 'string') throw new Error('章节无效。')
    const config = getActiveSettings('lab')
    return traceAsync(
      { step: 'lab-quiz', scope: chapterId, model: config.model, promptVersion: 'lab-quiz-v1' },
      () => generateQuiz({ config, demo: isDemoMode(), chapterId, signal: beginLabSignal(event.sender) }),
    )
  })

  ipcMain.handle('lab:quiz-check', async (event, chapterId: string, question: string, answer: string) => {
    if (typeof chapterId !== 'string' || typeof question !== 'string' || typeof answer !== 'string') {
      throw new Error('答案参数无效。')
    }
    const config = getActiveSettings('lab')
    return traceAsync(
      { step: 'lab-quiz-check', scope: chapterId, model: config.model, promptVersion: 'lab-quiz-v1' },
      () =>
        checkQuizAnswer({
          config,
          demo: isDemoMode(),
          chapterId,
          question,
          answer,
          signal: beginLabSignal(event.sender),
        }),
    )
  })

  ipcMain.handle('lab:concept-merges', async (event) => {
    const config = getActiveSettings('lab')
    return traceAsync(
      { step: 'lab-concept-merges', model: config.model, promptVersion: 'lab-v1' },
      () => suggestConceptMerges({ config, demo: isDemoMode(), signal: beginLabSignal(event.sender) }),
    )
  })

  ipcMain.handle('lab:merge-tags', async (_event, tags: string[], canonical: string) => {
    await autoBackup('合并概念标签前')
    return mergeNoteTags(Array.isArray(tags) ? tags : [], typeof canonical === 'string' ? canonical : '')
  })

  ipcMain.handle('lab:duplicates', () => findDuplicateNotes())

  ipcMain.handle('lab:merge-notes', async (_event, keepId: string, mergeId: string) => {
    if (typeof keepId !== 'string' || typeof mergeId !== 'string') throw new Error('卡片参数无效。')
    await autoBackup('合并卡片前')
    return mergeNotes(keepId, mergeId)
  })

  ipcMain.handle('lab:relation-graph', async (event, bookId: string) => {
    if (typeof bookId !== 'string') throw new Error('书籍无效。')
    const config = getActiveSettings('lab')
    const graph = await traceAsync(
      { step: 'lab-relation-graph', scope: bookId, model: config.model, promptVersion: 'relation-v2' },
      () =>
        generateRelationGraph({
          config,
          demo: isDemoMode(),
          bookId,
          signal: beginLabSignal(event.sender),
          onProgress: (stage) => {
            if (!event.sender.isDestroyed()) event.sender.send('relation:progress', { stage })
          },
        }),
    )
    saveLabArtifact({
      tool: 'relation-graph',
      scope: `book:${bookId}`,
      title: graph.title,
      content: JSON.stringify(graph),
      kind: 'graph',
      bookId,
      meta: JSON.stringify({ bookId, genre: graph.genre }),
    })
    return graph
  })

  ipcMain.handle('lab:pdf-page', async (event, bookId: string, page: number) => {
    if (typeof bookId !== 'string' || typeof page !== 'number') throw new Error('页面参数无效。')
    const config = getActiveSettings('lab')
    return traceAsync(
      { step: 'lab-pdf-page', scope: `${bookId}:${page}`, model: config.model, promptVersion: 'lab-v1' },
      () => analyzePdfPage({ config, demo: isDemoMode(), bookId, page, signal: beginLabSignal(event.sender) }),
    )
  })

  ipcMain.handle('lab:cancel', () => {
    activeLab?.abort()
    activeLab = null
  })

  ipcMain.handle('share:optimize-copy', async (_event, input: { title?: unknown; body?: unknown; kind?: unknown }) => {
    if (!input || typeof input !== 'object' || typeof input.body !== 'string') {
      throw new Error('文案参数无效。')
    }
    return optimizeShareCopy({
      config: getActiveSettings('notes'),
      demo: isDemoMode(),
      title: typeof input.title === 'string' ? input.title.slice(0, 120) : '',
      body: input.body.slice(0, 20_000),
      kind: typeof input.kind === 'string' ? input.kind.slice(0, 20) : undefined,
    })
  })

  ipcMain.handle('xhs:coverage', async (_event, input: XhsCoverageRequest) => {
    if (!input || typeof input !== 'object' || typeof input.bookId !== 'string') {
      throw new Error('覆盖检查参数无效。')
    }
    const book = getBookSummary(input.bookId)
    if (!book) throw new Error('找不到这本书。')
    const chapters = input.chapterId
      ? [getChapter(input.chapterId)]
      : getChapters(input.bookId)
          .filter((chapter) => !chapter.hidden)
          .map((chapter) => getChapter(chapter.id))
    return auditXhsCoverage({
      config: getActiveSettings('notes'),
      demo: isDemoMode(),
      bookTitle: book.title,
      chapters: chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        text: chapter.text,
      })),
      cards: Array.isArray(input.cards) ? input.cards : [],
    })
  })

  ipcMain.handle('lab:artifact-get', (_event, tool: string, scope?: string) =>
    typeof tool === 'string' ? getLabArtifact(tool, typeof scope === 'string' ? scope : 'latest') : null,
  )

  ipcMain.handle('lab:artifact-list', (_event, tool: string, limit?: number) =>
    typeof tool === 'string' ? listLabArtifacts(tool, typeof limit === 'number' ? limit : 30) : [],
  )

  ipcMain.handle('lab:artifact-save', (_event, rawInput: unknown) => {
    const [input] = parseIpc('lab:artifact-save', labArtifactArgs, [rawInput])
    return saveLabArtifact(input)
  })

  ipcMain.handle('lab:artifact-update', (_event, id: string, patch) => {
    if (typeof id !== 'string' || !patch || typeof patch !== 'object') throw new Error('生成内容参数无效。')
    return updateLabArtifact(id, patch)
  })

  ipcMain.handle('content:list', (_event, filter?: ContentFilter) =>
    listContent(filter && typeof filter === 'object' ? filter : {}),
  )

  ipcMain.handle('content:list-page', async (_event, filter?: ContentFilter) => {
    const safe = filter && typeof filter === 'object' ? filter : {}
    const query = safe.query?.trim()
    if (query) {
      const ids = await searchIndexIds(query, 'content')
      if (ids !== null) return listContentPage({ ...safe, query: undefined, ids })
    }
    return listContentPage(safe)
  })

  ipcMain.handle('content:get', (_event, id: string) => (typeof id === 'string' ? getContent(id) : null))

  ipcMain.handle('content:versions', (_event, tool: string, scope: string) =>
    typeof tool === 'string' && typeof scope === 'string' ? listContentVersions(tool, scope) : [],
  )

  ipcMain.handle('content:favorite', (_event, id: string, favorite: boolean) => {
    if (typeof id !== 'string' || typeof favorite !== 'boolean') throw new Error('收藏参数无效。')
    return setContentFavorite(id, favorite)
  })

  ipcMain.handle('content:status', (_event, id: string, status: ContentStatus) => {
    if (typeof id !== 'string') throw new Error('内容参数无效。')
    return setContentStatus(id, status)
  })

  ipcMain.handle('content:delete', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('内容参数无效。')
    deleteContent(id)
  })

  ipcMain.handle('content:apply', (_event, id: string, action: ContentApplyAction) => {
    if (typeof id !== 'string') throw new Error('内容参数无效。')
    return applyContent(id, action)
  })

  ipcMain.handle('content:purge', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('内容参数无效。')
    purgeContent(id)
  })

  ipcMain.handle('content:purge-all', () => purgeDeletedContent())

  ipcMain.handle('content:undo', (_event, token: string) => {
    if (typeof token !== 'string') throw new Error('撤销参数无效。')
    return undoContentApply(token)
  })

  ipcMain.handle('marks:list', (_event, chapterId: string) => {
    if (typeof chapterId !== 'string') return []
    return listChapterMarks(chapterId)
  })

  ipcMain.handle('marks:create', (_event, input: { chapterId: string; quote: string; style: 'highlight' | 'underline' | 'strikethrough' }) => {
    if (!input || typeof input.chapterId !== 'string' || typeof input.quote !== 'string') {
      throw new Error('标记参数无效。')
    }
    return createChapterMark(input)
  })

  ipcMain.handle('marks:delete', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('标记无效。')
    deleteChapterMark(id)
  })

  ipcMain.handle('notes:list', (_event, bookId: string, chapterId?: string | null) =>
    listNotes(bookId, chapterId ?? null),
  )

  ipcMain.handle('notes:export-markdown', async (_event, filter?: LibraryFilter) => {
    const win = getWindow()
    const options: OpenDialogOptions = {
      title: '导出笔记为 Markdown',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return { saved: false, path: null, count: 0, canceled: true }
    }
    return exportNotesMarkdown(result.filePaths[0]!, filter && typeof filter === 'object' ? filter : {})
  })

  ipcMain.handle('notes:related', async (_event, bookId: string, tags: string[], queryText?: string) => {
    try {
      const query = typeof queryText === 'string' ? queryText : ''
      // 回声只参考知识点/用户笔记；读薄稿和章节小结不是独立知识点。
      const semantic = await semanticRelatedNotes(bookId, query, 6, {
        excludeKinds: ['condensed', 'summary', 'question'],
      })
      if (semantic && semantic.length > 0) return semantic
      return listRelatedNotes(bookId, Array.isArray(tags) ? tags : [], 6, {
        excludeKinds: ['summary'],
      })
    } catch (error) {
      console.warn('[notes:related] 查询相关笔记失败', error instanceof Error ? error.message : error)
      return []
    }
  })

  ipcMain.handle('notes:create', (_event, rawDraft: unknown) => {
    const [draft] = parseIpc('notes:create', noteDraftArgs, [rawDraft])
    return createNote(draft)
  })

  ipcMain.handle('notes:update', (_event, rawNoteId: unknown, rawPatch: unknown) => {
    const [noteId, patch] = parseIpc('notes:update', notePatchArgs, [rawNoteId, rawPatch])
    return updateNote(noteId, patch)
  })

  ipcMain.handle('notes:delete', (_event, noteId: string) => {
    if (typeof noteId !== 'string') throw new Error('笔记无效。')
    return trashNote(noteId)
  })

  ipcMain.handle('notes:restore', (_event, noteId: string) => {
    if (typeof noteId !== 'string') throw new Error('笔记无效。')
    return restoreTrashedNote(noteId)
  })

  ipcMain.handle('notes:trash-list', () => listTrashedNotes())

  ipcMain.handle('notes:trash-purge', (_event, noteId: string) => {
    if (typeof noteId !== 'string') throw new Error('笔记无效。')
    purgeTrashedNote(noteId)
  })

  ipcMain.handle('notes:trash-empty', () => emptyNoteTrash())

  ipcMain.handle('notes:generate', (event, rawChapterId: unknown, rawOptions: unknown) => {
    const [chapterId, options] = parseIpc('notes:generate', notesGenerateArgs, [rawChapterId, rawOptions])
    const chapter = getChapter(chapterId)
    const book = getBookSummary(chapter.bookId)
    if (!book) throw new Error('找不到章节所属的书')

    const run = beginNotesRun(event, chapterId, `chapter:${chapterId}`, chapter.bookId)
    const jobId = `ai-notes:${chapterId}`
    publishAiJob(run.sender, {
      id: jobId,
      kind: 'notes',
      chapterId,
      bookId: chapter.bookId,
      title: chapter.title,
      status: 'running',
      detail: '准备中',
      done: 0,
      total: 0,
      updatedAt: new Date().toISOString(),
    })
    let lastDetail = '准备中'
    const startedAt = Date.now()
    const heartbeat = setInterval(() => {
      if (!run.isCurrent()) return
      const seconds = Math.round((Date.now() - startedAt) / 1000)
      patchAiJob(run.sender, jobId, { detail: `${lastDetail} · 已用 ${seconds} 秒` })
    }, 15_000)

    void (async () => {
      try {
        const result = await generateChapterToDb(
          chapterId,
          run.settings,
          run.controller.signal,
          (partial) => {
            if (!run.isCurrent()) return
            run.send('generation:partial', { chapterId, partial })
            const progress = partial.progress
            if (!progress) return
            const detail =
              progress.phase === 'condense'
                ? `读薄 ${progress.done}/${progress.total}`
                : progress.phase === 'cards'
                  ? `提炼知识点 · ${progress.cards} 张`
                  : `扩展 ${progress.done}/${progress.total}`
            lastDetail = detail
            patchAiJob(run.sender, jobId, {
              detail,
              done: progress.done,
              total: Math.max(1, progress.total),
              partial,
            })
          },
          { fresh: options?.fresh === true },
        )
        if (run.controller.signal.aborted || !run.isCurrent()) return
        const cards = result.notes.filter((note) => note.kind === 'point').length
        run.send('generation:done', { chapterId, notes: result.notes, report: result.report })
        patchAiJob(run.sender, jobId, {
          status: 'done',
          detail: `完成 · ${cards} 张知识点`,
          done: 1,
          total: 1,
          partial: undefined,
        })
      } catch (error) {
        if (!run.isCurrent()) return
        const aborted = run.controller.signal.aborted
        const message = aborted
          ? '生成已取消'
          : error instanceof Error
            ? error.message
            : String(error)
        run.send('generation:error', { chapterId, message })
        patchAiJob(run.sender, jobId, {
          status: aborted ? 'cancelled' : 'error',
          detail: message,
          error: aborted ? undefined : message,
        })
      } finally {
        clearInterval(heartbeat)
        run.release()
      }
    })()
  })

  ipcMain.handle('notes:generate-book', (event, rawBookId: unknown, rawOptions: unknown) => {
    const [bookId, options] = parseIpc('notes:generate-book', bookGenerateArgs, [rawBookId, rawOptions])
    const book = getBookSummary(bookId)
    if (!book) throw new Error('找不到这本书')

    const visible = getChapters(bookId).filter((chapter) => !chapter.hidden)
    const onlyMissing = options?.onlyMissing !== false
    const existing = new Set(
      listNotes(bookId)
        .filter((note) => note.kind === 'condensed' && note.chapterId && note.content.trim())
        .map((note) => note.chapterId as string),
    )
    const allowed = Array.isArray(options?.chapterIds) ? new Set(options.chapterIds) : null
    const scope = allowed ? visible.filter((chapter) => allowed.has(chapter.id)) : visible
    const targets = scope.filter((chapter) => !onlyMissing || !existing.has(chapter.id))
    const skippedByOption = scope.length - targets.length

    const run = beginNotesRun(event, '', `book:${bookId}`, bookId)
    const { settings, controller, send } = run
    let heartbeat: ReturnType<typeof setInterval> | null = null

    void (async () => {
      const taskId = `notes:${bookId}`
      upsertBackgroundTask({
        id: taskId,
        kind: 'notes',
        bookId,
        targets: targets.map((chapter) => ({ id: chapter.id, title: chapter.title })),
        status: 'running',
      })
      let generated = 0
      let skipped = 0
      const failed: BookGenerationDoneEvent['failed'] = []
      const startedAt = Date.now()
      let currentIndex = 0
      let currentId = ''
      let currentTitle = ''
      let currentDetail = ''
      heartbeat = setInterval(() => {
        if (controller.signal.aborted || !currentTitle) return
        const seconds = Math.round((Date.now() - startedAt) / 1000)
        send('book:generation:progress', {
          bookId,
          chapterId: currentId,
          title: currentTitle,
          index: currentIndex,
          total: targets.length,
          status: 'start',
          done: Math.max(0, currentIndex - 1),
          message: `${currentDetail || '正在生成'} · 已用 ${seconds} 秒`,
        } satisfies BookGenerationProgress)
      }, 15_000)
      for (let index = 0; index < targets.length; index++) {
        if (controller.signal.aborted) break
        const meta = targets[index]!
        currentIndex = index + 1
        currentId = meta.id
        currentTitle = meta.title
        currentDetail = '正在生成'
        send('book:generation:progress', {
          bookId,
          chapterId: meta.id,
          title: meta.title,
          index: index + 1,
          total: targets.length,
          status: 'start',
          done: index,
          message: currentDetail,
        } satisfies BookGenerationProgress)
        try {
          const content = getChapter(meta.id)
          if (content.text.trim().length < 80) {
            skipped++
            currentTitle = ''
            currentDetail = '正文太短，已跳过'
            send('book:generation:progress', {
              bookId,
              chapterId: meta.id,
              title: meta.title,
              index: index + 1,
              total: targets.length,
              status: 'skipped',
              done: index + 1,
              message: '正文太短，已跳过',
            } satisfies BookGenerationProgress)
            updateBackgroundTask(taskId, { done: index + 1, failures: failed })
            continue
          }
          const result = await generateChapterToDb(
            meta.id,
            settings,
            controller.signal,
            (partial) => {
              send('generation:partial', { chapterId: meta.id, partial })
              const progress = partial.progress
              if (!progress) return
              currentDetail =
                progress.phase === 'condense'
                  ? `读薄 ${progress.done}/${progress.total} 小节`
                  : progress.phase === 'cards'
                    ? `提炼知识点 · ${progress.cards} 张卡片`
                    : `扩展 ${progress.done}/${progress.total} 张卡片`
              send('book:generation:progress', {
                bookId,
                chapterId: meta.id,
                title: meta.title,
                index: index + 1,
                total: targets.length,
                status: 'start',
                done: index,
                message: currentDetail,
              } satisfies BookGenerationProgress)
            },
            { fresh: options?.onlyMissing === false },
          )
          generated++
          currentTitle = ''
          send('generation:done', { chapterId: meta.id, notes: result.notes, report: result.report })
          send('book:generation:progress', {
            bookId,
            chapterId: meta.id,
            title: meta.title,
            index: index + 1,
            total: targets.length,
            status: 'done',
            done: index + 1,
            notes: result.notes.length,
          } satisfies BookGenerationProgress)
          updateBackgroundTask(taskId, { done: index + 1, failures: failed })
        } catch (error) {
          currentTitle = ''
          if (controller.signal.aborted) {
            send('generation:error', { chapterId: meta.id, message: '生成已取消' })
            break
          }
          const message = error instanceof Error ? error.message : String(error)
          failed.push({ chapterId: meta.id, title: meta.title, message })
          send('generation:error', { chapterId: meta.id, message })
          send('book:generation:progress', {
            bookId,
            chapterId: meta.id,
            title: meta.title,
            index: index + 1,
            total: targets.length,
            status: 'error',
            done: index + 1,
            message,
          } satisfies BookGenerationProgress)
          updateBackgroundTask(taskId, { done: index + 1, failures: failed })
        }
      }
      if (!run.isSuperseded()) {
        updateBackgroundTask(taskId, {
          status: controller.signal.aborted ? 'paused' : failed.length > 0 ? 'error' : 'done',
          done: generated + skipped + failed.length,
          failures: failed,
        })
        send('book:generation:done', {
          bookId,
          generated,
          skipped,
          existing: skippedByOption,
          failed,
          cancelled: controller.signal.aborted,
        } satisfies BookGenerationDoneEvent)
      }
    })()
      .catch((error: unknown) => {
        // 任务初始化或收尾失败时也要给出最终事件，避免界面一直转圈。
        logErrorEvent('notes:generate-book', error instanceof Error ? error.message : String(error))
        send('book:generation:done', {
          bookId,
          generated: 0,
          skipped: 0,
          existing: 0,
          failed: [{ chapterId: '', title: book.title, message: error instanceof Error ? error.message : String(error) }],
          cancelled: false,
        } satisfies BookGenerationDoneEvent)
      })
      .finally(() => {
        if (heartbeat) clearInterval(heartbeat)
        run.release()
      })
  })

  ipcMain.handle('notes:cancel', (event, target?: AiJobCancelTarget) => {
    cancelNotesRuns(target, event.sender)
  })

  ipcMain.handle('notes:compare', async (event, input: CompareNotesInput) => {
    if (!input || typeof input.chapterId !== 'string' || typeof input.model !== 'string') {
      throw new Error('模型对比参数无效。')
    }
    if (isDemoMode()) throw new Error('演示模式不支持模型对比，请先配置真实模型。')
    const model = input.model.trim()
    if (!model) throw new Error('请填写对比模型 ID。')
    const chapter = getChapter(input.chapterId)
    const book = getBookSummary(chapter.bookId)
    if (!book) throw new Error('找不到章节所属的书。')
    const base = listContent({ tool: 'chapter-notes', chapterId: chapter.id, limit: 1 })[0]
    if (!base) throw new Error('这一章还没有生成过笔记，先生成一版再对比。')
    const config = { ...getActiveSettings('notes'), model }
    if (!config.apiKey && config.provider !== 'ollama' && config.provider !== 'lmstudio') throw new Error('对比模型还没有配置 API Key。')
    if (activeCompare) notifyPreviousTaskCancelled(event.sender)
    activeCompare?.abort()
    const controller = new AbortController()
    activeCompare = controller
    try {
      const result = await traceAsync(
        { step: 'notes-compare', scope: chapter.id, model, promptVersion: 'notes-compare-v1' },
        () =>
          generateChapterNotes(
            {
              bookTitle: book.title,
              chapterTitle: chapter.title,
              chapterText: chapter.text,
              chapterHtml: chapter.formattedHtml ?? chapter.html ?? '',
              config,
              genre: book.genre,
              mode: config.generationMode,
              visionMode: config.visionMode,
              lookupRelatedNotes: (concepts: string[]) =>
                listRelatedNotes(chapter.bookId, concepts, 4).map((item) => ({
                  bookTitle: item.bookTitle,
                  chapterTitle: item.chapterTitle ?? '',
                  title: item.title,
                  content: item.content.slice(0, 300),
                })),
              demo: false,
              cacheDir: path.join(app.getPath('userData'), 'notes-cache'),
              fresh: true,
            },
            () => undefined,
            controller.signal,
          ),
      )
      const artifact = saveLabArtifact({
        tool: 'chapter-notes',
        scope: `chapter:${chapter.id}`,
        title: `${book.title} · ${chapter.title} · 对比 ${model}`,
        kind: 'notes',
        bookId: chapter.bookId,
        chapterId: chapter.id,
        content: JSON.stringify({ notes: result.notes, report: result.report }),
        meta: JSON.stringify({ bookId: chapter.bookId, chapterId: chapter.id, chapterTitle: chapter.title, model }),
      })
      const compare = getContent(artifact.id)
      if (!compare) throw new Error('对比结果保存失败。')
      return { base, compare }
    } finally {
      if (activeCompare === controller) activeCompare = null
    }
  })

  ipcMain.handle('notes:expand', async (_event, rawNoteId: unknown) => {
    const [noteId] = parseIpc('notes:expand', noteIdArgs, [rawNoteId])
    const note = getNote(noteId)
    const chapter = note.chapterId ? getChapter(note.chapterId) : null
    const book = chapter ? getBookSummary(chapter.bookId) : null
    const hadDivergences = note.divergences.length > 0
    const relatedNotes = listRelatedNotes(note.bookId, note.tags, 4).map((item) => ({
      bookTitle: item.bookTitle,
      chapterTitle: item.chapterTitle ?? '',
      title: item.title,
      content: item.content.slice(0, 300),
    }))
    const divergences = await expandPoint({
      bookTitle: book?.title ?? '',
      chapterTitle: chapter?.title ?? '',
      point: note.content,
      quote: note.quote ?? '',
      section: note.section ?? '',
      config: getActiveSettings('notes'),
      relatedNotes,
    })
    saveNoteDivergences(noteId, divergences)
    if (!hadDivergences && divergences.length > 0 && chapter?.noteReport) {
      saveNoteReport(chapter.id, {
        ...chapter.noteReport,
        divergences: chapter.noteReport.divergences + divergences.length,
      })
    }
    return getNote(noteId)
  })

  ipcMain.handle('backup:create', () => createBackup(dataDir, 'manual'))

  ipcMain.handle('backup:list', () => listBackups(dataDir))

  ipcMain.handle('backup:delete', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('备份编号无效。')
    deleteBackup(dataDir, id)
  })

  ipcMain.handle('backup:export', async (_event, id: string): Promise<SaveFileResult> => {
    if (typeof id !== 'string') throw new Error('备份编号无效。')
    const info = listBackups(dataDir).find((item) => item.id === id)
    if (!info) throw new Error('找不到这个备份。')
    const win = getWindow()
    const options = {
      title: '导出备份',
      defaultPath: `ThinRead-backup-${info.createdAt.slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    const destination = result.filePath.toLowerCase().endsWith('.zip') ? result.filePath : `${result.filePath}.zip`
    exportBackup(dataDir, id, destination)
    return { saved: true, path: destination }
  })

  ipcMain.handle('backup:export-library', async (): Promise<SaveFileResult> => {
    const info = createBackup(dataDir, 'manual', '整库导出')
    const win = getWindow()
    const options = {
      title: '导出整库',
      defaultPath: `ThinRead-library-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    const destination = result.filePath.toLowerCase().endsWith('.zip') ? result.filePath : `${result.filePath}.zip`
    exportBackup(dataDir, info.id, destination)
    return { saved: true, path: destination }
  })

  ipcMain.handle('backup:import-library', async (): Promise<SaveFileResult> => {
    const win = getWindow()
    const options: OpenDialogOptions = {
      title: '导入整库',
      properties: ['openFile'],
      filters: [{ name: '页边整库包', extensions: ['zip'] }],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { saved: false, path: null }
    cancelAllAiJobs()
    const info = importBackupArchive(dataDir, result.filePaths[0]!)
    restoreBackup(dataDir, info.id, { safetyBackup: true })
    const window = getWindow()
    setTimeout(() => window?.webContents.reload(), 250)
    return { saved: true, path: result.filePaths[0]! }
  })

  ipcMain.handle('backup:open-dir', async () => {
    const dir = backupsDir(dataDir)
    await fs.mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })

  ipcMain.handle('app:export-diagnostics', async (): Promise<SaveFileResult> => {
    const win = getWindow()
    const options = {
      title: '导出诊断包',
      defaultPath: `ThinRead-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    const destination = result.filePath.toLowerCase().endsWith('.zip') ? result.filePath : `${result.filePath}.zip`
    const archive = buildDiagnosticsArchive(dataDir)
    await fs.writeFile(destination, Buffer.from(archive))
    return { saved: true, path: destination }
  })

  ipcMain.handle('app:log-renderer-error', (_event, report: RendererErrorReport) => {
    if (!report || typeof report !== 'object') return
    const scope = typeof report.scope === 'string' && report.scope.trim() ? report.scope.trim().slice(0, 60) : 'app'
    logErrorEvent(`renderer:${scope}`, String(report.message ?? '未知错误').slice(0, 2000), {
      ...(typeof report.stack === 'string' ? { stack: report.stack.slice(0, 6000) } : {}),
      ...(typeof report.componentStack === 'string'
        ? { componentStack: report.componentStack.slice(0, 4000) }
        : {}),
      ...(typeof report.url === 'string' ? { url: report.url.slice(0, 300) } : {}),
    })
  })

  ipcMain.handle('backup:restore', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('备份编号无效。')
    cancelAllAiJobs()
    await autoBackup('恢复备份前')
    restoreBackup(dataDir, id, { safetyBackup: true })
    const window = getWindow()
    setTimeout(() => window?.webContents.reload(), 250)
  })

  ipcMain.handle('settings:get', () => getSettingsView())

  ipcMain.handle('settings:save', (_event, patch: SettingsPatch) => saveSettings(patch))

  ipcMain.handle('app:set-lock', (_event, passcode: string | null) => {
    if (passcode !== null && typeof passcode !== 'string') throw new Error('应用锁密码无效。')
    return setAppLockPasscode(passcode)
  })

  ipcMain.handle('app:verify-lock', (_event, passcode: string) => {
    if (typeof passcode !== 'string') return false
    return verifyAppLockPasscode(passcode)
  })

  ipcMain.handle('settings:test', async (): Promise<TestResult> => {
    const settings = getActiveSettings()
    if (settings.provider === 'demo') {
      return { ok: true, message: '演示模式工作正常。配置真实模型后可校验引用与生成质量。' }
    }
    try {
      const model = createLanguageModel(settings)
      const result = await tracedGenerateText(
        {
          step: 'settings-test',
          provider: settings.provider,
          model: settings.model,
          promptVersion: 'settings-test-v1',
        },
        {
          model,
          prompt: '只回复四个字：连接成功',
          maxOutputTokens: 20,
          abortSignal: AbortSignal.timeout(25_000),
        },
      )
      return { ok: true, message: `连接成功：${result.text.trim().slice(0, 40) || '模型已响应'}` }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('ai:list-models', async (_event, input?: AiModelListInput) => {
    const provider = input?.provider ?? getActiveSettings().provider
    const apiKey = input?.apiKey?.trim() || getProviderApiKey(provider)
    return listProviderModels({
      provider,
      baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl : undefined,
      apiKey: apiKey ?? undefined,
    })
  })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir,
    demo: getSettingsView().demo,
    lockEnabled: getAppLockEnabled(),
  }))

  ipcMain.handle('app:open-data', async () => {
    await shell.openPath(dataDir)
  })

  ipcMain.handle(
    'book:compose',
    async (event, rawBookId: unknown, rawOptions: unknown): Promise<BookComposeResult> => {
      const [bookId, options] = parseIpc('book:compose', bookComposeArgs, [rawBookId, rawOptions])
      const previous = activeComposes.get(bookId)
      if (previous) {
        notifyPreviousTaskCancelled(event.sender)
        previous.abort()
      }
      const book = getBookSummary(bookId)
      if (!book) throw new Error('找不到这本书')
      const settings = getActiveSettings('compose')
      const notes = listNotes(bookId)
      const chapters = getChapters(bookId).filter((chapter) => !chapter.hidden)
      const sources = chapters.flatMap((chapter) => {
        const condensed = notes.find((note) => note.chapterId === chapter.id && note.kind === 'condensed')
        if (!condensed || !condensed.content.trim()) return []
        const cards = notes
          .filter((note) => note.chapterId === chapter.id && (note.kind === 'point' || note.kind === 'claim'))
          .map((note) => note.title)
          .filter(Boolean)
          .slice(0, 12)
        return [{ title: chapter.title, content: condensed.content.trim(), cards }]
      })
      if (sources.length === 0) throw new Error('这本书还没有读薄稿。先在「成书」里给章节生成笔记。')

      const controller = new AbortController()
      activeComposes.set(bookId, controller)
      const sender = event.sender
      const send = (channel: string, payload: unknown): void => {
        if (!sender.isDestroyed()) sender.send(channel, payload)
      }
      const jobId = `ai-compose:${bookId}`
      const publish = (patch: Partial<AiJobSnapshot>): void => {
        if (activeComposes.get(bookId) !== controller) return
        patchAiJob(sender, jobId, patch)
      }
      publishAiJob(sender, {
        id: jobId,
        kind: 'compose',
        chapterId: '',
        bookId,
        title: book.title,
        status: 'running',
        detail: '正在收齐读薄稿',
        done: 0,
        total: 0,
        composeOptions: {
          length: options?.length === 'full' ? 'full' : 'tight',
          voice: options?.voice === 'sharp' ? 'sharp' : options?.voice === 'personal' ? 'personal' : 'calm',
        },
        updatedAt: new Date().toISOString(),
      })
      // 模型一次请求可能跑一两分钟；心跳让界面知道任务还在推进，而不是卡死。
      let lastProgress: BookComposeProgress | null = null
      const startedAt = Date.now()
      const heartbeat = setInterval(() => {
        if (activeComposes.get(bookId) !== controller || !lastProgress) return
        const seconds = Math.round((Date.now() - startedAt) / 1000)
        const progress: BookComposeProgress = {
          ...lastProgress,
          message: `${lastProgress.message} · 已用 ${seconds} 秒`,
        }
        send('book:compose:progress', progress)
        publish({ detail: progress.message, composeProgress: progress })
      }, 15_000)
      try {
        const result = await traceAsync(
          {
            step: 'book-compose',
            scope: bookId,
            model: settings.model,
            promptVersion: settings.generationMode === 'deep' ? 'compose-v5-deep' : 'compose-v5',
          },
          () =>
            composeBook({
              bookTitle: book.title,
              author: book.author,
              sources,
              options: {
                length: options?.length === 'full' ? 'full' : 'tight',
                voice: options?.voice === 'sharp' ? 'sharp' : options?.voice === 'personal' ? 'personal' : 'calm',
              },
              genre: book.genre,
              mode: settings.generationMode,
              config: settings,
              demo: settings.provider === 'demo',
              signal: controller.signal,
              cacheDir: path.join(app.getPath('userData'), 'notes-cache'),
              onProgress: (progress) => {
                lastProgress = progress
                send('book:compose:progress', progress)
                publish({
                  detail: progress.message,
                  done: progress.done,
                  total: progress.total,
                  composeProgress: progress,
                })
              },
            }),
        )
        saveLabArtifact({
          tool: 'book-compose',
          scope: `book:${bookId}`,
          title: result.title,
          content: JSON.stringify(result),
        })
        publish({
          status: 'done',
          detail: `完成 · ${result.outputChars.toLocaleString()} 字`,
          done: 1,
          total: 1,
          composeProgress: undefined,
        })
        return result
      } catch (error) {
        const aborted = controller.signal.aborted
        const message = aborted
          ? '已取消合并'
          : error instanceof Error
            ? error.message
            : String(error)
        publish({
          status: aborted ? 'cancelled' : 'error',
          detail: message,
          error: aborted ? undefined : message,
          composeProgress: undefined,
        })
        throw error
      } finally {
        clearInterval(heartbeat)
        if (activeComposes.get(bookId) === controller) activeComposes.delete(bookId)
      }
    },
  )

  ipcMain.handle('book:compose-cancel', (event, target?: AiJobCancelTarget) => {
    cancelComposeRuns(target, event.sender)
  })

  ipcMain.handle('book:compose-compare', async (event, input: CompareComposeInput) => {
    if (!input || typeof input.bookId !== 'string' || typeof input.model !== 'string') {
      throw new Error('成稿对比参数无效。')
    }
    if (isDemoMode()) throw new Error('演示模式不支持模型对比，请先配置真实模型。')
    const model = input.model.trim()
    if (!model) throw new Error('请填写对比模型 ID。')
    const book = getBookSummary(input.bookId)
    if (!book) throw new Error('找不到这本书。')
    const base = listContent({ tool: 'book-compose', bookId: book.id, limit: 1 })[0]
    if (!base) throw new Error('这本书还没有成稿，先生成一版再对比。')
    const settings = { ...getActiveSettings('compose'), model }
    if (!settings.apiKey && settings.provider !== 'ollama' && settings.provider !== 'lmstudio') throw new Error('对比模型还没有配置 API Key。')
    const notes = listNotes(book.id)
    const chapters = getChapters(book.id).filter((chapter) => !chapter.hidden)
    const sources = chapters.flatMap((chapter) => {
      const condensed = notes.find((note) => note.chapterId === chapter.id && note.kind === 'condensed')
      if (!condensed || !condensed.content.trim()) return []
      const cards = notes
        .filter((note) => note.chapterId === chapter.id && (note.kind === 'point' || note.kind === 'claim'))
        .map((note) => note.title)
        .filter(Boolean)
        .slice(0, 12)
      return [{ title: chapter.title, content: condensed.content.trim(), cards }]
    })
    if (sources.length === 0) throw new Error('这本书还没有读薄稿。先给章节生成笔记。')
    if (activeComposeCompare) notifyPreviousTaskCancelled(event.sender)
    activeComposeCompare?.abort()
    const controller = new AbortController()
    activeComposeCompare = controller
    try {
      const result = await traceAsync(
        {
          step: 'book-compose-compare',
          scope: book.id,
          model,
          promptVersion: settings.generationMode === 'deep' ? 'compose-v5-deep' : 'compose-v5',
        },
        () =>
          composeBook({
            bookTitle: book.title,
            author: book.author,
            sources,
            options: {
              length: input.options?.length === 'full' ? 'full' : 'tight',
              voice:
                input.options?.voice === 'sharp'
                  ? 'sharp'
                  : input.options?.voice === 'personal'
                    ? 'personal'
                    : 'calm',
            },
            genre: book.genre,
            mode: settings.generationMode,
            config: settings,
            demo: false,
            signal: controller.signal,
            cacheDir: path.join(app.getPath('userData'), 'notes-cache'),
            onProgress: () => undefined,
          }),
      )
      const artifact = saveLabArtifact({
        tool: 'book-compose',
        scope: `book:${book.id}`,
        title: `${result.title} · 对比 ${model}`,
        content: JSON.stringify(result),
        meta: JSON.stringify({ bookId: book.id, model }),
      })
      const compare = getContent(artifact.id)
      if (!compare) throw new Error('对比结果保存失败。')
      return { base, compare }
    } finally {
      if (activeComposeCompare === controller) activeComposeCompare = null
    }
  })

  ipcMain.handle('compose:rewrite-section', async (event, input: ComposeSectionRewriteInput) => {
    if (!input || typeof input !== 'object') throw new Error('重写参数无效。')
    if (typeof input.bookId !== 'string' || typeof input.fullText !== 'string') {
      throw new Error('重写参数无效。')
    }
    const fullText = input.fullText.slice(0, 200_000)
    const start = Math.max(0, Math.min(fullText.length, Math.floor(Number(input.start) || 0)))
    const end = Math.max(start, Math.min(fullText.length, Math.floor(Number(input.end) || 0)))
    if (end <= start) throw new Error('先选中要重写的文字。')
    const book = getBookSummary(input.bookId)
    if (!book) throw new Error('找不到这本书。')
    const config = getActiveSettings('compose')
    if (activeSection) notifyPreviousTaskCancelled(event.sender)
    activeSection?.abort()
    const controller = new AbortController()
    activeSection = controller
    try {
      return await traceAsync(
        { step: 'compose-section-rewrite', scope: input.bookId, model: config.model, promptVersion: 'section-rewrite-v1' },
        () =>
          rewriteComposeSection({
            config,
            demo: isDemoMode(),
            bookTitle: book.title,
            fullText,
            start,
            end,
            signal: controller.signal,
          }),
      )
    } finally {
      if (activeSection === controller) activeSection = null
    }
  })

  ipcMain.handle('compose:rewrite-section-cancel', () => {
    activeSection?.abort()
    activeSection = null
  })

  ipcMain.handle('app:notify', (_event, rawTitle: unknown, rawBody: unknown) => {
    if (typeof rawTitle !== 'string' || typeof rawBody !== 'string') return
    if (!Notification.isSupported()) return
    new Notification({ title: rawTitle.slice(0, 80), body: rawBody.slice(0, 240) }).show()
  })

  ipcMain.handle('app:copy-text', (_event, text: string) => {
    if (typeof text !== 'string') throw new Error('复制内容无效。')
    clipboard.writeText(text)
  })

  ipcMain.handle(
    'app:save-text-file',
    async (_event, rawName: unknown, rawContent: unknown, rawExtension: unknown): Promise<SaveFileResult> => {
      const [defaultName, content, extension] = parseIpc('app:save-text-file', saveTextFileArgs, [
        rawName,
        rawContent,
        rawExtension,
      ])
      const win = getWindow()
      const filter =
        extension === 'bib'
          ? { name: 'BibTeX', extensions: ['bib'] }
          : extension === 'ris'
            ? { name: 'RIS', extensions: ['ris'] }
            : { name: '文本', extensions: ['txt'] }
      const suggested = path.basename(
        typeof defaultName === 'string' && defaultName.trim() ? defaultName : `citation.${extension}`,
      )
      const withExtension = suggested.toLowerCase().endsWith(`.${extension}`)
        ? suggested
        : `${suggested}.${extension}`
      const options = {
        title: '导出引用',
        defaultPath: withExtension,
        filters: [filter],
      }
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { saved: false, path: null }
      const filePath = result.filePath.toLowerCase().endsWith(`.${extension}`)
        ? result.filePath
        : `${result.filePath}.${extension}`
      await fs.writeFile(filePath, content, 'utf8')
      return { saved: true, path: filePath }
    },
  )

  ipcMain.handle('app:save-markdown', async (_event, rawName: unknown, rawContent: unknown): Promise<SaveFileResult> => {
    const [defaultName, content] = parseIpc('app:save-markdown', saveTextArgs, [rawName, rawContent])
    const win = getWindow()
    const suggested = path.basename(typeof defaultName === 'string' && defaultName.trim() ? defaultName : 'reading-note.md')
    const options = {
      title: '导出读薄稿',
      defaultPath: suggested.endsWith('.md') ? suggested : `${suggested}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    const filePath = path.extname(result.filePath).toLowerCase() === '.md' ? result.filePath : `${result.filePath}.md`
    await fs.writeFile(filePath, content, 'utf8')
    return { saved: true, path: filePath }
  })

  ipcMain.handle('app:save-image', async (_event, dataUrl: string, defaultName: string): Promise<SaveFileResult> => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error('图片数据无效。')
    }
    const win = getWindow()
    const suggested = path.basename(typeof defaultName === 'string' && defaultName.trim() ? defaultName : 'reading-card.png')
    const options = {
      title: '保存分享卡',
      defaultPath: suggested.endsWith('.png') ? suggested : `${suggested}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    const filePath = path.extname(result.filePath).toLowerCase() === '.png' ? result.filePath : `${result.filePath}.png`
    await fs.writeFile(filePath, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'))
    return { saved: true, path: filePath }
  })
  ipcMain.handle('app:save-audio', async (_event, base64: string, defaultName: string): Promise<SaveFileResult> => {
    if (typeof base64 !== 'string' || !base64.trim()) throw new Error('音频数据无效。')
    const buffer = Buffer.from(base64, 'base64')
    if (buffer.length === 0) throw new Error('音频数据为空。')
    const win = getWindow()
    const suggested = path.basename(typeof defaultName === 'string' && defaultName.trim() ? defaultName : 'reading-audio.wav')
    const wantsMp3 = suggested.toLowerCase().endsWith('.mp3')
    const extension = wantsMp3 ? 'mp3' : 'wav'
    const options = {
      title: '保存整章音频',
      defaultPath: suggested.toLowerCase().endsWith(`.${extension}`) ? suggested : `${suggested}.${extension}`,
      filters: wantsMp3 ? [{ name: 'MP3', extensions: ['mp3'] }] : [{ name: 'WAV', extensions: ['wav'] }],
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    const filePath =
      path.extname(result.filePath).toLowerCase() === `.${extension}` ? result.filePath : `${result.filePath}.${extension}`
    await fs.writeFile(filePath, buffer)
    return { saved: true, path: filePath }
  })

  ipcMain.handle(
    'app:save-images',
    async (_event, images: unknown, defaultDirName: string): Promise<SaveImagesResult> => {
      if (!Array.isArray(images) || images.length === 0 || images.length > 100) {
        throw new Error('图片列表无效。')
      }
      const validated = images.map((item, index) => {
        if (!item || typeof item !== 'object') throw new Error('图片数据无效。')
        const dataUrl = (item as { dataUrl?: unknown }).dataUrl
        const name = (item as { name?: unknown }).name
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
          throw new Error('图片数据无效。')
        }
        const raw = typeof name === 'string' && name.trim() ? path.basename(name.trim()) : `page-${index + 1}.png`
        const safe = raw.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
        return {
          dataUrl,
          name: safe.toLowerCase().endsWith('.png') ? safe : `${safe || `page-${index + 1}`}.png`,
        }
      })
      const win = getWindow()
      const options: OpenDialogOptions = {
        title: '选择小红书图文的保存文件夹',
        properties: ['openDirectory', 'createDirectory'],
      }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return { saved: false, path: null, count: 0 }
      const folder = (typeof defaultDirName === 'string' ? defaultDirName : '')
        .replace(/[\\/:*?"<>|#%{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40)
      const dir = path.join(result.filePaths[0]!, folder || '页边-小红书')
      await fs.mkdir(dir, { recursive: true })
      for (const item of validated) {
        await fs.writeFile(path.join(dir, item.name), Buffer.from(item.dataUrl.slice('data:image/png;base64,'.length), 'base64'))
      }
      return { saved: true, path: dir, count: validated.length }
    },
  )

  ipcMain.handle('app:copy-image', async (_event, dataUrl: string) => {
    if (typeof dataUrl !== 'string' || !/^data:image\//i.test(dataUrl)) {
      throw new Error('图片数据无效。')
    }
    let image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) {
      // nativeImage 对 SVG/部分 WebP 支持不稳定，用 canvas 先栅格化再写入剪贴板。
      try {
        const match = /^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i.exec(dataUrl)
        if (!match) throw new Error('unsupported image data')
        const { createCanvas, loadImage } = await import('@napi-rs/canvas')
        const source = await loadImage(Buffer.from(match[1]!, 'base64'))
        const canvas = createCanvas(source.width, source.height)
        const context = canvas.getContext('2d')
        context.drawImage(source, 0, 0)
        image = nativeImage.createFromBuffer(canvas.toBuffer('image/png'))
      } catch {
        image = nativeImage.createEmpty()
      }
    }
    if (image.isEmpty()) throw new Error('图片格式不支持复制。')
    const png = image.toPNG()
    await clipboard.write([
      new ClipboardItem({
        'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }),
      }),
    ])
  })

  ipcMain.handle('app:save-binary', async (_event, defaultName: string, base64: string): Promise<SaveFileResult> => {
    if (typeof base64 !== 'string' || !base64.trim()) throw new Error('导出内容无效。')
    const buffer = Buffer.from(base64, 'base64')
    if (buffer.length === 0) throw new Error('导出内容为空。')
    const win = getWindow()
    const suggested = path.basename(typeof defaultName === 'string' && defaultName.trim() ? defaultName : 'reading-notes.zip')
    const options = {
      title: '导出发布包',
      defaultPath: suggested.toLowerCase().endsWith('.zip') ? suggested : `${suggested}.zip`,
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    const filePath = path.extname(result.filePath).toLowerCase() === '.zip' ? result.filePath : `${result.filePath}.zip`
    await fs.writeFile(filePath, buffer)
    return { saved: true, path: filePath }
  })

  ipcMain.handle('app:save-html', async (_event, rawName: unknown, rawContent: unknown): Promise<SaveFileResult> => {
    const [defaultName, content] = parseIpc('app:save-html', saveTextArgs, [rawName, rawContent])
    const win = getWindow()
    const suggested = path.basename(typeof defaultName === 'string' && defaultName.trim() ? defaultName : 'reading-note.html')
    const options = {
      title: '导出博客分享页',
      defaultPath: suggested.toLowerCase().endsWith('.html') ? suggested : `${suggested}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    const filePath = path.extname(result.filePath).toLowerCase() === '.html' ? result.filePath : `${result.filePath}.html`
    await fs.writeFile(filePath, content, 'utf8')
    return { saved: true, path: filePath }
  })

  ipcMain.handle('app:save-pdf', async (_event, rawName: unknown, rawHtml: unknown): Promise<SaveFileResult> => {
    const [defaultName, html] = parseIpc('app:save-pdf', saveTextArgs, [rawName, rawHtml])
    if (!html.trim()) throw new Error('导出内容无效。')
    const win = getWindow()
    const suggested = path.basename(typeof defaultName === 'string' && defaultName.trim() ? defaultName : 'reading-note.pdf')
    const options = {
      title: '导出排版 PDF',
      defaultPath: suggested.toLowerCase().endsWith('.pdf') ? suggested : `${suggested}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    const filePath = path.extname(result.filePath).toLowerCase() === '.pdf' ? result.filePath : `${result.filePath}.pdf`
    await fs.writeFile(filePath, await renderHtmlToPdf(html))
    return { saved: true, path: filePath }
  })


  registerExtrasIpc({ getWindow, dataDir, cancelAllAiJobs })
}
