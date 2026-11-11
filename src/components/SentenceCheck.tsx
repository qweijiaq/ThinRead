import { useMemo, type JSX } from 'react'

import type { Note } from '../../shared/types.js'
import { t } from '../lib/i18n.js'

interface SentenceCheckProps {
  content: string
  evidenceNotes: Note[]
  onJumpQuote(quote: string): void
}

interface SentenceRow {
  text: string
  heading: boolean
  match: Note | null
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

function bigrams(value: string): Set<string> {
  const chars = [...value]
  const result = new Set<string>()
  for (let index = 0; index < chars.length - 1; index++) {
    result.add(`${chars[index]}${chars[index + 1]}`)
  }
  return result
}

function similarity(left: string, right: string): number {
  const a = normalize(left)
  const b = normalize(right)
  if (!a || !b) return 0
  if (a.includes(b) || b.includes(a)) return 1
  const first = bigrams(a)
  const second = bigrams(b)
  if (first.size === 0 || second.size === 0) return 0
  let overlap = 0
  for (const item of first) if (second.has(item)) overlap++
  return (2 * overlap) / (first.size + second.size)
}

function bestEvidence(sentence: string, notes: Note[]): Note | null {
  let best: { note: Note; score: number } | null = null
  for (const note of notes) {
    const quote = note.quote?.trim()
    if (!quote) continue
    const score = Math.max(
      similarity(sentence, quote),
      similarity(sentence, note.content) * 0.82,
      similarity(sentence, note.title) * 0.55,
    )
    if (score >= 0.34 && (!best || score > best.score)) best = { note, score }
  }
  return best?.note ?? null
}

function splitSentences(content: string): Array<{ text: string; heading: boolean }> {
  const rows: Array<{ text: string; heading: boolean }> = []
  for (const line of content.split(/\n+/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const heading = /^#{1,6}\s+/.test(trimmed)
    const text = heading ? trimmed.replace(/^#{1,6}\s+/, '') : trimmed
    if (heading) {
      rows.push({ text, heading: true })
      continue
    }
    for (const part of text.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [text]) {
      const sentence = part.trim()
      if (sentence) rows.push({ text: sentence, heading: false })
    }
  }
  return rows
}

function quoteSnippet(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > 64 ? `${flat.slice(0, 64)}…` : flat
}

/**
 * 读薄稿逐句核对：用本章已有卡片的原文依据做近似匹配。
 * 这是辅助阅读，不是判定器；未匹配只代表需要人工看一眼。
 */
export function SentenceCheck({ content, evidenceNotes, onJumpQuote }: SentenceCheckProps): JSX.Element {
  const rows = useMemo<SentenceRow[]>(
    () =>
      splitSentences(content).map((item) => ({
        ...item,
        match: item.heading ? null : bestEvidence(item.text, evidenceNotes),
      })),
    [content, evidenceNotes],
  )
  const checked = rows.filter((row) => !row.heading)
  const matched = checked.filter((row) => row.match).length

  return (
    <div className="sentence-check">
      <div className="sentence-check-summary">
        <span>{t('逐句核对')}</span>
        <span className="muted">{t('已找到依据')} {matched}/{checked.length} {t('句')}</span>
      </div>
      <p className="sentence-check-hint">
        {t('按本章已有卡片的原文依据做近似匹配；未匹配不等于没有依据，建议回到原文确认。')}
      </p>
      {rows.map((row, index) =>
        row.heading ? (
          <h4 key={`h-${index}`} className="sentence-check-heading">{row.text}</h4>
        ) : (
          <div
            key={`s-${index}`}
            className={`sentence-check-row ${row.match ? 'is-evidence' : 'is-pending'}`}
          >
            <p className="sentence-check-text">
              {row.text}
              <span className={`sentence-check-status ${row.match ? 'ok' : 'warn'}`}>
                {row.match ? t('有依据') : t('待核对')}
              </span>
            </p>
            {row.match ? (
              <button
                type="button"
                className="sentence-check-evidence"
                onClick={() => row.match?.quote && onJumpQuote(row.match.quote)}
                title={t('回到原文')}
              >
                <span>{row.match.title}</span>
                <em>“{quoteSnippet(row.match.quote ?? '')}”</em>
              </button>
            ) : null}
          </div>
        ),
      )}
    </div>
  )
}
