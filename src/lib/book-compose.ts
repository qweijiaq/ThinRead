import type { BookComposeResult, BookGenerationProgress, LabArtifact } from '../../shared/types.js'

export interface GenerationView {
  running: boolean
  done: number
  total: number
  title: string
  status: BookGenerationProgress['status'] | null
  message: string
}

export const EMPTY_GENERATION: GenerationView = {
  running: false,
  done: 0,
  total: 0,
  title: '',
  status: null,
  message: '',
}

export function parseComposeArtifact(artifact: LabArtifact | null): BookComposeResult | null {
  if (!artifact) return null
  try {
    const parsed = JSON.parse(artifact.content) as Partial<BookComposeResult>
    if (typeof parsed.markdown === 'string' && parsed.markdown.trim()) {
      return {
        title: typeof parsed.title === 'string' ? parsed.title : artifact.title,
        markdown: parsed.markdown,
        sourceChapters: Number(parsed.sourceChapters) || 0,
        sourceChars: Number(parsed.sourceChars) || 0,
        outputChars: Number(parsed.outputChars) || parsed.markdown.length,
        durationMs: Number(parsed.durationMs) || 0,
        usage: parsed.usage,
        promptVersion: typeof parsed.promptVersion === 'string' ? parsed.promptVersion : undefined,
        model: typeof parsed.model === 'string' ? parsed.model : '',
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : artifact.createdAt,
        options: parsed.options ?? { length: 'tight', voice: 'calm' },
      }
    }
  } catch {
    // 旧版本只存了 Markdown 正文。
  }
  return {
    title: artifact.title,
    markdown: artifact.content,
    sourceChapters: 0,
    sourceChars: 0,
    outputChars: artifact.content.length,
    durationMs: 0,
    model: '',
    createdAt: artifact.createdAt,
    options: { length: 'tight', voice: 'calm' },
  }
}

export function versionLabel(artifact: LabArtifact): string {
  const date = new Date(artifact.createdAt)
  const stamp = Number.isNaN(date.getTime())
    ? artifact.createdAt
    : `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${stamp} · ${artifact.title}`
}

