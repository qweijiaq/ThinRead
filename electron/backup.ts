import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { strToU8, unzipSync, zipSync } from 'fflate'

import type { BackupInfo, BackupKind } from '../shared/types.js'
import { backupDatabaseTo, closeDatabase, initDatabase, SCHEMA_VERSION } from './db.js'
import { logError, logInfo, logWarn } from './logger.js'
import { initSettings } from './settings.js'

const FORMAT_VERSION = 2
const AUTO_KEEP = 8
const BACKUP_DIR = 'backups'
const BLOBS_DIR = 'blobs'
const ARCHIVE_PATTERN = /^backup-[A-Za-z0-9-]+\.zip$/

interface BackupMetadata {
  version: number
  id: string
  kind: BackupKind
  label: string
  createdAt: string
  appVersion?: string
  /** v2 备份引用的书文件 blob；用于清理不再被引用的 blob。 */
  bookHashes?: string[]
}

interface BookFileRef {
  hash: string
  size: number
}

export function backupsDir(dataDir: string): string {
  return path.join(dataDir, BACKUP_DIR)
}

/** 书文件按内容哈希存一份，多个备份共享，避免每份备份都复制整库书文件。 */
export function backupBlobsDir(dataDir: string): string {
  return path.join(backupsDir(dataDir), BLOBS_DIR)
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-').replace('Z', '')
}

function hashFile(file: string): string {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let read = 0
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, read))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

/** 把 books/ 下的文件写入内容寻址的 blob 存储，返回 manifest 和本次引用到的哈希。 */
function storeBookFiles(
  dataDir: string,
  manifest: Record<string, BookFileRef>,
): Set<string> {
  const root = path.join(dataDir, 'books')
  const blobs = backupBlobsDir(dataDir)
  ensureDir(blobs)
  const hashes = new Set<string>()

  const walk = (relative: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue
      const nextRelative = relative ? path.join(relative, entry.name) : entry.name
      const fullPath = path.join(root, nextRelative)
      if (entry.isDirectory()) {
        walk(nextRelative)
        continue
      }
      if (!entry.isFile()) continue
      const hash = hashFile(fullPath)
      const size = fs.statSync(fullPath).size
      manifest[`books/${nextRelative.split(path.sep).join('/')}`] = { hash, size }
      hashes.add(hash)
      const blob = path.join(blobs, hash)
      if (!fs.existsSync(blob)) {
        const temp = `${blob}.tmp`
        fs.copyFileSync(fullPath, temp)
        fs.renameSync(temp, blob)
      }
    }
  }

  walk('')
  return hashes
}

/** 删除没有被任何备份引用的 blob。 */
export function collectBackupGarbage(dataDir: string): number {
  const blobs = backupBlobsDir(dataDir)
  let names: string[] = []
  try {
    names = fs.readdirSync(blobs)
  } catch {
    return 0
  }
  const referenced = new Set<string>()
  const dir = backupsDir(dataDir)
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.zip.json')) continue
    const metaFile = path.join(dir, name)
    const archiveFile = metaFile.slice(0, -'.json'.length)
    if (!fs.existsSync(archiveFile)) {
      // 上次创建在“写元数据”和“写 zip”之间崩溃：元数据没有对应备份，直接清掉。
      fs.rmSync(metaFile, { force: true })
      continue
    }
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as Partial<BackupMetadata>
      for (const hash of meta.bookHashes ?? []) referenced.add(hash)
    } catch {
      // 坏元数据不影响其他备份的清理。
    }
  }
  let removed = 0
  for (const name of names) {
    if (referenced.has(name)) continue
    try {
      fs.rmSync(path.join(blobs, name), { force: true })
      removed++
    } catch {
      // 单个文件清理失败不影响其他 blob。
    }
  }
  return removed
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
      bookHashes: Array.isArray(parsed.bookHashes)
        ? parsed.bookHashes.filter((hash): hash is string => typeof hash === 'string')
        : undefined,
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
  const metaPath = metadataPath(archivePath)
  const tempDb = path.join(dir, `.${id}.db.tmp`)
  const files: Record<string, Uint8Array> = {}
  const manifest: Record<string, BookFileRef> = {}
  let metadataWritten = false

  try {
    backupDatabaseTo(tempDb)
    files['db/reading-notes.db'] = new Uint8Array(fs.readFileSync(tempDb))
    const settingsPath = path.join(dataDir, 'settings.json')
    if (fs.existsSync(settingsPath)) {
      files['settings.json'] = new Uint8Array(fs.readFileSync(settingsPath))
    }
    const hashes = storeBookFiles(dataDir, manifest)
    files['books-manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
    const metadata: BackupMetadata = {
      version: FORMAT_VERSION,
      id,
      kind,
      label: label.trim(),
      createdAt: now.toISOString(),
      bookHashes: [...hashes],
    }
    files['metadata.json'] = strToU8(JSON.stringify(metadata, null, 2))
    // 先写元数据再打包：即使打包失败，也不会让 blob 被误判为孤儿清理掉。
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf8')
    metadataWritten = true
    const archive = zipSync(files, { level: 6 })
    fs.writeFileSync(archivePath, archive)
    if (kind === 'auto') pruneAutoBackups(dataDir)
    return {
      id,
      kind,
      label: metadata.label,
      createdAt: metadata.createdAt,
      bytes: archive.byteLength,
    }
  } catch (error) {
    if (metadataWritten) fs.rmSync(metaPath, { force: true })
    collectBackupGarbage(dataDir)
    throw error
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
  collectBackupGarbage(dataDir)
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

const RESTORE_MARKER = '.restore-pending'
const LIVE_ENTRIES = ['reading-notes.db', 'reading-notes.db-wal', 'reading-notes.db-shm', 'settings.json', 'books']

/** 恢复前先验一遍备份库，避免把损坏或来自更新版本的库换进来。 */
function validateStagedDatabase(file: string): void {
  let conn: DatabaseSync | null = null
  try {
    conn = new DatabaseSync(file)
    const integrity = conn.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined
    if ((integrity?.integrity_check ?? '').toLowerCase() !== 'ok') {
      throw new Error('备份数据库没有通过完整性校验。')
    }
    const version = Number(
      (conn.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0,
    )
    if (version > SCHEMA_VERSION) {
      throw new Error(`备份来自更新版本的页边（schema ${version}），当前版本最多支持 ${SCHEMA_VERSION}。`)
    }
  } finally {
    conn?.close()
  }
}

/** 把已经移到 oldRoot 的旧数据搬回来；没搬过的条目保持原样。 */
function rollbackRestore(dataDir: string, oldRoot: string): void {
  for (const name of LIVE_ENTRIES) {
    const previous = path.join(oldRoot, name)
    if (!fs.existsSync(previous)) continue
    fs.rmSync(path.join(dataDir, name), { recursive: true, force: true })
    fs.renameSync(previous, path.join(dataDir, name))
  }
}

function findRestoreOldRoot(dataDir: string): string | null {
  let names: string[] = []
  try {
    names = fs
      .readdirSync(dataDir)
      .filter((name) => name.startsWith('.restore-old-'))
      .map((name) => {
        try {
          return { name, mtime: fs.statSync(path.join(dataDir, name)).mtimeMs }
        } catch {
          return { name, mtime: 0 }
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
      .map((item) => item.name)
  } catch {
    return null
  }
  return names[0] ? path.join(dataDir, names[0]) : null
}

/**
 * 启动时调用：如果上次恢复在“移动旧数据”和“换入新数据”之间崩溃，
 * 这里把旧数据搬回去。否则下次 initDatabase 会建一个空库，用户看到“书全没了”。
 */
export function recoverInterruptedRestore(dataDir: string): boolean {
  const marker = path.join(dataDir, RESTORE_MARKER)
  if (!fs.existsSync(marker)) return false

  let oldRoot: string | null = null
  try {
    const parsed = JSON.parse(fs.readFileSync(marker, 'utf8')) as { oldRoot?: unknown }
    if (typeof parsed.oldRoot === 'string') {
      const resolved = path.resolve(parsed.oldRoot)
      // marker 里只允许出现本数据目录下的 .restore-old-*，避免被篡改后删到别处。
      if (path.dirname(resolved) === path.resolve(dataDir) && path.basename(resolved).startsWith('.restore-old-')) {
        oldRoot = resolved
      }
    }
  } catch {
    // marker 损坏时按目录名兜底。
  }
  if (!oldRoot || !fs.existsSync(oldRoot)) oldRoot = findRestoreOldRoot(dataDir)
  if (!oldRoot) {
    fs.rmSync(marker, { force: true })
    return false
  }

  try {
    closeDatabase()
  } catch {
    // 启动阶段数据库可能还没打开。
  }

  try {
    rollbackRestore(dataDir, oldRoot)
    fs.rmSync(marker, { force: true })
    fs.rmSync(oldRoot, { recursive: true, force: true })
    logWarn('backup', '检测到未完成的备份恢复，已回滚到恢复前的数据', { oldRoot })
    return true
  } catch (error) {
    logError('backup:restore-recovery', error, { oldRoot })
    return false
  }
}

/** 解包到临时目录后替换当前数据；完成后调用方需要刷新窗口。 */
/**
 * 启动时数据库打不开或完整性校验失败：保留损坏文件，并尝试恢复最近一份备份。
 * 恢复失败时把损坏库留在 `.corrupt-*`，绝不直接删掉。
 */
export function recoverCorruptDatabase(dataDir: string): {
  recovered: boolean
  backupId?: string
  movedTo?: string
  reason?: string
} {
  const dbFile = path.join(dataDir, 'reading-notes.db')
  if (!fs.existsSync(dbFile)) return { recovered: false }
  let healthy = false
  try {
    const conn = new DatabaseSync(dbFile, { readOnly: true })
    try {
      const row = conn.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined
      healthy = (row?.integrity_check ?? '').toLowerCase() === 'ok'
    } finally {
      conn.close()
    }
  } catch {
    healthy = false
  }
  if (healthy) return { recovered: false }

  const movedTo = path.join(dataDir, `.corrupt-${Date.now()}-reading-notes.db`)
  try {
    fs.renameSync(dbFile, movedTo)
    fs.rmSync(`${dbFile}-wal`, { force: true })
    fs.rmSync(`${dbFile}-shm`, { force: true })
  } catch (error) {
    return { recovered: false, reason: error instanceof Error ? error.message : String(error) }
  }

  const latest = listBackups(dataDir)[0]
  if (!latest) {
    return { recovered: false, movedTo, reason: '没有可用备份' }
  }
  try {
    restoreBackup(dataDir, latest.id)
    logWarn('backup', '数据库损坏，已自动恢复最近备份', { backupId: latest.id, movedTo })
    return { recovered: true, backupId: latest.id, movedTo }
  } catch (error) {
    logError('backup', '数据库损坏，自动恢复备份失败', {
      backupId: latest.id,
      movedTo,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      recovered: false,
      movedTo,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export function restoreBackup(dataDir: string, id: string, options?: { safetyBackup?: boolean }): void {
  const archivePath = archivePathFor(dataDir, id)
  if (options?.safetyBackup) {
    try {
      createBackup(dataDir, 'auto', '恢复前自动备份')
    } catch (error) {
      throw new Error(`恢复前自动备份失败，已取消恢复：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const files = unzipSync(new Uint8Array(fs.readFileSync(archivePath)))
  const dbFile = files['db/reading-notes.db']
  if (!dbFile) throw new Error('备份里没有数据库文件。')

  const staging = path.join(dataDir, '.restore-staging')
  const oldRoot = path.join(dataDir, `.restore-old-${Date.now()}`)
  const marker = path.join(dataDir, RESTORE_MARKER)
  const stagedDb = path.join(staging, 'db', 'reading-notes.db')
  fs.rmSync(staging, { recursive: true, force: true })
  ensureDir(staging)

  let markerWritten = false
  try {
    const manifestRaw = files['books-manifest.json']
    let manifest: Record<string, BookFileRef> | null = null
    if (manifestRaw) {
      const parsed = JSON.parse(new TextDecoder().decode(manifestRaw)) as Record<string, unknown>
      manifest = {}
      for (const [archivePath, value] of Object.entries(parsed)) {
        const ref = value as Partial<BookFileRef> | null
        if (!ref || typeof ref.hash !== 'string' || typeof ref.size !== 'number') continue
        manifest[archivePath] = { hash: ref.hash, size: ref.size }
      }
    }

    for (const [name, data] of Object.entries(files)) {
      if (name === 'metadata.json' || name === 'books-manifest.json') continue
      if (name !== 'settings.json' && !name.startsWith('db/')) {
        // v1 备份把书文件直接打进 zip；v2 走 blob，这里不再解包书文件。
        if (!name.startsWith('books/') || manifest) continue
      }
      const target = safeArchivePath(staging, name)
      ensureDir(path.dirname(target))
      fs.writeFileSync(target, data)
    }

    if (manifest) {
      const blobs = backupBlobsDir(dataDir)
      for (const [archivePath, ref] of Object.entries(manifest)) {
        const target = safeArchivePath(staging, archivePath)
        const blob = path.join(blobs, ref.hash)
        if (!fs.existsSync(blob)) throw new Error(`备份缺少书文件：${archivePath}`)
        ensureDir(path.dirname(target))
        fs.copyFileSync(blob, target)
        if (fs.statSync(target).size !== ref.size || hashFile(target) !== ref.hash) {
          throw new Error(`备份书文件校验失败：${archivePath}`)
        }
      }
    }

    if (!fs.existsSync(stagedDb)) throw new Error('备份数据库解包失败。')
    validateStagedDatabase(stagedDb)

    closeDatabase()
    ensureDir(oldRoot)
    // 先写 marker 再动数据：中途崩溃时启动流程能据此回滚。
    fs.writeFileSync(marker, JSON.stringify({ oldRoot, createdAt: new Date().toISOString() }), 'utf8')
    markerWritten = true
    for (const name of LIVE_ENTRIES) {
      const source = path.join(dataDir, name)
      if (!fs.existsSync(source)) continue
      fs.renameSync(source, path.join(oldRoot, name))
    }

    // staging 与 dataDir 在同一文件系统，rename 是原子的；不会再出现“只复制了一半的库”。
    fs.renameSync(stagedDb, path.join(dataDir, 'reading-notes.db'))
    const stagedSettings = path.join(staging, 'settings.json')
    if (fs.existsSync(stagedSettings)) fs.renameSync(stagedSettings, path.join(dataDir, 'settings.json'))
    const stagedBooks = path.join(staging, 'books')
    if (fs.existsSync(stagedBooks)) fs.renameSync(stagedBooks, path.join(dataDir, 'books'))

    initDatabase(dataDir)
    initSettings(dataDir)
    fs.rmSync(marker, { force: true })
    markerWritten = false
    fs.rmSync(staging, { recursive: true, force: true })
    fs.rmSync(oldRoot, { recursive: true, force: true })
    logInfo('backup', '备份恢复完成', { id })
  } catch (error) {
    try {
      closeDatabase()
    } catch {
      // 数据库可能已经关闭。
    }
    try {
      rollbackRestore(dataDir, oldRoot)
      initDatabase(dataDir)
      initSettings(dataDir)
      if (markerWritten) {
        fs.rmSync(marker, { force: true })
        markerWritten = false
      }
    } catch {
      // 回滚也失败时保留 marker，下次启动继续尝试恢复。
    }
    fs.rmSync(staging, { recursive: true, force: true })
    if (!markerWritten) fs.rmSync(oldRoot, { recursive: true, force: true })
    throw error
  }
}
