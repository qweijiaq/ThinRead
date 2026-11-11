import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { SyncSnapshot, SyncStatus } from '../shared/types.js'
import { createBackup, exportBackup, importBackupArchive, restoreBackup } from './backup.js'
import { getSettingsView, setSyncFolder } from './settings.js'
import { decryptSnapshot, encryptSnapshot, isEncryptedSnapshot } from './sync-crypto.js'

const PREFIX = 'thinread-sync-'
const MAX_SNAPSHOTS = 10

/**
 * 同步文件夹是一份「手动快照」而不是实时同步：
 * 每次推送把整库打包成 zip，拉取时先做安全备份再恢复。
 * 填了口令就用 AES-256-GCM 加密成 .thinsync，放进 iCloud Drive / Dropbox / NAS 也不会明文落盘。
 */
export function listSyncSnapshots(folder: string): SyncSnapshot[] {
  if (!folder) return []
  let names: string[] = []
  try {
    names = fs
      .readdirSync(folder)
      .filter((name) => name.startsWith(PREFIX) && (name.endsWith('.zip') || name.endsWith('.thinsync')))
  } catch {
    return []
  }
  return names
    .map((name) => {
      const full = path.join(folder, name)
      try {
        const stat = fs.statSync(full)
        return {
          name,
          path: full,
          createdAt: stat.mtime.toISOString(),
          size: stat.size,
          encrypted: name.endsWith('.thinsync') && isEncryptedSnapshot(full),
        }
      } catch {
        return null
      }
    })
    .filter((item): item is SyncSnapshot => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getSyncStatus(): SyncStatus {
  const folder = getSettingsView().syncFolder
  return { folder, snapshots: listSyncSnapshots(folder) }
}

export function chooseSyncFolder(folder: string): SyncStatus {
  setSyncFolder(folder)
  return getSyncStatus()
}

export function pushSyncSnapshot(dataDir: string, passphrase = ''): SyncSnapshot {
  const folder = getSettingsView().syncFolder
  if (!folder) throw new Error('还没有选择同步文件夹。')
  fs.mkdirSync(folder, { recursive: true })
  const info = createBackup(dataDir, 'manual', '同步快照')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const secret = passphrase.trim()
  const name = `${PREFIX}${stamp}${secret ? '.thinsync' : '.zip'}`
  const destination = path.join(folder, name)

  if (secret) {
    const temp = path.join(os.tmpdir(), `${PREFIX}${stamp}.zip`)
    try {
      exportBackup(dataDir, info.id, temp)
      encryptSnapshot(temp, destination, secret)
    } finally {
      fs.rmSync(temp, { force: true })
    }
  } else {
    exportBackup(dataDir, info.id, destination)
  }

  const stat = fs.statSync(destination)
  for (const old of listSyncSnapshots(folder).slice(MAX_SNAPSHOTS)) {
    try {
      fs.unlinkSync(old.path)
    } catch {
      // 旧快照清理失败不影响本次推送。
    }
  }
  return {
    name,
    path: destination,
    createdAt: stat.mtime.toISOString(),
    size: stat.size,
    encrypted: Boolean(secret),
  }
}

export function pullSyncSnapshot(dataDir: string, name: string, passphrase = ''): void {
  const folder = getSettingsView().syncFolder
  if (!folder) throw new Error('还没有选择同步文件夹。')
  const safeName = path.basename(name)
  if (!safeName.startsWith(PREFIX) || (!safeName.endsWith('.zip') && !safeName.endsWith('.thinsync'))) {
    throw new Error('同步快照名称无效。')
  }
  const source = path.join(folder, safeName)
  if (!fs.existsSync(source)) throw new Error('找不到这个同步快照。')

  const encrypted = safeName.endsWith('.thinsync')
  let archive = source
  let temp: string | null = null
  if (encrypted) {
    temp = path.join(os.tmpdir(), `${PREFIX}pull-${Date.now()}.zip`)
    decryptSnapshot(source, temp, passphrase)
    archive = temp
  }
  try {
    const info = importBackupArchive(dataDir, archive)
    restoreBackup(dataDir, info.id, { safetyBackup: true })
  } finally {
    if (temp) fs.rmSync(temp, { force: true })
  }
}
