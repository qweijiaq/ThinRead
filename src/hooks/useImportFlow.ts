import { useCallback, useState } from 'react'

import type { BookSummary, HighlightImportResult } from '../../shared/types.js'
import type { BackgroundTask } from '../components/TaskCenter.js'
import { messageOf } from '../lib/errors.js'
import { t } from '../lib/i18n.js'

import type { ToastState } from './useToast.js'

interface ImportFlowOptions {
  bookId: string | null
  openBook(bookId: string): Promise<void>
  refreshBook(bookId: string): Promise<void>
  setBooks: React.Dispatch<React.SetStateAction<BookSummary[]>>
  setTasks: React.Dispatch<React.SetStateAction<BackgroundTask[]>>
  notify(toast: ToastState): void
}

export interface ImportFlowState {
  importing: boolean
  importOpen: boolean
  setImportOpen: React.Dispatch<React.SetStateAction<boolean>>
  mergeOpen: boolean
  setMergeOpen: React.Dispatch<React.SetStateAction<boolean>>
  splitOpen: boolean
  setSplitOpen: React.Dispatch<React.SetStateAction<boolean>>
  importFile(): Promise<BookSummary | null>
  handleImported(imported: BookSummary): Promise<void>
  handleOcrStarted(fileName: string): void
  handleHighlightsImported(result: HighlightImportResult): Promise<void>
  handleMerged(merged: BookSummary): Promise<void>
  handleSplit(newBook: BookSummary): Promise<void>
}

/** 导入入口：文件、划线、OCR、合并/拆分完成后的状态刷新与提示。 */
export function useImportFlow(options: ImportFlowOptions): ImportFlowState {
  const { bookId, openBook, refreshBook, setBooks, setTasks, notify } = options
  const [importing, setImporting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)

  const importFile = useCallback(async (): Promise<BookSummary | null> => {
    setImporting(true)
    try {
      return await window.api.importBook()
    } finally {
      setImporting(false)
    }
  }, [])

  const handleImported = useCallback(
    async (imported: BookSummary) => {
      setBooks((current) => [imported, ...current.filter((item) => item.id !== imported.id)])
      const hiddenNote =
        imported.hiddenChapterCount > 0 ? `${t('，自动隐藏了')} ${imported.hiddenChapterCount} ${t('个疑似目录/版权页')}` : ''
      notify({
        kind: 'info',
        text: `${t('已导入')}《${imported.title}》，${t('共')} ${imported.chapterCount} ${t('节')}${hiddenNote}`,
      })
      setImportOpen(false)
      await openBook(imported.id)
    },
    [notify, openBook, setBooks],
  )

  const handleOcrStarted = useCallback(
    (fileName: string) => {
      const task: BackgroundTask = {
        id: 'ocr',
        kind: 'import',
        title: t('扫描版 PDF OCR'),
        detail: fileName,
        done: 0,
        total: 0,
        status: 'running',
      }
      setTasks((current) => {
        const existing = current.find((item) => item.id === 'ocr')
        if (existing) {
          return current.map((item) =>
            item.id === 'ocr'
              ? {
                  ...item,
                  title: task.title,
                  detail: fileName,
                  status: 'running',
                  done: item.status === 'running' ? item.done : 0,
                  total: item.status === 'running' ? item.total : 0,
                }
              : item,
          )
        }
        return [task, ...current].slice(0, 6)
      })
      setImportOpen(false)
      notify({ kind: 'info', text: `${t('已开始 OCR')}：《${fileName}》${t('，进度在右下角任务中心。')}` })
    },
    [notify, setTasks],
  )

  const handleHighlightsImported = useCallback(
    async (result: HighlightImportResult) => {
      setBooks(await window.api.listBooks())
      notify({
        kind: 'info',
        text: `${t('已导入')} ${result.books.length} ${t('本书的')} ${result.highlights} ${t('条划线。')}`,
      })
      setImportOpen(false)
      if (result.books.length === 1 && result.books[0]) await openBook(result.books[0].id)
    },
    [notify, openBook, setBooks],
  )

  const handleMerged = useCallback(
    async (merged: BookSummary) => {
      try {
        setBooks(await window.api.listBooks())
        setMergeOpen(false)
        notify({ kind: 'info', text: `${t('已合并为')}《${merged.title}》。` })
        await openBook(merged.id)
      } catch (err) {
        notify({ kind: 'error', text: messageOf(err) })
      }
    },
    [notify, openBook, setBooks],
  )

  const handleSplit = useCallback(
    async (newBook: BookSummary) => {
      try {
        setBooks(await window.api.listBooks())
        setSplitOpen(false)
        notify({ kind: 'info', text: `${t('已拆出')}《${newBook.title}》。` })
        if (bookId) await refreshBook(bookId)
      } catch (err) {
        notify({ kind: 'error', text: messageOf(err) })
      }
    },
    [bookId, notify, refreshBook, setBooks],
  )

  return {
    importing,
    importOpen,
    setImportOpen,
    mergeOpen,
    setMergeOpen,
    splitOpen,
    setSplitOpen,
    importFile,
    handleImported,
    handleOcrStarted,
    handleHighlightsImported,
    handleMerged,
    handleSplit,
  }
}
