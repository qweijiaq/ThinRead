import type { JSX } from 'react'

import type { ReaderMarkStyle } from '../../shared/types.js'
import { t } from '../lib/i18n.js'

interface ReaderSelectionToolbarProps {
  x: number
  y: number
  selection: string
  selectedMarkIds: string[]
  onCreateMark(style: ReaderMarkStyle, text: string): void
  onClearMarks(ids: string[]): void
  onAsk(text: string): void
  onMarginNote(text: string): void
  onShareQuote(text: string): void
  onListenSelection(text: string): void
  onDismiss(): void
}

/** 选中正文后浮出的操作条；只负责展示和转发，状态仍由 Reader 持有。 */
export function ReaderSelectionToolbar({
  x,
  y,
  selection,
  selectedMarkIds,
  onCreateMark,
  onClearMarks,
  onAsk,
  onMarginNote,
  onShareQuote,
  onListenSelection,
  onDismiss,
}: ReaderSelectionToolbarProps): JSX.Element {
  function close(): void {
    window.getSelection()?.removeAllRanges()
    onDismiss()
  }

  return (
    <div className="selection-toolbar" role="toolbar" aria-label={t('选中文本操作')} style={{ left: x, top: y }}>
      <button
        type="button"
        onClick={() => {
          onCreateMark('highlight', selection)
          close()
        }}
      >
        {t('高亮')}
      </button>
      <button
        type="button"
        onClick={() => {
          onCreateMark('underline', selection)
          close()
        }}
      >
        {t('划线')}
      </button>
      <button
        type="button"
        title={t('给选中文字加删除线')}
        onClick={() => {
          onCreateMark('strikethrough', selection)
          close()
        }}
      >
        {t('删除')}
      </button>
      {selectedMarkIds.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            onClearMarks(selectedMarkIds)
            close()
          }}
        >
          {t('清除')}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => {
          onAsk(selection)
          onDismiss()
        }}
      >
        {t('问 AI')}
      </button>
      <button
        type="button"
        onClick={() => {
          onMarginNote(selection)
          close()
        }}
      >
        {t('AI 批注')}
      </button>
      <button
        type="button"
        onClick={() => {
          onShareQuote(selection)
          onDismiss()
        }}
      >
        {t('分享')}
      </button>
      <button
        type="button"
        onClick={() => {
          onListenSelection(selection)
          onDismiss()
        }}
      >
        {t('朗读')}
      </button>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(`“${selection}”`)
          onDismiss()
        }}
      >
        {t('复制')}
      </button>
    </div>
  )
}
