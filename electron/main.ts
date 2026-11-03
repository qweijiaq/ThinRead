import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { app, BrowserWindow, dialog, screen, shell } from 'electron'
import { autoUpdater } from 'electron-updater'

import { generateChapterNotes } from './ai/notes.js'
import { installFetchReplay } from './ai/replay.js'
import { initAiTrace } from './ai/trace.js'
import { closeDatabase, createNote, getChapter, getChapters, initDatabase, insertBook, listBooks, markRunningOcrJobsInterrupted, replaceAiNotes, setProgress } from './db.js'
import { ensureDailyBackup, recoverCorruptDatabase, recoverInterruptedRestore } from './backup.js'
import { buildDiagnosticsArchive } from './diagnostics.js'
import { registerIpc } from './ipc.js'
import { logError, logInfo, logWarn, initLogger } from './logger.js'
import { importBookFile } from './import.js'
import { parseEpub } from './parsers/epub.js'
import { parseMobi } from './parsers/mobi.js'
import { initSettings } from './settings.js'
import { runRealE2e, runRealNotesE2e } from './e2e-real.js'
import { runRealBookEval, runRealEval } from './eval-real.js'
import { initSearchIndex, warmSearchIndex } from './search-index.js'
import { runSmokeTest, sampleEpubBuffer } from './smoke.js'
import { parseDeepLink, type DeepLinkTarget } from '../shared/deep-link.js'

let mainWindow: BrowserWindow | null = null
let pendingDeepLink: DeepLinkTarget | null = null
// 恢复备份会触发 reload；did-finish-load 会再次执行，脚本只能跑一次。
let execRan = false

function deliverDeepLink(target: DeepLinkTarget, window: BrowserWindow | null = mainWindow): void {
  pendingDeepLink = target
  if (!window || window.isDestroyed() || window.webContents.isLoading()) return
  pendingDeepLink = null
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  window.webContents.send('app:deep-link', target)
}

app.on('open-url', (event, url) => {
  const target = parseDeepLink(url)
  if (!target) return
  event.preventDefault()
  deliverDeepLink(target)
})

// 主进程兜底：未捕获异常、未处理的 Promise 和渲染进程崩溃都要落盘，
// 否则用户只能报“白屏了”，诊断包里什么也看不到。
process.on('uncaughtException', (error) => {
  logError('main:uncaughtException', error)
  // 未捕获异常后继续跑等于带着未知状态写用户数据；记完日志就退出，让下次启动走正常恢复。
  try {
    dialog.showErrorBox(
      '页边遇到错误',
      ['主进程发生了未处理的错误，应用将退出。', '', error instanceof Error ? error.message : String(error), '', '日志已写入数据目录的 logs/ 文件夹。'].join('\n'),
    )
  } catch {
    // 对话框本身失败时至少保证日志和退出。
  }
  app.quit()
})
process.on('unhandledRejection', (reason) => {
  logError('main:unhandledRejection', reason)
})
app.on('render-process-gone', (_event, _contents, details) => {
  logError('main:render-process-gone', new Error(`渲染进程退出：${details.reason}`), {
    reason: details.reason,
    exitCode: details.exitCode,
  })
})
app.on('child-process-gone', (_event, details) => {
  logWarn('main:child-process-gone', `子进程退出：${details.type} / ${details.reason}`)
})


// 真实模型评测可以录制/回放网络响应；未设置环境变量时不改变任何行为。
if (process.env.THINREAD_AI_REPLAY_DIR || process.env.THINREAD_AI_RECORD_DIR) {
  installFetchReplay({
    replayDir: process.env.THINREAD_AI_REPLAY_DIR || undefined,
    recordDir: process.env.THINREAD_AI_RECORD_DIR || undefined,
  })
}

const isSmoke = process.argv.includes('--smoke-test')
const isRealE2e = process.argv.includes('--e2e-real')
const isRealNotesE2e = process.argv.includes('--e2e-real-notes')
const isRealEval = process.argv.includes('--eval-real')
const bookEvalArg = process.argv.find((arg) => arg.startsWith('--eval-real-book'))
const isRealBookEval = Boolean(bookEvalArg)
const isSeed = process.argv.includes('--seed-demo')
const openFirst = process.argv.includes('--open-first')
const dumpDom = process.argv.includes('--dump-dom')
const dataDirArg = process.argv.find((arg) => arg.startsWith('--data-dir='))
if (dataDirArg) app.setPath('userData', dataDirArg.slice('--data-dir='.length))
const execFileArg = process.argv.find((arg) => arg.startsWith('--exec-file='))
const importArg = process.argv.find((arg) => arg.startsWith('--import='))
const writeSampleArg = process.argv.find((arg) => arg.startsWith('--write-sample='))
const writeDiagnosticsArg = process.argv.find((arg) => arg.startsWith('--write-diagnostics='))
const windowSizeArg = process.argv.find((arg) => arg.startsWith('--window-size='))
const captureSizeArg = process.argv.find((arg) => arg.startsWith('--capture-size='))
const screenshotArg = process.argv.find((arg) => arg.startsWith('--screenshot='))
const screenshotPath = screenshotArg ? screenshotArg.slice('--screenshot='.length) : null

/**
 * 同一个数据目录只允许一个实例写入，否则两个进程会各自持有 SQLite 连接。
 * 测试、截图和 --data-dir 隔离运行不参与锁，避免互相抢。
 */
const isolatedRun = Boolean(dataDirArg) || isSmoke || isRealE2e || isRealEval
const hasSingleInstanceLock = isolatedRun ? true : app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

app.on('second-instance', (_event, argv) => {
  const url = argv.find((arg) => arg.startsWith('thinread://'))
  const target = url ? parseDeepLink(url) : null
  if (target) deliverDeepLink(target)
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

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

function ensureWindowVisible(window: BrowserWindow): void {
  const bounds = window.getBounds()
  const displays = screen.getAllDisplays()
  const fullyVisible = displays.some((display) => {
    const area = display.workArea
    return (
      bounds.x >= area.x &&
      bounds.y >= area.y &&
      bounds.x + bounds.width <= area.x + area.width &&
      bounds.y + bounds.height <= area.y + area.height
    )
  })
  if (fullyVisible) return
  // macOS 可能在显示器变化后恢复一个部分/完全在屏幕外的旧位置；夹回最近的主屏。
  const area = screen.getPrimaryDisplay().workArea
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  window.setBounds({
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  })
}

function createWindow(): void {
  const headless = process.env.THINREAD_HEADLESS === '1'
  const appRoot = app.getAppPath()
  const [windowWidth, windowHeight] = (() => {
    const raw = windowSizeArg?.slice('--window-size='.length) ?? ''
    const match = /^(\d{3,5})x(\d{3,5})$/.exec(raw)
    return match ? [Number(match[1]), Number(match[2])] : [1440, 900]
  })()
  const window = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    enableLargerThanScreen: true,
    backgroundColor: '#f5f0e6',
    title: '页边',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(appRoot, 'dist-electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !headless,
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
    if (headless) return
    ensureWindowVisible(window)
    window.show()
    window.focus()
    window.moveTop()
    app.focus({ steal: true })
    setTimeout(() => ensureWindowVisible(window), 350)
    let visibilityTimer: NodeJS.Timeout | null = null
    const scheduleVisibilityCheck = (): void => {
      if (visibilityTimer) clearTimeout(visibilityTimer)
      visibilityTimer = setTimeout(() => ensureWindowVisible(window), 260)
    }
    window.on('focus', scheduleVisibilityCheck)
    window.on('show', scheduleVisibilityCheck)
    window.on('move', scheduleVisibilityCheck)
    window.on('resize', scheduleVisibilityCheck)
    // macOS 有时会在 show 之后过一会儿才恢复旧 frame；启动后的几秒内再兜底检查。
    let checks = 0
    const startupVisibilityInterval = setInterval(() => {
      ensureWindowVisible(window)
      checks++
      if (checks >= 12) clearInterval(startupVisibilityInterval)
    }, 500)
    window.on('closed', () => {
      clearInterval(startupVisibilityInterval)
      if (visibilityTimer) clearTimeout(visibilityTimer)
    })
  })

  window.webContents.on('did-finish-load', () => {
    if (pendingDeepLink) deliverDeepLink(pendingDeepLink, window)
    if (!screenshotPath && !dumpDom) return
    setTimeout(() => {
      void (async () => {
        let failed = false
        let debuggerAttached = false
        const captureSize = (() => {
          const match = /^(\d{3,5})x(\d{3,5})$/.exec(captureSizeArg?.slice('--capture-size='.length) ?? '')
          return match ? { width: Number(match[1]), height: Number(match[2]) } : null
        })()
        try {
          if (captureSize) {
            const dbg = window.webContents.debugger
            if (!dbg.isAttached()) dbg.attach('1.3')
            debuggerAttached = true
            await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
              width: captureSize.width,
              height: captureSize.height,
              deviceScaleFactor: 1,
              mobile: false,
            })
            await new Promise((resolve) => setTimeout(resolve, 300))
          }
          if (openFirst) {
            await window.webContents.executeJavaScript("document.querySelector('.book-card')?.click()")
            await new Promise((resolve) => setTimeout(resolve, 2600))
          }
          if (execFileArg && !app.isPackaged && !execRan) {
            execRan = true
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
          fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
          if (captureSize) {
            const result = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
              format: 'png',
              clip: { x: 0, y: 0, width: captureSize.width, height: captureSize.height, scale: 1 },
              captureBeyondViewport: true,
            }) as { data: string }
            fs.writeFileSync(screenshotPath, Buffer.from(result.data, 'base64'))
          } else {
            const image = await window.webContents.capturePage()
            fs.writeFileSync(screenshotPath, image.toPNG())
          }
          console.log(`[screenshot] ${screenshotPath}`)
          failed = false
        } catch (error) {
          console.error('[screenshot] failed', error)
          failed = true
        } finally {
          if (debuggerAttached) {
            try {
              await window.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
              window.webContents.debugger.detach()
            } catch {
              // debugger 可能已随页面关闭。
            }
          }
          if (failed) app.exit(1)
          else app.quit()
        }
      })()
    }, 1100)
  })

  window.on('closed', () => {
    mainWindow = null
  })
}

/**
 * macOS 的自动更新由 Squirrel 安装，要求应用带有效的 Developer ID 签名。
 * 当前发布产物是 ad-hoc 签名：开启后只会在后台下载几百 MB 再静默失败。
 * 签名流程接通后把默认值改成 true；需要临时验证时用 THINREAD_UPDATER=1 启动。
 */
const updaterEnabled = process.env.THINREAD_UPDATER === '1'

function setupAutoUpdater(): void {
  if (!app.isPackaged || !updaterEnabled) return
  const resources = (process as unknown as { resourcesPath?: string }).resourcesPath
  if (!resources || !fs.existsSync(path.join(resources, 'app-update.yml'))) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (error) => {
    console.warn('[update] check failed', error instanceof Error ? error.message : error)
  })
  setTimeout(() => {
    void autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
      console.warn('[update] check failed', error instanceof Error ? error.message : error)
    })
  }, 8000).unref()
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
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
  if (isRealNotesE2e) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-e2e-notes-'))
    try {
      initDatabase(tempDir)
      initSettings(dataDir)
      await runRealNotesE2e()
      console.log('[e2e-real-notes] PASSED')
      app.exit(0)
    } catch (error) {
      console.error('[e2e-real-notes] FAILED', error)
      app.exit(1)
    } finally {
      closeDatabase()
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    return
  }

  if (isRealBookEval) {
    const limit = Number(bookEvalArg?.split('=')[1] ?? 5) || 5
    try {
      initDatabase(dataDir)
      initSettings(dataDir)
      initAiTrace(dataDir)
      await runRealBookEval(limit, process.env.THINREAD_EVAL_CHAPTER)
      console.log('[eval-real-book] PASSED')
      app.exit(0)
    } catch (error) {
      console.error('[eval-real-book] FAILED', error)
      app.exit(1)
    } finally {
      closeDatabase()
    }
    return
  }

  if (isRealE2e) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-e2e-real-'))
    try {
      initDatabase(tempDir)
      initSettings(dataDir)
      await runRealE2e()
      console.log('[e2e-real] PASSED')
      app.exit(0)
    } catch (error) {
      console.error('[e2e-real] FAILED', error)
      app.exit(1)
    } finally {
      closeDatabase()
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    return
  }

  if (isRealEval) {
    try {
      initSettings(dataDir)
      await runRealEval(dataDir)
      console.log('[eval-real] PASSED')
      app.exit(0)
    } catch (error) {
      console.error('[eval-real] FAILED', error)
      app.exit(1)
    }
    return
  }

  initLogger(dataDir)
  logInfo('app', '启动', {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
  })
  // 上次恢复备份如果崩在中途，先把旧数据搬回来再打开数据库。
  recoverInterruptedRestore(dataDir)
  try {
    initDatabase(dataDir)
  } catch (error) {
    const recovery = recoverCorruptDatabase(dataDir)
    if (!recovery.recovered) throw error
    logWarn('db', '数据库损坏，已从最近备份恢复', recovery)
    initDatabase(dataDir)
  }
  initSettings(dataDir)
  initAiTrace(dataDir)
  initSearchIndex(dataDir)
  markRunningOcrJobsInterrupted()

  // 无头导出诊断包：用于自动化验证，也方便在打不开窗口时让用户取日志。
  if (writeDiagnosticsArg) {
    const target = writeDiagnosticsArg.slice('--write-diagnostics='.length)
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, buildDiagnosticsArchive(dataDir))
      console.log(`[diagnostics] ${target}`)
      app.exit(0)
    } catch (error) {
      logError('diagnostics', error)
      console.error('[diagnostics] failed', error)
      app.exit(1)
    }
    return
  }

  if (listBooks().length > 0) {
    ensureDailyBackup(dataDir)
    setInterval(() => {
      if (listBooks().length > 0) ensureDailyBackup(dataDir)
    }, 6 * 60 * 60 * 1000).unref()
    // 启动后空闲时预热全文索引，避免第一次搜索等待整库构建。
    setTimeout(() => void warmSearchIndex(), 2_500).unref()
  }

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
            : extension === '.pdf'
              ? await (await import('./parsers/pdf.js')).parsePdf(buffer, sourcePath)
              : await parseMobi(buffer, sourcePath)
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
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('thinread', process.execPath, [path.resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('thinread')
  }
  createWindow()
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error: unknown) => {
  // 启动失败（迁移、数据库损坏、权限）以前是“进程活着但没有窗口”，用户完全无从下手。
  logError('startup', error)
  const dataDir = app.getPath('userData')
  dialog.showErrorBox(
    '页边无法启动',
    [
      '启动时遇到错误，应用已退出。',
      '',
      error instanceof Error ? error.message : String(error),
      '',
      `数据目录：${dataDir}`,
      '如果数据库损坏，可以在设置或 backups/ 目录里用最近一次备份恢复。',
      '日志在 logs/ 目录，也可以把它发给开发者。',
    ].join('\n'),
  )
  app.exit(1)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  closeDatabase()
})
