import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { app } from 'electron'
import { zipSync } from 'fflate'

import { getSchemaVersion, listBooks } from './db.js'
import { logDir, logInfo, readRecentLogs } from './logger.js'
import { getSettingsView } from './settings.js'

/**
 * 诊断包：系统与版本信息、脱敏后的模型设置、数据规模、最近日志和 AI trace 元数据。
 * 不包含书籍正文、笔记内容、API Key 或提示词。
 */

const MAX_ARCHIVE_BYTES = 12 * 1024 * 1024
const TRACE_RETENTION_DAYS = 7
const MAX_TRACE_BYTES = 2 * 1024 * 1024

/** 只保留协议、主机和路径，去掉可能带 token 的 query 与用户名密码。 */
export function redactUrl(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`
  } catch {
    return value.split('?')[0] ?? value
  }
}

function fileSize(file: string): number | null {
  try {
    return fs.statSync(file).size
  } catch {
    return null
  }
}

function collectTraces(dataDir: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  const dir = path.join(dataDir, 'ai-traces')
  let names: string[] = []
  try {
    names = fs.readdirSync(dir).filter((name) => /^\d{8}\.jsonl$/.test(name)).sort()
  } catch {
    return files
  }
  const cutoff = Date.now() - TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1000
  let used = 0
  for (let index = names.length - 1; index >= 0 && used < MAX_TRACE_BYTES; index--) {
    const name = names[index]!
    const file = path.join(dir, name)
    try {
      if (fs.statSync(file).mtimeMs < cutoff) break
      const buffer = fs.readFileSync(file)
      const slice = buffer.length > MAX_TRACE_BYTES - used ? buffer.subarray(buffer.length - (MAX_TRACE_BYTES - used)) : buffer
      files[`ai-traces/${name}`] = new Uint8Array(slice)
      used += slice.length
    } catch {
      // 跳过坏文件。
    }
  }
  return files
}

export function buildDiagnosticsArchive(dataDir: string): Uint8Array {
  const books = listBooks()
  const settings = getSettingsView()
  const dbFile = path.join(dataDir, 'reading-notes.db')
  const info = {
    generatedAt: new Date().toISOString(),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      packaged: app.isPackaged,
    },
    runtime: {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
    },
    data: {
      dir: dataDir,
      dbBytes: fileSize(dbFile),
      schemaVersion: getSchemaVersion(),
      logDir: logDir(),
    },
    library: {
      books: books.length,
      chapters: books.reduce((sum, book) => sum + book.chapterCount + book.hiddenChapterCount, 0),
      notes: books.reduce((sum, book) => sum + book.noteCount, 0),
    },
    settings: {
      provider: settings.provider,
      baseUrl: redactUrl(settings.baseUrl),
      model: settings.model,
      demo: settings.demo,
      apiKeyConfigured: settings.apiKeyConfigured,
      generationMode: settings.generationMode,
      notesModel: settings.notesModel,
      composeModel: settings.composeModel,
      labModel: settings.labModel,
      readwiseConfigured: settings.readwiseConfigured,
      qwenTtsConfigured: settings.qwenTtsConfigured,
    },
  }

  const files: Record<string, Uint8Array> = {
    'system.json': new TextEncoder().encode(`${JSON.stringify(info, null, 2)}\n`),
    'README.txt': new TextEncoder().encode(
      [
        '页边 ThinRead 诊断包',
        '',
        '包含：系统与版本信息（system.json）、脱敏后的模型设置、数据规模、最近日志和 AI trace 元数据。',
        '不包含：书籍正文、笔记内容、提示词、API Key。',
        '日志里可能包含书名和章节标题（用于定位问题），如果介意请自行检查后再分享。',
        '',
      ].join('\n'),
    ),
  }

  const logs = readRecentLogs()
  if (logs) files['logs/app.log'] = new TextEncoder().encode(logs)
  Object.assign(files, collectTraces(dataDir))

  const archive = zipSync(files, { level: 6 })
  logInfo('diagnostics', '诊断包已生成', { bytes: archive.byteLength, files: Object.keys(files).length })
  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('诊断包超过 12MB，请先清理日志或 AI trace 后重试。')
  }
  return archive
}
