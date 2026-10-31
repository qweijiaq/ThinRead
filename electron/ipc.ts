import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { app, BrowserWindow, ClipboardItem, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { generateText } from 'ai'

import { backupsDir, createBackup, deleteBackup, exportBackup, listBackups, restoreBackup } from './backup.js'

import {
  applyChapterFlags,
  applyContent,
  createChapterMark,
  createNote,
  createOcrJob,
  getOcrJob,
  listOcrJobs,
  updateOcrJob,
  deleteChapterMark,
  deleteContent,
  deleteChapters,
  deleteNote,
  deleteBook as deleteBookRow,
  getBookCover,
  getBookRecord,
  updateBookCover,
  getBookStyle,
  getBookSummary,
  mergeBooks,
  splitBook,
  getChapter,
  getChapters,
  getContent,
  getLabArtifact,
  getNote,
  listLabArtifacts,
  listBooks,
  listChapterMarks,
  listContent,
  listLibraryNotes,
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
  saveLabArtifact,
  setBookGenre,
  setContentFavorite,
  setContentStatus,
  updateLabArtifact,
  saveNoteDivergences,
  saveNoteReport,
  searchLibrary,
  setProgress,
  updateNote,
} from './db.js'
import { classifyChapters } from './ai/classify.js'
import { formatChapter as formatChapterWithAI } from './ai/format.js'
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
import { expandPoint, generateChapterNotes } from './ai/notes.js'
import { createLanguageModel } from './ai/provider.js'
import { askChapter, evaluateExplanation } from './ai/tutor.js'
import { classifyImportedChapters, importBookFile, importHighlightEntries, importHighlightsFile, importScannedPdf, importTextBook, importUrlBook, reparseBookFile } from './import.js'
import { buildKnowledgeMap } from './knowledge-map.js'
import { configureSemantic, semanticRelatedNotes, warmSemanticIndex } from './semantic.js'
import { getActiveSettings, getReadwiseToken, getSettingsView, isDemoMode, saveSettings } from './settings.js'
import { fetchReadwiseEntries } from './readwise.js'
import { searchIndex } from './search-index.js'
import type {
  BookComposeOptions,
  BookComposeResult,
  BookFormatDoneEvent,
  BookFormatOptions,
  BookFormatProgress,
  BookGenre,
  FormatResult,
  BookGenerationDoneEvent,
  BookGenerationOptions,
  BookGenerationProgress,
  ChapterFlag,
  ChatMode,
  ContentApplyAction,
  ContentFilter,
  ContentKind,
  ContentStatus,
  ChatTurn,
  GeneratePartial,
  HighlightImportResult,
  LabRequest,
  LibraryFilter,
  Note,
  NoteDraft,
  NotePatch,
  NoteReport,
  OcrDoneEvent,
  OcrErrorEvent,
  OcrImportOptions,
  OcrImportStarted,
  ReaderStyle,
  SaveFileResult,
  SettingsPatch,
  TestResult,
  TextImportInput,
} from '../shared/types.js'
import type { TutorContext } from './ai/tutor.js'

interface ActiveGeneration {
  chapterId: string
  controller: AbortController
}

let active: ActiveGeneration | null = null
let composeActive: AbortController | null = null
let activeFormat: AbortController | null = null
let activeOcr: { controller: AbortController; fileName: string; jobId: string } | null = null

async function generateChapterToDb(
  chapterId: string,
  settings: ReturnType<typeof getActiveSettings>,
  signal: AbortSignal,
  onPartial: (partial: GeneratePartial) => void,
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
      lookupRelatedNotes: (concepts: string[]) =>
        listRelatedNotes(chapter.bookId, concepts, 4).map((item) => ({
          bookTitle: item.bookTitle,
          chapterTitle: item.chapterTitle ?? '',
          title: item.title,
          content: item.content.slice(0, 300),
        })),
      demo: settings.provider === 'demo',
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
): Promise<FormatResult> {
  const chapter = getChapter(chapterId)
  const style = getBookStyle(chapter.bookId)
  const result = await formatChapterWithAI({
    chapterTitle: chapter.title,
    html: formatSourceHtml(chapter),
    originalText: chapter.text,
    currentHtml: chapter.formattedHtml,
    currentRemoved: chapter.removed,
    instruction,
    style,
    config: getActiveSettings(),
    signal,
  })
  if (signal?.aborted) throw new Error('排版已取消')
  saveChapterFormat(chapterId, result.html, result.removed)
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

  ipcMain.handle('books:import', async () => {
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

    return importBookFile(result.filePaths[0]!, dataDir)
  })

  ipcMain.handle('books:import-text', async (_event, input: TextImportInput) => {
    if (!input || typeof input !== 'object' || typeof input.text !== 'string') {
      throw new Error('文本导入参数无效。')
    }
    return importTextBook(input, dataDir)
  })

  ipcMain.handle('books:import-url', async (_event, url: string) => {
    if (typeof url !== 'string') throw new Error('网址无效。')
    return importUrlBook(url, dataDir)
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
    const results: string[] = []
    for (const scheme of ['Token', 'Bearer']) {
      try {
        const response = await fetch('https://readwise.io/api/v2/auth/', {
          headers: { Authorization: `${scheme} ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(20_000),
        })
        results.push(`${scheme}: HTTP ${response.status}`)
        if (response.status === 204 || response.status === 200) {
          return { ok: true, message: `Readwise 连接成功（${scheme}）` }
        }
      } catch (error) {
        results.push(`${scheme}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return { ok: false, message: `Readwise 连接失败：${results.join('；')}` }
  })

  ipcMain.handle('readwise:sync', async (): Promise<HighlightImportResult> => {
    const token = getReadwiseToken()
    if (!token) throw new Error('还没有配置 Readwise API Token。请先在设置里填写。')
    const entries = await fetchReadwiseEntries(token)
    if (entries.length === 0) {
      throw new Error('Readwise 账号没有返回任何划线。请确认划线和笔记确实保存在 Readwise（不是只在 Reader 的独立书库），或改用 Readwise 的 CSV 导出后手动导入。')
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

  ipcMain.handle('books:rename', (_event, bookId: string, title: string) => renameBook(bookId, title))

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

  ipcMain.handle('chapters:format', async (event, chapterId: string, instruction?: string) => {
    activeFormat?.abort()
    const controller = new AbortController()
    activeFormat = controller
    const sender = event.sender
    try {
      const result = await formatChapterToDb(chapterId, instruction, controller.signal)
      if (!sender.isDestroyed()) sender.send('chapter:formatted', result)
      return result
    } finally {
      if (activeFormat === controller) activeFormat = null
    }
  })

  ipcMain.handle('chapters:format-book', (event, bookId: string, options?: BookFormatOptions) => {
    activeFormat?.abort()
    const book = getBookSummary(bookId)
    if (!book) throw new Error('找不到这本书。')
    const visible = getChapters(bookId).filter((chapter) => !chapter.hidden)
    const onlyMissing = options?.onlyMissing === true
    const targets = onlyMissing
      ? visible.filter((chapter) => {
          try {
            return !getChapter(chapter.id).formattedHtml
          } catch {
            return false
          }
        })
      : visible
    const skipped = visible.length - targets.length
    const controller = new AbortController()
    activeFormat = controller
    const sender = event.sender
    const send = (channel: string, payload: unknown): void => {
      if (!sender.isDestroyed()) sender.send(channel, payload)
    }

    void (async () => {
      let formatted = 0
      const failed: BookFormatDoneEvent['failed'] = []
      for (let index = 0; index < targets.length; index++) {
        if (controller.signal.aborted) break
        const meta = targets[index]!
        send('book:format:progress', {
          bookId,
          chapterId: meta.id,
          title: meta.title,
          index: index + 1,
          total: targets.length,
          status: 'start',
          done: index,
        } satisfies BookFormatProgress)
        try {
          const chapter = getChapter(meta.id)
          if (chapter.text.trim().length < 80) {
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
            continue
          }
          const result = await formatChapterToDb(meta.id, undefined, controller.signal)
          formatted++
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
        } catch (error) {
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
        }
      }
      send('book:format:done', {
        bookId,
        formatted,
        skipped,
        failed,
        cancelled: controller.signal.aborted,
      } satisfies BookFormatDoneEvent)
      if (activeFormat === controller) activeFormat = null
    })()
  })

  ipcMain.handle('chapters:format-cancel', () => {
    activeFormat?.abort()
    activeFormat = null
  })

  ipcMain.handle('chapters:resetFormat', (_event, chapterId: string) => {
    resetChapterFormat(chapterId)
  })

  ipcMain.handle('books:reparse', async (_event, bookId: string) => {
    if (active) {
      active.controller.abort()
      active = null
    }
    const record = getBookRecord(bookId)
    if (!record) throw new Error('找不到这本书')
    await autoBackup(`重新解析《${record.title}》前`)
    const parsed = await reparseBookFile(record)
    const chapters = classifyImportedChapters(parsed.chapters)
    return replaceBookChapters(bookId, { title: parsed.title, author: parsed.author, chapters })
  })

  ipcMain.handle('books:merge', async (_event, bookIds: string[], title: string, author: string) => {
    if (!Array.isArray(bookIds) || bookIds.some((id) => typeof id !== 'string')) throw new Error('书籍参数无效。')
    const ids = [...new Set(bookIds.filter(Boolean))]
    if (ids.length < 2) throw new Error('至少选择两本书才能合并。')
    const target = getBookSummary(ids[0]!)
    if (!target) throw new Error('找不到要合并的第一本书。')
    await autoBackup(`合并 ${ids.length} 本书前`)
    const targetDir = path.join(dataDir, 'books', target.id)
    await fs.mkdir(targetDir, { recursive: true })
    const mergedText = ids
      .flatMap((id) => getChapters(id).map((chapter) => `# ${chapter.title}\n\n${getChapter(chapter.id).text}`))
      .join('\n\n')
    const mergedPath = path.join(targetDir, 'source-merged.txt')
    await fs.writeFile(mergedPath, mergedText, 'utf8')
    try {
      const merged = mergeBooks(ids, title, author, mergedPath)
      await Promise.all(
        ids.slice(1).map((id) => fs.rm(path.join(dataDir, 'books', id), { recursive: true, force: true })),
      )
      return merged
    } catch (error) {
      await fs.rm(mergedPath, { force: true })
      throw error
    }
  })

  ipcMain.handle('books:split', async (_event, bookId: string, fromChapterId: string, title: string) => {
    if (typeof bookId !== 'string' || typeof fromChapterId !== 'string') throw new Error('拆分参数无效。')
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
      return splitBook(bookId, fromChapterId, title, storedPath, newBookId, prefixPath)
    } catch (error) {
      await fs.rm(bookDir, { recursive: true, force: true })
      throw error
    }
  })

  ipcMain.handle('books:delete', async (_event, bookId: string) => {
    if (active) {
      try {
        if (getChapter(active.chapterId).bookId === bookId) {
          active.controller.abort()
          active = null
        }
      } catch {
        active = null
      }
    }
    const record = getBookRecord(bookId)
    if (record) await autoBackup(`删除《${record.title}》前`)
    deleteBookRow(bookId)
    await fs.rm(path.join(dataDir, 'books', bookId), { recursive: true, force: true })
  })

  ipcMain.handle('chapters:get', (_event, chapterId: string) => getChapter(chapterId))

  ipcMain.handle('books:progress', (_event, bookId: string, chapterId: string) => {
    setProgress(bookId, chapterId)
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

  ipcMain.handle('chapters:delete', (_event, chapterIds: string[]) => {
    if (active && chapterIds.includes(active.chapterId)) {
      active.controller.abort()
      active = null
    }
    deleteChapters(chapterIds)
  })

  ipcMain.handle('library:search', (_event, query: string) => {
    if (typeof query !== 'string') return []
    const term = query.replace(/\s+/g, ' ').trim()
    if (!term) return []
    return searchIndex(term) ?? searchLibrary(term)
  })

  ipcMain.handle('library:search-semantic', async (_event, query: string) => {
    if (typeof query !== 'string' || query.trim().length < 4) return []
    const semantic = await semanticRelatedNotes('', query, 12).catch(() => null)
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

  ipcMain.handle('library:tags', (_event, bookId?: string | null) =>
    listLibraryTags(typeof bookId === 'string' ? bookId : null),
  )

  ipcMain.handle(
    'tutor:ask',
    async (_event, chapterId: string, question: string, history: ChatTurn[], mode: ChatMode) => {
      if (typeof chapterId !== 'string' || typeof question !== 'string') throw new Error('问题无效。')
      return askChapter({
        config: getActiveSettings(),
        demo: isDemoMode(),
        context: tutorContextFor(chapterId),
        question,
        history: Array.isArray(history) ? history : [],
        mode: mode === 'socratic' ? 'socratic' : 'answer',
      })
    },
  )

  ipcMain.handle('tutor:evaluate', async (_event, chapterId: string, explanation: string) => {
    if (typeof chapterId !== 'string' || typeof explanation !== 'string') throw new Error('解释无效。')
    return evaluateExplanation({
      config: getActiveSettings(),
      demo: isDemoMode(),
      context: tutorContextFor(chapterId),
      explanation,
    })
  })

  ipcMain.handle('map:get', () => {
    const map = buildKnowledgeMap()
    if (!map.semanticReady && map.displayedNotes > 0) warmSemanticIndex()
    return map
  })

  ipcMain.handle('lab:run', async (_event, request: LabRequest) => {
    if (!request || typeof request !== 'object') throw new Error('任务无效。')
    return runLab({ config: getActiveSettings('lab'), demo: isDemoMode(), request })
  })

  ipcMain.handle('lab:chat', async (_event, request: LabRequest, history: ChatTurn[]) => {
    if (!request || typeof request !== 'object') throw new Error('任务无效。')
    return labChat({
      config: getActiveSettings('lab'),
      demo: isDemoMode(),
      request,
      history: Array.isArray(history) ? history : [],
    })
  })

  ipcMain.handle('lab:margin-note', async (_event, chapterId: string, quote: string) => {
    if (typeof chapterId !== 'string' || typeof quote !== 'string') throw new Error('边注参数无效。')
    return marginNote({ config: getActiveSettings('lab'), demo: isDemoMode(), chapterId, quote })
  })

  ipcMain.handle('lab:quiz', async (_event, chapterId: string) => {
    if (typeof chapterId !== 'string') throw new Error('章节无效。')
    return generateQuiz({ config: getActiveSettings('lab'), demo: isDemoMode(), chapterId })
  })

  ipcMain.handle('lab:quiz-check', async (_event, chapterId: string, question: string, answer: string) => {
    if (typeof chapterId !== 'string' || typeof question !== 'string' || typeof answer !== 'string') {
      throw new Error('答案参数无效。')
    }
    return checkQuizAnswer({ config: getActiveSettings('lab'), demo: isDemoMode(), chapterId, question, answer })
  })

  ipcMain.handle('lab:concept-merges', async () =>
    suggestConceptMerges({ config: getActiveSettings('lab'), demo: isDemoMode() }),
  )

  ipcMain.handle('lab:merge-tags', (_event, tags: string[], canonical: string) =>
    mergeNoteTags(Array.isArray(tags) ? tags : [], typeof canonical === 'string' ? canonical : ''),
  )

  ipcMain.handle('lab:duplicates', () => findDuplicateNotes())

  ipcMain.handle('lab:merge-notes', (_event, keepId: string, mergeId: string) => {
    if (typeof keepId !== 'string' || typeof mergeId !== 'string') throw new Error('卡片参数无效。')
    return mergeNotes(keepId, mergeId)
  })

  ipcMain.handle('lab:relation-graph', async (_event, bookId: string) => {
    if (typeof bookId !== 'string') throw new Error('书籍无效。')
    const graph = await generateRelationGraph({
      config: getActiveSettings('lab'),
      demo: isDemoMode(),
      bookId,
    })
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

  ipcMain.handle('lab:pdf-page', async (_event, bookId: string, page: number) => {
    if (typeof bookId !== 'string' || typeof page !== 'number') throw new Error('页面参数无效。')
    return analyzePdfPage({ config: getActiveSettings('lab'), demo: isDemoMode(), bookId, page })
  })

  ipcMain.handle('lab:artifact-get', (_event, tool: string, scope?: string) =>
    typeof tool === 'string' ? getLabArtifact(tool, typeof scope === 'string' ? scope : 'latest') : null,
  )

  ipcMain.handle('lab:artifact-list', (_event, tool: string, limit?: number) =>
    typeof tool === 'string' ? listLabArtifacts(tool, typeof limit === 'number' ? limit : 30) : [],
  )

  ipcMain.handle(
    'lab:artifact-save',
    (
      _event,
      input: {
        tool: string
        scope: string
        title: string
        content: string
        meta?: string | null
        kind?: ContentKind
        bookId?: string | null
        chapterId?: string | null
      },
    ) => {
      if (!input || typeof input !== 'object') throw new Error('保存内容无效。')
      return saveLabArtifact(input)
    },
  )

  ipcMain.handle('lab:artifact-update', (_event, id: string, patch) => {
    if (typeof id !== 'string' || !patch || typeof patch !== 'object') throw new Error('生成内容参数无效。')
    return updateLabArtifact(id, patch)
  })

  ipcMain.handle('content:list', (_event, filter?: ContentFilter) =>
    listContent(filter && typeof filter === 'object' ? filter : {}),
  )

  ipcMain.handle('content:get', (_event, id: string) => (typeof id === 'string' ? getContent(id) : null))

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

  ipcMain.handle('notes:related', async (_event, bookId: string, tags: string[], queryText?: string) => {
    try {
      const query = typeof queryText === 'string' ? queryText : ''
      const semantic = await semanticRelatedNotes(bookId, query, 6)
      if (semantic && semantic.length > 0) return semantic
      return listRelatedNotes(bookId, Array.isArray(tags) ? tags : [])
    } catch (error) {
      console.warn('[notes:related] 查询相关笔记失败', error instanceof Error ? error.message : error)
      return []
    }
  })

  ipcMain.handle('notes:create', (_event, draft: NoteDraft) => createNote(draft))

  ipcMain.handle('notes:update', (_event, noteId: string, patch: NotePatch) => updateNote(noteId, patch))

  ipcMain.handle('notes:delete', (_event, noteId: string) => {
    deleteNote(noteId)
  })

  ipcMain.handle('notes:generate', (event, chapterId: string) => {
    active?.controller.abort()
    const chapter = getChapter(chapterId)
    const book = getBookSummary(chapter.bookId)
    if (!book) throw new Error('找不到章节所属的书')

    const settings = getActiveSettings('notes')
    if (settings.provider !== 'demo' && !settings.apiKey) {
      throw new Error('还没有配置 API Key。请打开右上角设置，选择模型并填入 Key。')
    }

    const controller = new AbortController()
    active = { chapterId, controller }
    const sender = event.sender

    const send = (channel: string, payload: unknown): void => {
      if (!sender.isDestroyed()) sender.send(channel, payload)
    }

    void (async () => {
      try {
        const result = await generateChapterToDb(chapterId, settings, controller.signal, (partial) =>
          send('generation:partial', { chapterId, partial }),
        )
        if (controller.signal.aborted) return
        send('generation:done', { chapterId, notes: result.notes, report: result.report })
      } catch (error) {
        if (controller.signal.aborted) {
          send('generation:error', { chapterId, message: '生成已取消' })
        } else {
          send('generation:error', {
            chapterId,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      } finally {
        if (active?.controller === controller) active = null
      }
    })()
  })

  ipcMain.handle('notes:generate-book', (event, bookId: string, options?: BookGenerationOptions) => {
    active?.controller.abort()
    const book = getBookSummary(bookId)
    if (!book) throw new Error('找不到这本书')

    const settings = getActiveSettings('notes')
    if (settings.provider !== 'demo' && !settings.apiKey) {
      throw new Error('还没有配置 API Key。请打开右上角设置，选择模型并填入 Key。')
    }

    const visible = getChapters(bookId).filter((chapter) => !chapter.hidden)
    const onlyMissing = options?.onlyMissing !== false
    const existing = new Set(
      listNotes(bookId)
        .filter((note) => note.kind === 'condensed' && note.chapterId && note.content.trim())
        .map((note) => note.chapterId as string),
    )
    const targets = visible.filter((chapter) => !onlyMissing || !existing.has(chapter.id))
    const skippedByOption = visible.length - targets.length

    const controller = new AbortController()
    active = { chapterId: '', controller }
    const sender = event.sender
    const send = (channel: string, payload: unknown): void => {
      if (!sender.isDestroyed()) sender.send(channel, payload)
    }

    void (async () => {
      let generated = 0
      let skipped = 0
      const failed: BookGenerationDoneEvent['failed'] = []
      for (let index = 0; index < targets.length; index++) {
        if (controller.signal.aborted) break
        const meta = targets[index]!
        send('book:generation:progress', {
          bookId,
          chapterId: meta.id,
          title: meta.title,
          index: index + 1,
          total: targets.length,
          status: 'start',
          done: index,
        } satisfies BookGenerationProgress)
        try {
          const content = getChapter(meta.id)
          if (content.text.trim().length < 80) {
            skipped++
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
            continue
          }
          const result = await generateChapterToDb(meta.id, settings, controller.signal, (partial) =>
            send('generation:partial', { chapterId: meta.id, partial }),
          )
          generated++
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
        } catch (error) {
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
        }
      }
      send('book:generation:done', {
        bookId,
        generated,
        skipped,
        existing: skippedByOption,
        failed,
        cancelled: controller.signal.aborted,
      } satisfies BookGenerationDoneEvent)
      if (active?.controller === controller) active = null
    })()
  })

  ipcMain.handle('notes:cancel', () => {
    active?.controller.abort()
    active = null
  })

  ipcMain.handle('notes:expand', async (_event, noteId: string) => {
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

  ipcMain.handle('backup:open-dir', async () => {
    const dir = backupsDir(dataDir)
    await fs.mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })

  ipcMain.handle('backup:restore', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('备份编号无效。')
    active?.controller.abort()
    active = null
    composeActive?.abort()
    composeActive = null
    activeFormat?.abort()
    activeFormat = null
    await autoBackup('恢复备份前')
    restoreBackup(dataDir, id)
    const window = getWindow()
    setTimeout(() => window?.webContents.reload(), 250)
  })

  ipcMain.handle('settings:get', () => getSettingsView())

  ipcMain.handle('settings:save', (_event, patch: SettingsPatch) => saveSettings(patch))

  ipcMain.handle('settings:test', async (): Promise<TestResult> => {
    const settings = getActiveSettings()
    if (settings.provider === 'demo') {
      return { ok: true, message: '演示模式工作正常。配置真实模型后可校验引用与生成质量。' }
    }
    try {
      const model = createLanguageModel(settings)
      const result = await generateText({
        model,
        prompt: '只回复四个字：连接成功',
        maxOutputTokens: 20,
        abortSignal: AbortSignal.timeout(25_000),
      })
      return { ok: true, message: `连接成功：${result.text.trim().slice(0, 40) || '模型已响应'}` }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir,
    demo: getSettingsView().demo,
  }))

  ipcMain.handle('app:open-data', async () => {
    await shell.openPath(dataDir)
  })

  ipcMain.handle(
    'book:compose',
    async (event, bookId: string, options?: BookComposeOptions): Promise<BookComposeResult> => {
      composeActive?.abort()
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
      composeActive = controller
      const sender = event.sender
      const send = (channel: string, payload: unknown): void => {
        if (!sender.isDestroyed()) sender.send(channel, payload)
      }
      try {
        const result = await composeBook({
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
          onProgress: (progress) => send('book:compose:progress', progress),
        })
        saveLabArtifact({
          tool: 'book-compose',
          scope: `book:${bookId}`,
          title: result.title,
          content: JSON.stringify(result),
        })
        return result
      } finally {
        if (composeActive === controller) composeActive = null
      }
    },
  )

  ipcMain.handle('book:compose-cancel', () => {
    composeActive?.abort()
    composeActive = null
  })

  ipcMain.handle('app:copy-text', (_event, text: string) => {
    if (typeof text !== 'string') throw new Error('复制内容无效。')
    clipboard.writeText(text)
  })

  ipcMain.handle('app:save-markdown', async (_event, defaultName: string, content: string): Promise<SaveFileResult> => {
    if (typeof content !== 'string') throw new Error('导出内容无效。')
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
  ipcMain.handle('app:copy-image', async (_event, dataUrl: string) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error('图片数据无效。')
    }
    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) throw new Error('图片数据为空。')
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

  ipcMain.handle('app:save-html', async (_event, defaultName: string, content: string): Promise<SaveFileResult> => {
    if (typeof content !== 'string') throw new Error('导出内容无效。')
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

}
