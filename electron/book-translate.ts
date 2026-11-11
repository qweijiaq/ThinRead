import type { BookTranslationOptions } from '../shared/types.js'

import { translateChapter } from './ai/translate.js'
import {
  getBookSummary,
  getBookTranslationInfo,
  getChapter,
  getChapters,
  saveChapterTranslation,
} from './db.js'
import { getActiveSettings } from './settings.js'

const TRANSLATABLE_KINDS = new Set(['content', 'front', 'unknown'])
const MAX_CONCURRENCY = 2

export interface BookTranslationChapterEvent {
  chapterId: string
  title: string
  text: string
  html: string
  translatedAt: string
}

export interface BookTranslationProgressEvent {
  chapterId: string
  title: string
  done: number
  total: number
  translated: number
  message?: string
}

export interface BookTranslationRunResult {
  translated: number
  skipped: number
  failed: Array<{ chapterId: string; title: string; message: string }>
  cancelled: boolean
}

function hasTranslation(chapter: ReturnType<typeof getChapter>): boolean {
  // 旧版纯文本译文没有结构；全书翻译时顺手升级成保留标题/表格的 HTML。
  return Boolean(chapter.translatedHtml?.trim())
}

/** 全书翻译和任务中心使用同一套章节筛选规则。 */
export function selectTranslatableChapters(bookId: string, options?: BookTranslationOptions) {
  const requested = options?.chapterIds ? new Set(options.chapterIds) : null
  return getChapters(bookId).filter(
    (chapter) =>
      !chapter.hidden &&
      chapter.chars > 0 &&
      TRANSLATABLE_KINDS.has(chapter.kind) &&
      (!requested || requested.has(chapter.id)),
  )
}

/**
 * 整本翻译：按可见正文逐章翻译，默认跳过已有译文。
 * 单章失败不会中断全书，失败章节会交给任务中心重试。
 */
export async function runBookTranslation(args: {
  bookId: string
  options?: BookTranslationOptions
  signal: AbortSignal
  onProgress?: (event: BookTranslationProgressEvent) => void
  onChapterTranslated?: (event: BookTranslationChapterEvent) => void
}): Promise<BookTranslationRunResult> {
  const info = getBookTranslationInfo(args.bookId)
  if (!info.foreign) throw new Error('这本书看起来主要是中文，不需要翻译。')
  const book = getBookSummary(args.bookId)
  if (!book) throw new Error('找不到这本书。')

  const options = args.options ?? {}
  const selected = selectTranslatableChapters(args.bookId, options)
  if (selected.length === 0) {
    return { translated: 0, skipped: 0, failed: [], cancelled: false }
  }

  const config = getActiveSettings('notes')
  if (!config.apiKey && config.provider !== 'ollama' && config.provider !== 'lmstudio') {
    throw new Error('还没有配置 API Key，无法翻译原文。')
  }

  let translated = 0
  let skipped = 0
  let completed = 0
  let cursor = 0
  const failed: BookTranslationRunResult['failed'] = []

  const emit = (chapterId: string, title: string, message?: string): void => {
    args.onProgress?.({
      chapterId,
      title,
      done: completed,
      total: selected.length,
      translated,
      ...(message ? { message } : {}),
    })
  }

  const worker = async (): Promise<void> => {
    while (!args.signal.aborted) {
      const index = cursor++
      const meta = selected[index]
      if (!meta) return
      let chapter: ReturnType<typeof getChapter>
      try {
        chapter = getChapter(meta.id)
      } catch (error) {
        completed++
        failed.push({
          chapterId: meta.id,
          title: meta.title,
          message: error instanceof Error ? error.message : String(error),
        })
        emit(meta.id, meta.title)
        continue
      }

      if (!options.force && hasTranslation(chapter)) {
        skipped++
        completed++
        emit(meta.id, meta.title)
        continue
      }

      // 开始一章前先更新任务中心，长章节不会看起来卡住。
      emit(meta.id, meta.title, `正在翻译「${meta.title}」`)
      try {
        const result = await translateChapter({
          bookTitle: book.title,
          chapterTitle: chapter.title,
          html: chapter.formattedHtml ?? chapter.html ?? '',
          text: chapter.text,
          config,
          signal: args.signal,
        })
        if (args.signal.aborted) return
        const { translatedAt } = saveChapterTranslation(chapter.id, result.html, result.text)
        translated++
        args.onChapterTranslated?.({
          chapterId: chapter.id,
          title: chapter.title,
          text: result.text,
          html: result.html,
          translatedAt,
        })
      } catch (error) {
        if (args.signal.aborted) return
        failed.push({
          chapterId: chapter.id,
          title: chapter.title,
          message: error instanceof Error ? error.message : String(error),
        })
      }
      completed++
      emit(meta.id, meta.title)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENCY, selected.length) }, () => worker()),
  )

  return {
    translated,
    skipped,
    failed,
    cancelled: args.signal.aborted,
  }
}
