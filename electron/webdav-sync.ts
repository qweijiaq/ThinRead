import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Notification } from 'electron'
import { zipSync } from 'fflate'
import os from 'node:os'
import path from 'node:path'

import type { MergeSnapshotResult, SyncSnapshot } from '../shared/types.js'
import { backupDatabaseTo } from './db.js'
import { createBackup, exportSelfContainedBackup, importBackupArchive, restoreBackup } from './backup.js'
import { mergeSnapshotArchive } from './sync.js'
import { getWebDavConfig, getWebDavConfigView, setWebDavMeta } from './settings.js'
import { decryptSnapshot, encryptSnapshot } from './sync-crypto.js'
import { deleteWebDav, getWebDav, listWebDav, putWebDav, testWebDav, type WebDavConfig } from './webdav.js'

const PREFIX = 'thinread-sync-'
const NOTES_PREFIX = 'thinread-notes-'
const MAX_SNAPSHOTS = 10

function config(): WebDavConfig {
  const view = getWebDavConfig()
  if (!view.url) throw new Error('还没有配置 WebDAV。')
  return view
}

function createdAtFromName(name: string): string {
  const match = /^thinread-(?:sync|notes)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(name)
  if (!match) return new Date().toISOString()
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.000Z`
}

function isNotesSnapshot(name: string): boolean {
  return name.startsWith(NOTES_PREFIX)
}

const NOTES_DB_TABLES = new Set([
  'notes',
  'pdf_annotations',
  'bookmarks',
  'reading_positions',
  'reading_stats_days',
  'reading_stats_books',
  'reading_stats_meta',
  'reading_plans',
  'weekly_reviews',
])

/** 把完整备份裁成只含用户笔记相关表的轻量数据库，删掉书籍和章节正文。 */
function compactNotesDatabase(file: string): void {
  const conn = new DatabaseSync(file)
  try {
    conn.exec('PRAGMA foreign_keys = OFF')
    const tables = (conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as unknown as Array<{ name: string }>)
    for (const table of tables) {
      if (!NOTES_DB_TABLES.has(table.name)) conn.exec(`DROP TABLE IF EXISTS "${table.name}"`)
    }
    conn.exec('VACUUM')
  } finally {
    conn.close()
  }
}

export async function testWebDavConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    await testWebDav(config())
    return { ok: true, message: 'WebDAV 连接成功，目录可写。' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function listWebDavSnapshots(): Promise<SyncSnapshot[]> {
  const names = await listWebDav(config())
  return names.map((name) => ({
    name,
    path: name,
    createdAt: createdAtFromName(name),
    size: 0,
    encrypted: name.endsWith('.thinsync'),
    notesOnly: isNotesSnapshot(name),
  }))
}

export async function pushWebDavSnapshot(dataDir: string, passphrase = ''): Promise<SyncSnapshot> {
  const cfg = config()
  await testWebDav(cfg)
  const info = createBackup(dataDir, 'manual', 'WebDAV 同步快照')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const secret = passphrase.trim()
  const name = `${PREFIX}${stamp}${secret ? '.thinsync' : '.zip'}`
  const temp = path.join(os.tmpdir(), `${PREFIX}${stamp}.zip`)
  const encrypted = path.join(os.tmpdir(), `${PREFIX}${stamp}.thinsync`)
  try {
    exportSelfContainedBackup(dataDir, info.id, temp)
    const source = secret ? encrypted : temp
    if (secret) encryptSnapshot(temp, encrypted, secret)
    await putWebDav(cfg, name, fs.readFileSync(source))
  } finally {
    fs.rmSync(temp, { force: true })
    fs.rmSync(encrypted, { force: true })
  }
  const snapshots = (await listWebDavSnapshots()).filter((item) => !item.notesOnly)
  for (const old of snapshots.slice(MAX_SNAPSHOTS)) {
    await deleteWebDav(cfg, old.name).catch(() => undefined)
  }
  setWebDavMeta({ lastPushAt: new Date().toISOString() })
  return {
    name,
    path: name,
    createdAt: createdAtFromName(name),
    size: 0,
    encrypted: Boolean(secret),
  }
}

/** 轻量模式：只备份数据库，不打包书文件；远端只能合并，不能整库恢复。 */
export async function pushWebDavNotesSnapshot(_dataDir: string, passphrase = ''): Promise<SyncSnapshot> {
  const cfg = config()
  await testWebDav(cfg)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const secret = passphrase.trim()
  const name = `${NOTES_PREFIX}${stamp}${secret ? '.thinsync' : '.zip'}`
  const temp = path.join(os.tmpdir(), `${NOTES_PREFIX}${stamp}.db`)
  const zipPath = path.join(os.tmpdir(), `${NOTES_PREFIX}${stamp}.zip`)
  const encrypted = path.join(os.tmpdir(), `${NOTES_PREFIX}${stamp}.thinsync`)
  try {
    backupDatabaseTo(temp)
    compactNotesDatabase(temp)
    fs.writeFileSync(zipPath, Buffer.from(zipSync({ 'db/reading-notes.db': new Uint8Array(fs.readFileSync(temp)) })))
    const source = secret ? encrypted : zipPath
    if (secret) encryptSnapshot(zipPath, encrypted, secret)
    await putWebDav(cfg, name, fs.readFileSync(source))
  } finally {
    fs.rmSync(temp, { force: true })
    fs.rmSync(zipPath, { force: true })
    fs.rmSync(encrypted, { force: true })
  }
  const snapshots = (await listWebDavSnapshots()).filter((item) => item.notesOnly)
  for (const old of snapshots.slice(MAX_SNAPSHOTS)) {
    await deleteWebDav(cfg, old.name).catch(() => undefined)
  }
  setWebDavMeta({ lastPushAt: new Date().toISOString() })
  return { name, path: name, createdAt: createdAtFromName(name), size: 0, encrypted: Boolean(secret), notesOnly: true }
}

export async function pullWebDavSnapshot(dataDir: string, name: string, passphrase = ''): Promise<void> {
  const cfg = config()
  const safeName = path.basename(name)
  if (isNotesSnapshot(safeName)) throw new Error('笔记库快照只能合并，不能整库恢复。')
  if (!safeName.startsWith(PREFIX) || (!safeName.endsWith('.zip') && !safeName.endsWith('.thinsync'))) {
    throw new Error('同步快照名称无效。')
  }
  const temp = path.join(os.tmpdir(), `${PREFIX}pull-${Date.now()}.zip`)
  const downloaded = path.join(os.tmpdir(), `${PREFIX}pull-${Date.now()}-raw`)
  try {
    fs.writeFileSync(downloaded, await getWebDav(cfg, safeName))
    const archive = safeName.endsWith('.thinsync') ? temp : downloaded
    if (safeName.endsWith('.thinsync')) decryptSnapshot(downloaded, temp, passphrase)
    const info = importBackupArchive(dataDir, archive)
    restoreBackup(dataDir, info.id, { safetyBackup: true })
    setWebDavMeta({ lastPullAt: new Date().toISOString() })
  } finally {
    fs.rmSync(temp, { force: true })
    fs.rmSync(downloaded, { force: true })
  }
}

export async function mergeWebDavSnapshot(
  dataDir: string,
  name: string,
  passphrase = '',
): Promise<MergeSnapshotResult> {
  const cfg = config()
  const safeName = path.basename(name)
  const valid = safeName.startsWith(PREFIX) || safeName.startsWith(NOTES_PREFIX)
  if (!valid || (!safeName.endsWith('.zip') && !safeName.endsWith('.thinsync'))) {
    throw new Error('同步快照名称无效。')
  }
  const archive = path.join(os.tmpdir(), `${PREFIX}merge-${Date.now()}.zip`)
  const decrypted = path.join(os.tmpdir(), `${PREFIX}merge-${Date.now()}-plain.zip`)
  try {
    fs.writeFileSync(archive, await getWebDav(cfg, safeName))
    const source = safeName.endsWith('.thinsync') ? decrypted : archive
    if (safeName.endsWith('.thinsync')) decryptSnapshot(archive, decrypted, passphrase)
    const result = mergeSnapshotArchive(dataDir, source)
    setWebDavMeta({ lastPullAt: new Date().toISOString() })
    return result
  } finally {
    fs.rmSync(archive, { force: true })
    fs.rmSync(decrypted, { force: true })
  }
}

export async function deleteWebDavSnapshot(name: string): Promise<void> {
  const safeName = path.basename(name)
  const valid = safeName.startsWith(PREFIX) || safeName.startsWith(NOTES_PREFIX)
  if (!valid || (!safeName.endsWith('.zip') && !safeName.endsWith('.thinsync'))) {
    throw new Error('同步快照名称无效。')
  }
  await deleteWebDav(config(), safeName)
}

export function webDavSummary(): { configured: boolean; url: string } {
  const view = getWebDavConfigView()
  return { configured: Boolean(view.url && view.hasPassword), url: view.url }
}


/** 启动检查：提示远端有更新；按设置每天自动推送一次笔记库。 */
export async function runWebDavStartupTasks(dataDir: string): Promise<void> {
  const view = getWebDavConfigView()
  if (!view.url || !view.hasPassword) return
  try {
    if (view.checkOnStartup) {
      const snapshots = await listWebDavSnapshots()
      const latest = snapshots[0]
      const last = view.lastPullAt || view.lastPushAt || ''
      if (latest && latest.createdAt > last && Notification.isSupported()) {
        new Notification({
          title: 'WebDAV 有新的同步快照',
          body: '打开设置 → WebDAV 同步，可以合并或恢复。',
        }).show()
      }
    }
    if (view.autoPushDaily) {
      const last = view.lastPushAt ? new Date(view.lastPushAt).getTime() : 0
      if (Date.now() - last > 24 * 60 * 60 * 1000) {
        await pushWebDavNotesSnapshot(dataDir)
      }
    }
  } catch {
    // 启动检查失败不阻塞应用。
  }
}
