import { dialog, ipcMain, shell } from 'electron'
import type { BrowserWindow, OpenDialogOptions } from 'electron'

import {
  bookIdArgs,
  bookShelfStatusArgs,
  idArgs,
  pdfAnnotationSaveArgs,
  pdfAnnotationUpdateArgs,
  pdfAnnotationsArgs,
} from '../../shared/ipc-schemas.js'
import { getNoteQuality, setBookShelfStatus } from '../db.js'
import {
  deletePdfAnnotation,
  listPdfAnnotations,
  listPdfAnnotationsForBook,
  savePdfAnnotation,
  updatePdfAnnotation,
} from '../db-pdf.js'
import { readAiUsage } from '../ai/usage.js'
import { getAiPricing, getWebDavConfigView, saveWebDavConfig } from '../settings.js'
import { chooseSyncFolder, deleteSyncSnapshot, getSyncStatus, mergeSyncSnapshot, pullSyncSnapshot, pushSyncSnapshot } from '../sync.js'
import { deleteWebDavSnapshot, listWebDavSnapshots, mergeWebDavSnapshot, pullWebDavSnapshot, pushWebDavSnapshot, testWebDavConnection } from '../webdav-sync.js'
import { parseIpc } from './parse.js'

export interface ExtrasContext {
  getWindow(): BrowserWindow | null
  dataDir: string
  cancelAllAiJobs(): void
}

/** 书架状态、用量/质量统计、文件夹同步和 PDF 标注；从 ipc.ts 拆出的独立领域。 */
export function registerExtrasIpc({ getWindow, dataDir, cancelAllAiJobs }: ExtrasContext): void {
  ipcMain.handle('books:set-shelf-status', (_event, bookId: unknown, status: unknown) => {
    const [id, next] = parseIpc('books:set-shelf-status', bookShelfStatusArgs, [bookId, status])
    return setBookShelfStatus(id, next)
  })

  ipcMain.handle('ai:usage', (_event, days?: number) => readAiUsage(dataDir, days, getAiPricing()))

  ipcMain.handle('stats:note-quality', () => getNoteQuality())

  ipcMain.handle('sync:status', () => getSyncStatus())

  ipcMain.handle('sync:webdav-config', () => getWebDavConfigView())
  ipcMain.handle('sync:webdav-save', (_event, input) => saveWebDavConfig(input as Parameters<typeof saveWebDavConfig>[0]))
  ipcMain.handle('sync:webdav-test', () => testWebDavConnection())
  ipcMain.handle('sync:webdav-push', (_event, passphrase?: unknown) =>
    pushWebDavSnapshot(dataDir, typeof passphrase === 'string' ? passphrase.slice(0, 200) : ''),
  )
  ipcMain.handle('sync:webdav-list', () => listWebDavSnapshots())
  ipcMain.handle('sync:webdav-pull', async (_event, name: unknown, passphrase?: unknown) => {
    if (typeof name !== 'string' || !name.trim()) throw new Error('同步快照名称无效。')
    await pullWebDavSnapshot(dataDir, name, typeof passphrase === 'string' ? passphrase.slice(0, 200) : '')
    return { ok: true }
  })
  ipcMain.handle('sync:webdav-merge', async (_event, name: unknown, passphrase?: unknown) => {
    if (typeof name !== 'string' || !name.trim()) throw new Error('同步快照名称无效。')
    return mergeWebDavSnapshot(dataDir, name, typeof passphrase === 'string' ? passphrase.slice(0, 200) : '')
  })

  ipcMain.handle('sync:webdav-delete', (_event, name: unknown) => {
    if (typeof name !== 'string' || !name.trim()) throw new Error('同步快照名称无效。')
    return deleteWebDavSnapshot(name)
  })

  ipcMain.handle('sync:open-folder', async () => {
    const folder = getSyncStatus().folder
    if (!folder) throw new Error('还没有选择同步文件夹。')
    await shell.openPath(folder)
  })

  ipcMain.handle('sync:delete', (_event, name: unknown) => {
    if (typeof name !== 'string' || !name.trim()) throw new Error('同步快照名称无效。')
    deleteSyncSnapshot(name)
    return getSyncStatus()
  })

  ipcMain.handle('sync:choose-folder', async () => {
    const win = getWindow()
    const options: OpenDialogOptions = {
      title: '选择同步文件夹',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return getSyncStatus()
    return chooseSyncFolder(result.filePaths[0]!)
  })

  ipcMain.handle('sync:push', (_event, passphrase?: unknown) => {
    if (passphrase !== undefined && typeof passphrase !== 'string') throw new Error('加密口令无效。')
    return pushSyncSnapshot(dataDir, typeof passphrase === 'string' ? passphrase.slice(0, 200) : '')
  })

  ipcMain.handle('sync:merge', (_event, name: unknown, passphrase?: unknown) => {
    if (typeof name !== 'string' || !name.trim()) throw new Error('同步快照名称无效。')
    if (passphrase !== undefined && typeof passphrase !== 'string') throw new Error('加密口令无效。')
    return mergeSyncSnapshot(dataDir, name, typeof passphrase === 'string' ? passphrase.slice(0, 200) : '')
  })

  ipcMain.handle('sync:pull', async (_event, name: unknown, passphrase?: unknown) => {
    if (typeof name !== 'string' || !name.trim()) throw new Error('同步快照名称无效。')
    if (passphrase !== undefined && typeof passphrase !== 'string') throw new Error('加密口令无效。')
    cancelAllAiJobs()
    pullSyncSnapshot(dataDir, name, typeof passphrase === 'string' ? passphrase.slice(0, 200) : '')
    const window = getWindow()
    setTimeout(() => window?.webContents.reload(), 250)
    return { ok: true }
  })

  ipcMain.handle('pdf:annotations-all', (_event, bookId: unknown) => {
    const [id] = parseIpc('pdf:annotations-all', bookIdArgs, [bookId])
    return listPdfAnnotationsForBook(id)
  })

  ipcMain.handle('pdf:annotations', (_event, bookId: unknown, page: unknown) => {
    const [id, pageNumber] = parseIpc('pdf:annotations', pdfAnnotationsArgs, [bookId, page])
    return listPdfAnnotations(id, pageNumber)
  })

  ipcMain.handle('pdf:annotation-save', (_event, input: unknown) => {
    const [payload] = parseIpc('pdf:annotation-save', pdfAnnotationSaveArgs, [input])
    return savePdfAnnotation(payload)
  })

  ipcMain.handle('pdf:annotation-update', (_event, id: unknown, patch: unknown) => {
    const [annotationId, payload] = parseIpc('pdf:annotation-update', pdfAnnotationUpdateArgs, [id, patch])
    return updatePdfAnnotation(annotationId, payload)
  })

  ipcMain.handle('pdf:annotation-delete', (_event, id: unknown) => {
    const [annotationId] = parseIpc('pdf:annotation-delete', idArgs, [id])
    deletePdfAnnotation(annotationId)
  })
}
