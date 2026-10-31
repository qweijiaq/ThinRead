import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { strToU8, unzipSync, zipSync } from 'fflate'

import type { BackupInfo, BackupKind } from '../shared/types.js'
import { backupDatabaseTo, closeDatabase, initDatabase } from './db.js'
import { initSettings } from './settings.js'

const FORMAT_VERSION = 1
const AUTO_KEEP = 8
const BACKUP_DIR = 'backups'
const ARCHIVE_PATTERN = /^backup-[A-Za-z0-9-]+\.zip$/

interface BackupMetadata {
  version: number
  id: string
  kind: BackupKind
  label: string
  createdAt: string
  appVersion?: string
}

export function backupsDir(dataDir: string): string {
  return path.join(dataDir, BACKUP_DIR)
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-').replace('Z', '')
}

function addTree(
  files: Record<string, Uint8Array>,
  root: string,
  prefix: string,
  relative = '',
): void {
  const dir = path.join(root, relative)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue
    const nextRelative = relative ? path.join(relative, entry.name) : entry.name
    const fullPath = path.join(root, nextRelative)
    if (entry.isDirectory()) {
      addTree(files, root, prefix, nextRelative)
      continue
    }
    if (!entry.isFile()) continue
    const archivePath = `${prefix}/${nextRelative.split(path.sep).join('/')}`
    files[archivePath] = new Uint8Array(fs.readFileSync(fullPath))
  }
}

function metadataPath(archivePath: string): string {
  return `${archivePath}.json`
}

function readMetadata(archivePath: string): BackupMetadata | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath(archivePath), 'utf8')) as Partial<BackupMetadata>
    if (typeof parsed.id !== 'string' || typeof parsed.createdAt !== 'string') return null
    return {
      version: Number(parsed.version) || FORMAT_VERSION,
      id: parsed.id,
      kind: parsed.kind === 'auto' ? 'auto' : 'manual',
      label: typeof parsed.label === 'string' ? parsed.label : '',
      createdAt: parsed.createdAt,
      appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : undefined,
    }
  } catch {
    return null
  }
}

export function createBackup(dataDir: string, kind: BackupKind = 'manual', label = ''): BackupInfo {
  const dir = backupsDir(dataDir)
  ensureDir(dir)
  const now = new Date()
  const id = `backup-${timestamp(now)}-${kind}-${crypto.randomBytes(3).toString('hex')}`
  const archivePath = path.join(dir, `${id}.zip`)
  const tempDb = path.join(dir, `.${id}.db.tmp`)
  const files: Record<string, Uint8Array> = {}

  try {
    backupDatabaseTo(tempDb)
    files['db/reading-notes.db'] = new Uint8Array(fs.readFileSync(tempDb))
    const settingsPath = path.join(dataDir, 'settings.json')
    if (fs.existsSync(settingsPath)) {
      files['settings.json'] = new Uint8Array(fs.readFileSync(settingsPath))
    }
    addTree(files, path.join(dataDir, 'books'), 'books')
    const metadata: BackupMetadata = {
      version: FORMAT_VERSION,
      id,
      kind,
      label: label.trim(),
      createdAt: now.toISOString(),
    }
    files['metadata.json'] = strToU8(JSON.stringify(metadata, null, 2))
    const archive = zipSync(files, { level: 6 })
    fs.writeFileSync(archivePath, archive)
    fs.writeFileSync(metadataPath(archivePath), JSON.stringify(metadata, null, 2), 'utf8')
    if (kind === 'auto') pruneAutoBackups(dataDir)
    return {
      id,
      kind,
      label: metadata.label,
      createdAt: metadata.createdAt,
      bytes: archive.byteLength,
    }
  } finally {
    fs.rmSync(tempDb, { force: true })
  }
}

export function listBackups(dataDir: string): BackupInfo[] {
  const dir = backupsDir(dataDir)
  if (!fs.existsSync(dir)) return []
  const items: BackupInfo[] = []
  for (const name of fs.readdirSync(dir)) {
    if (!ARCHIVE_PATTERN.test(name)) continue
    const archivePath = path.join(dir, name)
    let stat: fs.Stats
    try {
      stat = fs.statSync(archivePath)
    } catch {
      continue
    }
    const meta = readMetadata(archivePath)
    items.push({
      id: name.slice(0, -'.zip'.length),
      kind: meta?.kind ?? (name.includes('-auto-') ? 'auto' : 'manual'),
      label: meta?.label ?? '',
      createdAt: meta?.createdAt ?? stat.mtime.toISOString(),
      bytes: stat.size,
    })
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function archivePathFor(dataDir: string, id: string): string {
  if (!/^backup-[A-Za-z0-9-]+$/.test(id)) throw new Error('备份编号无效。')
  const target = path.join(backupsDir(dataDir), `${id}.zip`)
  if (path.dirname(target) !== backupsDir(dataDir) || !fs.existsSync(target)) {
    throw new Error('找不到这个备份。')
  }
  return target
}

export function exportBackup(dataDir: string, id: string, destination: string): void {
  const archivePath = archivePathFor(dataDir, id)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(archivePath, destination)
}

/** 每天至少留一份自动备份；已有 24 小时内的每日备份时不重复创建。 */
export function ensureDailyBackup(dataDir: string): BackupInfo | null {
  const latest = listBackups(dataDir).find((item) => item.kind === 'auto' && item.label === '每日自动备份')
  if (latest && Date.now() - new Date(latest.createdAt).getTime() < 24 * 60 * 60 * 1000) return null
  try {
    return createBackup(dataDir, 'auto', '每日自动备份')
  } catch (error) {
    console.warn('[backup] daily snapshot failed', error instanceof Error ? error.message : error)
    return null
  }
}

export function deleteBackup(dataDir: string, id: string): void {
  const archivePath = archivePathFor(dataDir, id)
  fs.rmSync(archivePath, { force: true })
  fs.rmSync(metadataPath(archivePath), { force: true })
}

function pruneAutoBackups(dataDir: string): void {
  const autos = listBackups(dataDir).filter((item) => item.kind === 'auto')
  for (const item of autos.slice(AUTO_KEEP)) {
    try {
      deleteBackup(dataDir, item.id)
    } catch {
      // 清理旧备份失败不影响本次快照。
    }
  }
}

function safeArchivePath(stagingDir: string, name: string): string {
  const target = path.resolve(stagingDir, ...name.split('/'))
  if (target !== stagingDir && !target.startsWith(`${stagingDir}${path.sep}`)) {
    throw new Error('备份文件路径不安全。')
  }
  return target
}

/** 解包到临时目录后替换当前数据；完成后调用方需要刷新窗口。 */
export function restoreBackup(dataDir: string, id: string): void {
  const archivePath = archivePathFor(dataDir, id)
  const files = unzipSync(new Uint8Array(fs.readFileSync(archivePath)))
  const dbFile = files['db/reading-notes.db']
  if (!dbFile) throw new Error('备份里没有数据库文件。')

  const staging = path.join(dataDir, '.restore-staging')
  const oldRoot = path.join(dataDir, `.restore-old-${Date.now()}`)
  fs.rmSync(staging, { recursive: true, force: true })
  ensureDir(staging)
  ensureDir(oldRoot)

  try {
    for (const [name, data] of Object.entries(files)) {
      if (name === 'metadata.json') continue
      if (name !== 'settings.json' && !name.startsWith('db/') && !name.startsWith('books/')) continue
      const target = safeArchivePath(staging, name)
      ensureDir(path.dirname(target))
      fs.writeFileSync(target, data)
    }
    if (!fs.existsSync(path.join(staging, 'db', 'reading-notes.db'))) {
      throw new Error('备份数据库解包失败。')
    }

    closeDatabase()
    const current = [
      'reading-notes.db',
      'reading-notes.db-wal',
      'reading-notes.db-shm',
      'settings.json',
      'books',
    ]
    for (const name of current) {
      const source = path.join(dataDir, name)
      if (!fs.existsSync(source)) continue
      fs.renameSync(source, path.join(oldRoot, name))
    }

    const stagedDb = path.join(staging, 'db', 'reading-notes.db')
    fs.copyFileSync(stagedDb, path.join(dataDir, 'reading-notes.db'))
    const stagedSettings = path.join(staging, 'settings.json')
    if (fs.existsSync(stagedSettings)) fs.copyFileSync(stagedSettings, path.join(dataDir, 'settings.json'))
    const stagedBooks = path.join(staging, 'books')
    if (fs.existsSync(stagedBooks)) {
      fs.cpSync(stagedBooks, path.join(dataDir, 'books'), { recursive: true })
    }

    initDatabase(dataDir)
    initSettings(dataDir)
    fs.rmSync(staging, { recursive: true, force: true })
    fs.rmSync(oldRoot, { recursive: true, force: true })
  } catch (error) {
    try {
      closeDatabase()
    } catch {
      // 数据库可能已经关闭。
    }
    try {
      for (const name of ['reading-notes.db', 'reading-notes.db-wal', 'reading-notes.db-shm', 'settings.json', 'books']) {
        fs.rmSync(path.join(dataDir, name), { recursive: true, force: true })
      }
      for (const name of ['reading-notes.db', 'reading-notes.db-wal', 'reading-notes.db-shm', 'settings.json', 'books']) {
        const source = path.join(oldRoot, name)
        if (fs.existsSync(source)) fs.renameSync(source, path.join(dataDir, name))
      }
      initDatabase(dataDir)
      initSettings(dataDir)
    } catch {
      // 回滚也失败时保留错误，至少不要吞掉原始原因。
    }
    fs.rmSync(staging, { recursive: true, force: true })
    fs.rmSync(oldRoot, { recursive: true, force: true })
    throw error
  }
}
