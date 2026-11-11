import { bridge } from '../lib/bridge.js'
import { useEffect, useMemo, useState, type JSX } from 'react'

import type { CitationMeta, CitationStyle } from '../../shared/types.js'
import { citationExtension, citationFilename, formatCitation } from '../lib/citation.js'
import { t } from '../lib/i18n.js'
import { Select } from './Select.js'

interface CitationDialogProps {
  open: boolean
  title: string
  author: string
  onClose(): void
}

const STYLE_OPTIONS: Array<{ value: CitationStyle; label: string }> = [
  { value: 'apa', label: 'APA' },
  { value: 'bibtex', label: 'BibTeX' },
  { value: 'ris', label: 'RIS' },
]

export function CitationDialog({ open, title, author, onClose }: CitationDialogProps): JSX.Element | null {
  const [style, setStyle] = useState<CitationStyle>('apa')
  const [meta, setMeta] = useState<CitationMeta>({
    title,
    author,
    year: '',
    publisher: '',
    url: '',
    doi: '',
  })
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setStyle('apa')
    setMeta({ title, author, year: '', publisher: '', url: '', doi: '' })
    setStatus(null)
  }, [author, open, title])

  const preview = useMemo(() => formatCitation(style, meta), [meta, style])

  if (!open) return null

  function patch(key: keyof CitationMeta, value: string): void {
    setMeta((current) => ({ ...current, [key]: value }))
    setStatus(null)
  }

  async function copy(): Promise<void> {
    try {
      await bridge.copyText(preview)
      setStatus(t('已复制引用'))
    } catch {
      setStatus(t('复制失败'))
    }
  }

  async function exportFile(): Promise<void> {
    try {
      const result = await bridge.saveTextFile(
        citationFilename(style, meta),
        preview,
        citationExtension(style),
      )
      if (result.saved) setStatus(`${t('已导出到')} ${result.path ?? ''}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal citation-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('导出引用')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{t('导出引用')}</h2>
            <p className="modal-subtitle">
              {t('补齐年份、出版社或 DOI 后，可复制 APA、BibTeX 或 RIS。')}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        <div className="citation-fields">
          <label>
            <span>{t('标题')}</span>
            <input value={meta.title} onChange={(event) => patch('title', event.target.value)} />
          </label>
          <label>
            <span>{t('作者')}</span>
            <input value={meta.author} onChange={(event) => patch('author', event.target.value)} />
          </label>
          <label>
            <span>{t('年份')}</span>
            <input
              value={meta.year}
              onChange={(event) => patch('year', event.target.value)}
              placeholder="2024"
              inputMode="numeric"
            />
          </label>
          <label>
            <span>{t('出版社 / 来源')}</span>
            <input
              value={meta.publisher}
              onChange={(event) => patch('publisher', event.target.value)}
              placeholder={t('可留空')}
            />
          </label>
          <label>
            <span>URL</span>
            <input value={meta.url} onChange={(event) => patch('url', event.target.value)} placeholder="https://…" />
          </label>
          <label>
            <span>DOI</span>
            <input value={meta.doi} onChange={(event) => patch('doi', event.target.value)} placeholder="10.…" />
          </label>
          <label className="citation-style">
            <span>{t('格式')}</span>
            <Select
              value={style}
              onChange={(value) => {
                setStyle(value as CitationStyle)
                setStatus(null)
              }}
              ariaLabel={t('引用格式')}
              options={STYLE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
          </label>
        </div>

        <pre className="citation-preview">{preview}</pre>

        <div className="modal-footer">
          <span className="citation-status">{status ?? t('信息只保存在本次导出里，不会写回书籍。')}</span>
          <div className="modal-footer-actions">
            <button type="button" className="ghost-button small" onClick={() => void copy()}>
              {t('复制引用')}
            </button>
            <button type="button" className="primary-button small" onClick={() => void exportFile()}>
              {t('导出文件')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
