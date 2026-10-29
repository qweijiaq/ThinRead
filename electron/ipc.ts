import fs from 'node:fs/promises'
import path from 'node:path'

import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
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
  getNote,
  listBooks,
  listNotes,
  listRelatedNotes,
  replaceAiNotes,
  replaceBookChapters,
  resetChapterFormat,
  saveBookStyle,
  saveChapterFormat,
  saveNoteDivergences,
  saveNoteReport,
  searchLibrary,
  setProgress,
  updateNote,
} from './db.js'
import { classifyChapters } from './ai/classify.js'
import { formatChapter as formatChapterWithAI } from './ai/format.js'
import { expandPoint, generateChapterNotes } from './ai/notes.js'
import { createLanguageModel } from './ai/provider.js'
import { classifyImportedChapters, importBookFile } from './import.js'
import { parseEpub } from './parsers/epub.js'
import { parsePdf } from './parsers/pdf.js'
import { configureSemantic, semanticRelatedNotes } from './semantic.js'
import { getActiveSettings, getSettingsView, saveSettings } from './settings.js'
import type {
  ChapterFlag,
  NoteDraft,
  NotePatch,
  ReaderStyle,
  SaveFileResult,
  SettingsPatch,
  TestResult,
} from '../shared/types.js'

interface ActiveGeneration {
  chapterId: string
  controller: AbortController
}

let active: ActiveGeneration | null = null

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
          (partial) => send('generation:partial', { chapterId, partial }),
          controller.signal,
        )
        if (controller.signal.aborted) return
        const saved = replaceAiNotes(chapterId, result.notes)
        saveNoteReport(chapterId, result.report)
        send('generation:done', { chapterId, notes: saved, report: result.report })
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
}
