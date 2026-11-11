import fs from 'node:fs'
import path from 'node:path'

import type { SyncSnapshot, SyncStatus } from '../shared/types.js'
import { createBackup, exportBackup, importBackupArchive, restoreBackup } from './backup.js'
import { getSettingsView, setSyncFolder } from './settings.js'

const PREFIX = 'thinread-sync-'
const MAX_SNAPSHOTS = 10

/**
 * 同步文件夹是一份「手动快照」而不是实时同步：
 * 每次推送把整库打包成 zip，拉取时先做安全备份再恢复。
 * 这样不依赖任何服务端，也能放进 iCloud Drive / Dropbox / NAS。
 */
export function listSyncSnapshots(folder: string): SyncSnapshot[] {
  if (!folder) return []
  let names: string[] = []
  try {
    names = fs.readdirSync(folder).filter((name) => name.startsWith(PREFIX) && name.endsWith('.zip'))
  } catch {
    return []
  }
  return names
    .map((name) => {
      const full = path.join(folder, name)
      try {
        const stat = fs.statSync(full)
        return { name, path: full, createdAt: stat.mtime.toISOString(), size: stat.size }
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

export function pushSyncSnapshot(dataDir: string): SyncSnapshot {
  const folder = getSettingsView().syncFolder
  if (!folder) throw new Error('还没有选择同步文件夹。')
  fs.mkdirSync(folder, { recursive: true })
  const info = createBackup(dataDir, 'manual', '同步快照')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `${PREFIX}${stamp}.zip`
  const destination = path.join(folder, name)
  exportBackup(dataDir, info.id, destination)
  const stat = fs.statSync(destination)
  for (const old of listSyncSnapshots(folder).slice(MAX_SNAPSHOTS)) {
    try {
      fs.unlinkSync(old.path)
    } catch {
      // 旧快照清理失败不影响本次推送。
    }
  }
  return { name, path: destination, createdAt: stat.mtime.toISOString(), size: stat.size }
}

export function pullSyncSnapshot(dataDir: string, name: string): void {
  const folder = getSettingsView().syncFolder
  if (!folder) throw new Error('还没有选择同步文件夹。')
  const safeName = path.basename(name)
  if (!safeName.startsWith(PREFIX) || !safeName.endsWith('.zip')) throw new Error('同步快照名称无效。')
  const source = path.join(folder, safeName)
  if (!fs.existsSync(source)) throw new Error('找不到这个同步快照。')
  const info = importBackupArchive(dataDir, source)
  restoreBackup(dataDir, info.id, { safetyBackup: true })
}
