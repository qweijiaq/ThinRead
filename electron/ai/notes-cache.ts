import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { GeneratedNote, NoteReport } from '../../shared/types.js'
import { generatedNoteListSchema } from '../../shared/schemas.js'
import type { Card, Chunk, CondenseOutput, GenerateArgs, GenerateResult } from './notes.js'

export const NOTES_PROMPT_VERSION = 'notes-v8'

const NOTES_CACHE_VERSION = 1
const NOTES_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000

interface NotesCacheEntry {
  version: number
  createdAt: string
  notes: GeneratedNote[]
  report: NoteReport
  cards: Card[]
}

export function notesCacheKey(args: GenerateArgs): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        prompt: NOTES_PROMPT_VERSION,
        provider: args.config.provider,
        baseUrl: args.config.baseUrl,
        model: args.config.model,
        mode: args.mode ?? 'standard',
        genre: args.genre ?? null,
        notesLanguage: args.notesLanguage ?? 'zh',
        visionMode: args.visionMode ?? 'auto',
        imageSignature: args.imageSignature ?? '',
        book: args.bookTitle,
        chapter: args.chapterTitle,
        // 只有正文参与缓存 key：排版 HTML、相关笔记变化不应让整章重新生成。
        text: args.chapterText.replace(/\r\n/g, '\n').trim(),
      }),
    )
    .digest('hex')
}

export async function readNotesCache(args: GenerateArgs, signal: AbortSignal): Promise<GenerateResult | null> {
  if (!args.cacheDir || args.demo || args.fresh || signal.aborted) return null
  try {
    const file = path.join(args.cacheDir, 'notes', `${notesCacheKey(args)}.json`)
    const entry = JSON.parse(await readFile(file, 'utf8')) as NotesCacheEntry
    if (entry.version !== NOTES_CACHE_VERSION) return null
    if (Date.now() - Date.parse(entry.createdAt) > NOTES_CACHE_TTL_MS) return null
    if (!Array.isArray(entry.notes) || !Array.isArray(entry.cards) || !entry.report) return null
    const notes = generatedNoteListSchema.safeParse(entry.notes)
    if (!notes.success) return null
    return {
      notes: notes.data,
      report: {
        ...entry.report,
        cached: true,
        cachedTokens: entry.report.usage?.totalTokens ?? 0,
        durationMs: 0,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        createdAt: new Date().toISOString(),
      },
    }
  } catch {
    return null
  }
}

export async function writeNotesCache(args: GenerateArgs, result: GenerateResult, cards: Card[]): Promise<void> {
  if (!args.cacheDir || args.demo) return
  try {
    const dir = path.join(args.cacheDir, 'notes')
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, `${notesCacheKey(args)}.json`)
    const temp = `${file}.${process.pid}.tmp`
    const entry: NotesCacheEntry = {
      version: NOTES_CACHE_VERSION,
      createdAt: new Date().toISOString(),
      notes: result.notes,
      report: result.report,
      cards,
    }
    await writeFile(temp, JSON.stringify(entry), 'utf8')
    await rename(temp, file)
  } catch {
    // 缓存写入失败不影响生成结果。
  }
}

/**
 * 读薄中间结果检查点：某几个小节失败时，下次只重跑失败的块，
 * 不把已经成功读薄的 18/22 个块全部重来。
 */
const NOTES_CHECKPOINT_VERSION = 1

interface NotesCheckpointChunk {
  compressed: string
  omitted: Array<{ text: string; reason: string }>
}

interface NotesCheckpointEntry {
  version: number
  createdAt: string
  chunks: Record<string, NotesCheckpointChunk>
}

export function chunkCacheKey(chunk: Chunk): string {
  const images = chunk.images.map((image) => image.signature).join(',')
  return createHash('sha256').update(`${chunk.title}\n${images}\n${chunk.text}`).digest('hex')
}

export async function readNotesCheckpoint(args: GenerateArgs): Promise<Map<string, CondenseOutput>> {
  const result = new Map<string, CondenseOutput>()
  if (!args.cacheDir || args.demo || args.fresh) return result
  try {
    const file = path.join(args.cacheDir, 'notes-checkpoint', `${notesCacheKey(args)}.json`)
    const entry = JSON.parse(await readFile(file, 'utf8')) as NotesCheckpointEntry
    if (entry.version !== NOTES_CHECKPOINT_VERSION) return result
    if (Date.now() - Date.parse(entry.createdAt) > NOTES_CACHE_TTL_MS) return result
    for (const [key, value] of Object.entries(entry.chunks ?? {})) {
      if (typeof value?.compressed !== 'string' || !value.compressed.trim()) continue
      result.set(key, {
        compressed: value.compressed,
        omitted: Array.isArray(value.omitted) ? value.omitted : [],
      })
    }
  } catch {
    // 检查点不存在或损坏时从零开始。
  }
  return result
}

export async function writeNotesCheckpoint(
  args: GenerateArgs,
  chunks: Map<string, CondenseOutput>,
): Promise<void> {
  if (!args.cacheDir || args.demo) return
  try {
    const dir = path.join(args.cacheDir, 'notes-checkpoint')
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, `${notesCacheKey(args)}.json`)
    const temp = `${file}.${process.pid}.tmp`
    const entry: NotesCheckpointEntry = {
      version: NOTES_CHECKPOINT_VERSION,
      createdAt: new Date().toISOString(),
      chunks: Object.fromEntries(
        [...chunks.entries()].map(([key, value]) => [
          key,
          { compressed: value.compressed, omitted: value.omitted },
        ]),
      ),
    }
    await writeFile(temp, JSON.stringify(entry), 'utf8')
    await rename(temp, file)
  } catch {
    // 检查点失败不影响本次生成。
  }
}


/** 启动时清理过期的读薄缓存和检查点，避免 userData 长期膨胀。 */
export async function pruneNotesCache(
  cacheDir: string,
  maxAgeMs = NOTES_CACHE_TTL_MS,
): Promise<number> {
  let removed = 0
  for (const folder of ['notes', 'notes-checkpoint']) {
    const dir = path.join(cacheDir, folder)
    let names: string[] = []
    try {
      names = (await readdir(dir)).filter((name) => name.endsWith('.json'))
    } catch {
      continue
    }
    const rows = await Promise.all(
      names.map(async (name) => {
        const file = path.join(dir, name)
        try {
          return { file, mtime: (await stat(file)).mtimeMs }
        } catch {
          return null
        }
      }),
    )
    for (const row of rows) {
      if (!row || Date.now() - row.mtime <= maxAgeMs) continue
      await unlink(row.file).catch(() => undefined)
      removed += 1
    }
  }
  return removed
}
