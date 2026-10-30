import fs from 'node:fs/promises'
import path from 'node:path'

import { BrowserWindow, ClipboardItem, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import { generateText } from 'ai'

import {
  applyChapterFlags,
  createNote,
  deleteChapters,
  deleteNote,
  deleteBook as deleteBookRow,
  getBookRecord,
  getBookStyle,
  getBookSummary,
  getChapter,
  getChapters,
  getLabArtifact,
  getNote,
  listLabArtifacts,
  getReviewQueue,
  getReviewStats,
  listBooks,
  listExperiments,
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
  reviewNote,
  saveBookStyle,
  saveChapterFormat,
  saveLabArtifact,
  saveNoteDivergences,
  saveNoteReport,
  searchLibrary,
  setProgress,
  updateNote,
  updateExperimentStatus,
} from './db.js'
import { classifyChapters } from './ai/classify.js'
import { formatChapter as formatChapterWithAI } from './ai/format.js'
import {
  analyzePdfPage,
  checkQuizAnswer,
  findDuplicateNotes,
  generateExperiment,
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
import { classifyImportedChapters, importBookFile } from './import.js'
import { buildKnowledgeMap } from './knowledge-map.js'
import { parseEpub } from './parsers/epub.js'
import { parsePdf } from './parsers/pdf.js'
import { configureSemantic, semanticRelatedNotes, warmSemanticIndex } from './semantic.js'
import { getActiveSettings, getSettingsView, isDemoMode, saveSettings } from './settings.js'
import type {
  BookComposeOptions,
  BookComposeResult,
  BookGenerationDoneEvent,
  BookGenerationOptions,
  BookGenerationProgress,
  ChapterFlag,
  ChatMode,
  ChatTurn,
  GeneratePartial,
  LabRequest,
  LibraryFilter,
  Note,
  NoteDraft,
  NotePatch,
  NoteReport,
  ReaderStyle,
  ReviewRating,
  SaveFileResult,
  SettingsPatch,
  TestResult,
} from '../shared/types.js'
import type { TutorContext } from './ai/tutor.js'

interface ActiveGeneration {
  chapterId: string
  controller: AbortController
}

let active: ActiveGeneration | null = null
let composeActive: AbortController | null = null

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
  return { notes, report: result.report }
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

  ipcMain.handle('books:list', () => listBooks())

  ipcMain.handle('books:import', async () => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '导入电子书',
          properties: ['openFile'],
          filters: [{ name: '电子书', extensions: ['epub', 'pdf'] }],
        })
      : await dialog.showOpenDialog({
          title: '导入电子书',
          properties: ['openFile'],
          filters: [{ name: '电子书', extensions: ['epub', 'pdf'] }],
        })
    if (result.canceled || result.filePaths.length === 0) return null

    return importBookFile(result.filePaths[0]!, dataDir)
  })

  ipcMain.handle('books:open', (_event, bookId: string) => {
    const book = getBookSummary(bookId)
    if (!book) throw new Error('找不到这本书')
    return { book, chapters: getChapters(bookId), style: getBookStyle(bookId) }
  })

  ipcMain.handle('books:rename', (_event, bookId: string, title: string) => renameBook(bookId, title))

  ipcMain.handle('chapters:rename', (_event, chapterId: string, title: string) => {
    renameChapter(chapterId, title)
  })

  ipcMain.handle('parts:rename', (_event, bookId: string, partIndex: number, title: string) => {
    renamePart(bookId, partIndex, title)
  })

  ipcMain.handle('books:saveStyle', (_event, bookId: string, style: ReaderStyle) =>
    saveBookStyle(bookId, style),
  )

  ipcMain.handle('chapters:format', async (_event, chapterId: string, instruction?: string) => {
    const chapter = getChapter(chapterId)
    const style = getBookStyle(chapter.bookId)
    const escapeHtml = (value: string): string =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const sourceHtml =
      chapter.html ??
      chapter.text
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
        .join('')
    const result = await formatChapterWithAI({
      chapterTitle: chapter.title,
      html: sourceHtml,
      originalText: chapter.text,
      currentHtml: chapter.formattedHtml,
      currentRemoved: chapter.removed,
      instruction,
      style,
      config: getActiveSettings(),
    })
    saveChapterFormat(chapterId, result.html, result.removed)
    const savedStyle = saveBookStyle(chapter.bookId, result.style)
    return {
      chapterId,
      html: result.html,
      removed: result.removed,
      style: savedStyle,
      note: result.note,
    }
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
    const buffer = await fs.readFile(record.filePath)
    const parsed =
      record.format === 'epub'
        ? parseEpub(buffer, record.filePath)
        : await parsePdf(buffer, record.filePath)
    const chapters = classifyImportedChapters(parsed.chapters)
    return replaceBookChapters(bookId, { title: parsed.title, author: parsed.author, chapters })
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
    deleteBookRow(bookId)
    await fs.rm(path.join(dataDir, 'books', bookId), { recursive: true, force: true })
  })

  ipcMain.handle('chapters:get', (_event, chapterId: string) => getChapter(chapterId))

  ipcMain.handle('books:progress', (_event, bookId: string, chapterId: string) => {
    setProgress(bookId, chapterId)
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

  ipcMain.handle('library:search', (_event, query: string) =>
    typeof query === 'string' ? searchLibrary(query) : [],
  )

  ipcMain.handle('library:notes', (_event, filter?: LibraryFilter) =>
    listLibraryNotes(filter && typeof filter === 'object' ? filter : {}),
  )

  ipcMain.handle('library:tags', (_event, bookId?: string | null) =>
    listLibraryTags(typeof bookId === 'string' ? bookId : null),
  )

  ipcMain.handle('review:stats', () => getReviewStats())

  ipcMain.handle('review:queue', (_event, limit?: number) =>
    getReviewQueue(typeof limit === 'number' ? limit : 30),
  )

  ipcMain.handle('review:rate', async (_event, noteId: string, rating: ReviewRating) => {
    if (typeof noteId !== 'string') throw new Error('笔记无效。')
    reviewNote(noteId, rating)
  })

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
    return runLab({ config: getActiveSettings(), demo: isDemoMode(), request })
  })

  ipcMain.handle('lab:chat', async (_event, request: LabRequest, history: ChatTurn[]) => {
    if (!request || typeof request !== 'object') throw new Error('任务无效。')
    return labChat({
      config: getActiveSettings(),
      demo: isDemoMode(),
      request,
      history: Array.isArray(history) ? history : [],
    })
  })

  ipcMain.handle('lab:margin-note', async (_event, chapterId: string, quote: string) => {
    if (typeof chapterId !== 'string' || typeof quote !== 'string') throw new Error('边注参数无效。')
    return marginNote({ config: getActiveSettings(), demo: isDemoMode(), chapterId, quote })
  })

  ipcMain.handle('lab:quiz', async (_event, chapterId: string) => {
    if (typeof chapterId !== 'string') throw new Error('章节无效。')
    return generateQuiz({ config: getActiveSettings(), demo: isDemoMode(), chapterId })
  })

  ipcMain.handle('lab:quiz-check', async (_event, chapterId: string, question: string, answer: string) => {
    if (typeof chapterId !== 'string' || typeof question !== 'string' || typeof answer !== 'string') {
      throw new Error('答案参数无效。')
    }
    return checkQuizAnswer({ config: getActiveSettings(), demo: isDemoMode(), chapterId, question, answer })
  })

  ipcMain.handle('lab:concept-merges', async () =>
    suggestConceptMerges({ config: getActiveSettings(), demo: isDemoMode() }),
  )

  ipcMain.handle('lab:merge-tags', (_event, tags: string[], canonical: string) =>
    mergeNoteTags(Array.isArray(tags) ? tags : [], typeof canonical === 'string' ? canonical : ''),
  )

  ipcMain.handle('lab:duplicates', () => findDuplicateNotes())

  ipcMain.handle('lab:merge-notes', (_event, keepId: string, mergeId: string) => {
    if (typeof keepId !== 'string' || typeof mergeId !== 'string') throw new Error('卡片参数无效。')
    return mergeNotes(keepId, mergeId)
  })

  ipcMain.handle('lab:experiments', () => listExperiments())

  ipcMain.handle('lab:experiment-create', async (_event, goal: string) => {
    if (typeof goal !== 'string') throw new Error('实验目标无效。')
    return generateExperiment({ config: getActiveSettings(), demo: isDemoMode(), goal })
  })

  ipcMain.handle('lab:experiment-status', (_event, id: string, status: string) => {
    if (typeof id !== 'string') throw new Error('实验无效。')
    updateExperimentStatus(id, status as 'planned' | 'active' | 'done')
  })

  ipcMain.handle('lab:pdf-page', async (_event, bookId: string, page: number) => {
    if (typeof bookId !== 'string' || typeof page !== 'number') throw new Error('页面参数无效。')
    return analyzePdfPage({ config: getActiveSettings(), demo: isDemoMode(), bookId, page })
  })

  ipcMain.handle('lab:artifact-get', (_event, tool: string, scope?: string) =>
    typeof tool === 'string' ? getLabArtifact(tool, typeof scope === 'string' ? scope : 'latest') : null,
  )

  ipcMain.handle('lab:artifact-list', (_event, tool: string, limit?: number) =>
    typeof tool === 'string' ? listLabArtifacts(tool, typeof limit === 'number' ? limit : 30) : [],
  )

  ipcMain.handle('lab:artifact-save', (_event, input: { tool: string; scope: string; title: string; content: string; meta?: string | null }) => {
    if (!input || typeof input !== 'object') throw new Error('保存内容无效。')
    return saveLabArtifact(input)
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

    const settings = getActiveSettings()
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

    const settings = getActiveSettings()
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
      config: getActiveSettings(),
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
    version: '0.1.0',
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
      const settings = getActiveSettings()
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
