import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { renderPdfPagesWithCanvas } from '../electron/parsers/pdf-vision.js'

test('vision PDF pages can be rasterized without macOS rendering', async () => {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument(options: Record<string, unknown>): { promise: Promise<{ numPages: number; getPage(page: number): Promise<unknown>; destroy(): Promise<void> }> }
  }
  const buffer = fs.readFileSync(path.join('samples', 'sample.pdf'))
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: false,
    verbosity: 0,
  }).promise
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thinread-render-test-'))
  try {
    const written = await renderPdfPagesWithCanvas(doc as never, dir, [1])
    assert.deepEqual(written, [1])
    const bytes = fs.statSync(path.join(dir, 'page-1.jpg')).size
    assert.ok(bytes > 1_000, `rendered page is too small: ${bytes} bytes`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    await doc.destroy()
  }
})
