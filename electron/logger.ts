import fs from 'node:fs'
import path from 'node:path'

/**
 * 本地滚动日志：只记应用事件、错误栈和元数据，不记书籍正文、笔记内容或 API Key。
 * 用户报障时可以用「设置 → 导出诊断包」把这些日志一起打包。
 */

const MAX_FILE_BYTES = 4 * 1024 * 1024
const RETENTION_DAYS = 14
const MAX_MESSAGE_CHARS = 2000
const MAX_STACK_CHARS = 6000

let dir: string | null = null

type Level = 'info' | 'warn' | 'error'

function dateStamp(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

function currentFile(): string | null {
  if (!dir) return null
  return path.join(dir, `app-${dateStamp(new Date())}.log`)
}

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…（已截断）` : value
}

function write(level: Level, scope: string, message: string, extra?: Record<string, unknown>): void {
  const file = currentFile()
  if (!dir || !file) return
  try {
    fs.mkdirSync(dir, { recursive: true })
    const stat = fs.statSync(file, { throwIfNoEntry: false })
    if (stat && stat.size > MAX_FILE_BYTES) {
      fs.renameSync(file, `${file}.1`)
    }
    const entry = {
      at: new Date().toISOString(),
      level,
      scope,
      message: clip(String(message), MAX_MESSAGE_CHARS),
      ...(extra ?? {}),
    }
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    // 日志写不进去不能影响主流程。
  }
}

/** 由主进程在确定数据目录后调用；未初始化时所有写入都是空操作。 */
export function initLogger(dataDir: string): void {
  dir = path.join(dataDir, 'logs')
  try {
    fs.mkdirSync(dir, { recursive: true })
    pruneOldLogs()
  } catch {
    dir = null
    return
  }
  logInfo('app', '日志已初始化', { dir })
}

export function logDir(): string | null {
  return dir
}

export function logInfo(scope: string, message: string, extra?: Record<string, unknown>): void {
  write('info', scope, message, extra)
}

export function logWarn(scope: string, message: string, extra?: Record<string, unknown>): void {
  write('warn', scope, message, extra)
}

export function logError(scope: string, error: unknown, extra?: Record<string, unknown>): void {
  const isError = error instanceof Error
  write('error', scope, isError ? error.message : String(error), {
    ...(extra ?? {}),
    ...(isError && error.stack ? { stack: clip(error.stack, MAX_STACK_CHARS) } : {}),
    ...(isError && error.name ? { name: error.name } : {}),
  })
}

/** 记录一条已经格式化的错误（渲染层上报用，不伪造主进程调用栈）。 */
export function logErrorEvent(scope: string, message: string, extra?: Record<string, unknown>): void {
  write('error', scope, message, {
    ...(extra ?? {}),
    ...(extra?.stack ? { stack: clip(String(extra.stack), MAX_STACK_CHARS) } : {}),
  })
}

function pruneOldLogs(): void {
  if (!dir) return
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  for (const name of fs.readdirSync(dir)) {
    if (!/^app-\d{8}\.log(\.1)?$/.test(name)) continue
    const file = path.join(dir, name)
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true })
    } catch {
      // 单个文件清理失败不影响启动。
    }
  }
}

/** 诊断包用：按修改时间正序返回最近的日志文本，最多 maxBytes。 */
export function readRecentLogs(maxBytes = 512 * 1024): string {
  if (!dir) return ''
  let names: Array<{ name: string; mtime: number }> = []
  try {
    names = fs
      .readdirSync(dir)
      .filter((name) => /^app-\d{8}\.log(\.1)?$/.test(name))
      .map((name) => {
        try {
          return { name, mtime: fs.statSync(path.join(dir!, name)).mtimeMs }
        } catch {
          return { name, mtime: 0 }
        }
      })
      .sort((a, b) => a.mtime - b.mtime)
  } catch {
    return ''
  }
  const chunks: string[] = []
  let used = 0
  for (let index = names.length - 1; index >= 0 && used < maxBytes; index--) {
    try {
      const text = fs.readFileSync(path.join(dir, names[index]!.name), 'utf8')
      const sliced = text.length > maxBytes - used ? text.slice(text.length - (maxBytes - used)) : text
      chunks.unshift(sliced)
      used += sliced.length
    } catch {
      // 跳过读不出来的文件。
    }
  }
  return chunks.join('')
}
