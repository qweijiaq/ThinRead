import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { findPdfScript } from './pdf-ocr.js'

export interface BookCover {
  data: Uint8Array
  mime: string
  extension: string
}

const MAX_COVER_BYTES = 8 * 1024 * 1024
const TIMEOUT_MS = 60_000

/** 用 PDFKit 渲染第一页当封面；非 macOS 没有 PDFKit 时由书架显示文字封面。 */
export async function extractPdfCover(sourcePath: string): Promise<BookCover | null> {
  if (process.platform !== 'darwin') return null
  try {
    await fs.access(sourcePath)
  } catch {
    return null
  }
  let script: string
  try {
    script = findPdfScript()
  } catch {
    return null
  }

  const target = path.join(os.tmpdir(), `reading-notes-pdf-cover-${crypto.randomUUID()}.png`)
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('swift', [script, 'cover', sourcePath, target], { stdio: ['ignore', 'ignore', 'ignore'] })
      const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS)
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`PDF 封面进程退出（${code}）`))
      })
    })
    const buffer = await fs.readFile(target)
    if (buffer.length === 0 || buffer.length > MAX_COVER_BYTES) return null
    return { data: new Uint8Array(buffer), mime: 'image/png', extension: '.png' }
  } catch {
    return null
  } finally {
    await fs.rm(target, { force: true }).catch(() => undefined)
  }
}
