import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { SyncSnapshot } from '../shared/types.js'
import { createBackup, exportSelfContainedBackup, importBackupArchive, restoreBackup } from './backup.js'
import { getWebDavConfig, getWebDavConfigView, setWebDavMeta } from './settings.js'
import { decryptSnapshot, encryptSnapshot } from './sync-crypto.js'
import { deleteWebDav, getWebDav, listWebDav, putWebDav, testWebDav, type WebDavConfig } from './webdav.js'

const PREFIX = 'thinread-sync-'
const MAX_SNAPSHOTS = 10

function config(): WebDavConfig {
  const view = getWebDavConfig()
  if (!view.url) throw new Error('还没有配置 WebDAV。')
  return view
}

function createdAtFromName(name: string): string {
  const match = /^thinread-sync-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(name)
  if (!match) return new Date().toISOString()
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.000Z`
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
  const snapshots = await listWebDavSnapshots()
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

export async function pullWebDavSnapshot(dataDir: string, name: string, passphrase = ''): Promise<void> {
  const cfg = config()
  const safeName = path.basename(name)
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

export async function deleteWebDavSnapshot(name: string): Promise<void> {
  const safeName = path.basename(name)
  if (!safeName.startsWith(PREFIX) || (!safeName.endsWith('.zip') && !safeName.endsWith('.thinsync'))) {
    throw new Error('同步快照名称无效。')
  }
  await deleteWebDav(config(), safeName)
}

export function webDavSummary(): { configured: boolean; url: string } {
  const view = getWebDavConfigView()
  return { configured: Boolean(view.url && view.hasPassword), url: view.url }
}
