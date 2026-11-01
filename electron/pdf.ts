import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { BrowserWindow } from 'electron'

const PDF_MARGINS = { top: 0.6, bottom: 0.7, left: 0.6, right: 0.6 }

const FOOTER_TEMPLATE = [
  '<div style="width:100%;padding:0 16mm;color:#7a756b;font-size:9px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif">',
  '<span class="pageNumber"></span> / <span class="totalPages"></span>',
  '</div>',
].join('')

/**
 * 用 Electron 自带 Chromium 打印现有分享页 HTML，避免再打包一份浏览器。
 * HTML 由 buildBookBlogHtml 生成，脚本和外部资源已内联/移除。
 */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thinread-pdf-'))
  const file = path.join(dir, 'export.html')
  fs.writeFileSync(file, html, 'utf8')
  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      contextIsolation: true,
      javascript: false,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await window.loadFile(file)
    return await window.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: PDF_MARGINS,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: FOOTER_TEMPLATE,
    })
  } finally {
    if (!window.isDestroyed()) window.destroy()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
