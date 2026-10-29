import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { app, BrowserWindow, shell } from 'electron'

import { generateChapterNotes } from './ai/notes.js'
import { closeDatabase, createNote, getChapter, getChapters, initDatabase, insertBook, listBooks, replaceAiNotes, setProgress } from './db.js'
import { registerIpc } from './ipc.js'
import { importBookFile } from './import.js'
import { parseEpub } from './parsers/epub.js'
import { initSettings } from './settings.js'
import { runSmokeTest, sampleEpubBuffer } from './smoke.js'

let mainWindow: BrowserWindow | null = null

const isSmoke = process.argv.includes('--smoke-test')
const isSeed = process.argv.includes('--seed-demo')
const openFirst = process.argv.includes('--open-first')
const dumpDom = process.argv.includes('--dump-dom')
const dataDirArg = process.argv.find((arg) => arg.startsWith('--data-dir='))
if (dataDirArg) app.setPath('userData', dataDirArg.slice('--data-dir='.length))
const execFileArg = process.argv.find((arg) => arg.startsWith('--exec-file='))
const importArg = process.argv.find((arg) => arg.startsWith('--import='))
const writeSampleArg = process.argv.find((arg) => arg.startsWith('--write-sample='))
const screenshotArg = process.argv.find((arg) => arg.startsWith('--screenshot='))
const screenshotPath = screenshotArg ? screenshotArg.slice('--screenshot='.length) : null

async function seedDemoLibrary(): Promise<void> {
  if (listBooks().length > 0) return
  const parsed = parseEpub(sampleEpubBuffer(), 'sample.epub')
  const book = insertBook(
    { title: parsed.title, author: parsed.author, format: 'epub', filePath: '/tmp/sample.epub' },
    parsed.chapters,
  )
  const chapters = getChapters(book.id)
  const first = chapters[0]
  if (!first) return
  const chapter = getChapter(first.id)
  const result = await generateChapterNotes(
    {
      bookTitle: book.title,
      chapterTitle: chapter.title,
      chapterText: chapter.text,
      chapterHtml: chapter.html ?? '',
      config: { provider: 'demo', baseUrl: '', model: 'demo', apiKey: null },
      demo: true,
    },
    () => undefined,
    new AbortController().signal,
  )
  replaceAiNotes(chapter.id, result.notes)
  createNote({
    bookId: book.id,
    chapterId: chapter.id,
    kind: 'thought',
    title: '环境比意志更可靠',
    content:
      '这一章让我想到[[本章摘要]]里说的环境设计：与其反复下决心，不如先把手机放到另一个房间。下一步可以给自己做一张“注意力摩擦清单”。',
  })
  setProgress(book.id, chapter.id)
}

function createWindow(): void {
  const appRoot = app.getAppPath()
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#f5f0e6',
    title: '页边',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(appRoot, 'dist-electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = window

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(path.join(appRoot, 'dist', 'index.html'))
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const internal =
      (devUrl && url.startsWith(devUrl)) || url.startsWith('file://') || url.startsWith('about:blank')
    if (internal) return
    event.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  window.webContents.on('did-finish-load', () => {
    if (!screenshotPath && !dumpDom) return
    setTimeout(() => {
      void (async () => {
        try {
          if (openFirst) {
            await window.webContents.executeJavaScript("document.querySelector('.book-card')?.click()")
            await new Promise((resolve) => setTimeout(resolve, 2600))
          }
          if (execFileArg && !app.isPackaged) {
            const code = fs.readFileSync(execFileArg.slice('--exec-file='.length), 'utf8')
            const result = await window.webContents.executeJavaScript(code)
            console.log(`[exec] ${JSON.stringify(result)}`)
            await new Promise((resolve) => setTimeout(resolve, 800))
          }
          if (dumpDom) {
            const info = await window.webContents.executeJavaScript(
              `JSON.stringify({
                title: document.title,
                notes: document.querySelectorAll('.note-card').length,
                streaming: document.querySelectorAll('.streaming-card').length,
                empty: document.querySelectorAll('.notes-empty').length,
                chapters: document.querySelectorAll('.chapter-item').length,
                related: document.querySelectorAll('.related-card').length,
                backlinks: document.querySelectorAll('.backlink').length,
                text: document.body.innerText,
              })`,
            )
            console.log(`[dom] ${info}`)
          }
          if (!screenshotPath) return
          const image = await window.webContents.capturePage()
          fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
          fs.writeFileSync(screenshotPath, image.toPNG())
          console.log(`[screenshot] ${screenshotPath}`)
        } catch (error) {
          console.error('[screenshot] failed', error)
          process.exitCode = 1
        } finally {
          app.quit()
        }
      })()
    }, 1100)
  })

  window.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  if (writeSampleArg) {
    const target = writeSampleArg.slice('--write-sample='.length)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, sampleEpubBuffer())
    console.log(`[sample] ${target}`)
    app.exit(0)
    return
  }

  if (isSmoke) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-smoke-'))
    try {
      initDatabase(tempDir)
      initSettings(tempDir)
      await runSmokeTest()
      console.log('[smoke] PASSED')
      app.exit(0)
    } catch (error) {
      console.error('[smoke] FAILED', error)
      app.exit(1)
    } finally {
      closeDatabase()
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    return
  }

  const dataDir = app.getPath('userData')
  initDatabase(dataDir)
  initSettings(dataDir)

  if (importArg) {
    try {
      const sourcePath = importArg.slice('--import='.length)
      if (process.argv.includes('--store')) {
        const book = await importBookFile(sourcePath, dataDir)
        console.log(
          `[import] ${JSON.stringify({
            stored: true,
            id: book.id,
            title: book.title,
            chapters: book.chapterCount,
            hidden: book.hiddenChapterCount,
          })}`,
        )
      } else {
        const buffer = fs.readFileSync(sourcePath)
        const extension = path.extname(sourcePath).toLowerCase()
        const parsed =
          extension === '.epub'
            ? parseEpub(buffer, sourcePath)
            : await (await import('./parsers/pdf.js')).parsePdf(buffer, sourcePath)
        console.log(
          `[import] ${JSON.stringify({
            title: parsed.title,
            author: parsed.author,
            chapters: parsed.chapters.length,
            firstTitle: parsed.chapters[0]?.title,
            firstChars: parsed.chapters[0]?.text.length,
          })}`,
        )
      }
      app.exit(0)
    } catch (error) {
      console.error('[import] failed', error)
      app.exit(1)
    }
    return
  }

  registerIpc(() => mainWindow, dataDir)
  if (isSeed) await seedDemoLibrary()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  closeDatabase()
})
