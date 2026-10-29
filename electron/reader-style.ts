import { DEFAULT_READER_STYLE } from '../shared/types.js'
import type { ReaderStyle } from '../shared/types.js'

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function normalizeReaderStyle(input: unknown): ReaderStyle {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<ReaderStyle>
  return {
    fontFamily: raw.fontFamily === 'sans' ? 'sans' : 'serif',
    fontSize: clamp(Number(raw.fontSize), 14, 24, DEFAULT_READER_STYLE.fontSize),
    lineHeight: clamp(Number(raw.lineHeight), 1.4, 2.6, DEFAULT_READER_STYLE.lineHeight),
    paragraphSpacing: clamp(
      Number(raw.paragraphSpacing),
      0.2,
      2,
      DEFAULT_READER_STYLE.paragraphSpacing,
    ),
    indent: raw.indent !== false,
    theme:
      raw.theme === 'plain' || raw.theme === 'warm' || raw.theme === 'folio'
        ? raw.theme
        : 'paper',
  }
}

export function parseStyleJson(raw: string | null): ReaderStyle {
  if (!raw) return { ...DEFAULT_READER_STYLE }
  try {
    return normalizeReaderStyle(JSON.parse(raw) as unknown)
  } catch {
    return { ...DEFAULT_READER_STYLE }
  }
}
