import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { BookSummary } from '../shared/types.js'
import { judgeChapter, shouldAutoHideChapter } from './ai/classify.js'
import { insertBook } from './db.js'
import type { NewChapter } from './db.js'
import { parseEpub } from './parsers/epub.js'
import { parsePdf } from './parsers/pdf.js'

/** 导入和重新解析共用：给章节打上来源标记，并自动隐藏高置信度的非正文页。 */
export function classifyImportedChapters(chapters: NewChapter[]): NewChapter[] {
  const classified = chapters.map((chapter) => {
    const judgment = judgeChapter(chapter)
    return {
      ...chapter,
      hidden: shouldAutoHideChapter(judgment.kind, judgment.confidence),
      kind: judgment.kind,
      reason: judgment.reason || null,
      classifiedBy: 'heuristic' as const,
    }
  })

  // 规则再激进，也不能把整本书都藏起来。
  if (classified.length > 0 && classified.every((chapter) => chapter.hidden)) {
    const longest = classified.reduce((best, chapter) =>
      chapter.text.length > best.text.length ? chapter : best,
    )
    longest.hidden = false
  }
  return classified
}

/** 解析、自动清理并写入一本书；对话框导入和命令行导入共用这一条路径。 */
export async function importBookFile(sourcePath: string, dataDir: string): Promise<BookSummary> {
  const extension = path.extname(sourcePath).toLowerCase()
  if (extension !== '.epub' && extension !== '.pdf') {
    throw new Error('目前支持 EPUB 和 PDF。')
  }

  const buffer = await fs.readFile(sourcePath)
  const parsed =
    extension === '.epub' ? parseEpub(buffer, sourcePath) : await parsePdf(buffer, sourcePath)

  const chapters = classifyImportedChapters(parsed.chapters)

  const bookId = crypto.randomUUID()
  const bookDir = path.join(dataDir, 'books', bookId)
  await fs.mkdir(bookDir, { recursive: true })
  const storedPath = path.join(bookDir, `source${extension}`)
  await fs.writeFile(storedPath, buffer)

  try {
    return insertBook(
      {
        title: parsed.title,
        author: parsed.author,
        format: extension === '.epub' ? 'epub' : 'pdf',
        filePath: storedPath,
      },
      chapters,
      bookId,
    )
  } catch (error) {
    await fs.rm(bookDir, { recursive: true, force: true })
    throw error
  }
}
