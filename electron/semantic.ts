import fs from 'node:fs'
import path from 'node:path'

import { env, pipeline } from '@huggingface/transformers'
import type { FeatureExtractionPipeline } from '@huggingface/transformers'

import { listNotesForEmbedding, listSemanticCandidates, saveNoteEmbedding } from './db.js'
import type { RelatedNote } from '../shared/types.js'

// 量化后的 BGE-small-zh 约 23MB；首次使用会从镜像下载并缓存到 userData/models。
const MODEL = 'Xenova/bge-small-zh-v1.5'
const MIN_SCORE = 0.55
const BATCH_SIZE = 4
const RETRY_DELAY = 5 * 60 * 1000

let cacheDir: string | null = null
let extractor: FeatureExtractionPipeline | null = null
let loading: Promise<FeatureExtractionPipeline> | null = null
let warming: Promise<void> | null = null
let onReady: (() => void) | null = null
let lastFailure = 0
let announced = false

export function configureSemantic(dataDir: string, ready: () => void): void {
  cacheDir = path.join(dataDir, 'models')
  env.cacheDir = cacheDir
  env.allowLocalModels = true
  const host = process.env.HF_ENDPOINT?.trim() || 'https://hf-mirror.com/'
  env.remoteHost = host.endsWith('/') ? host : `${host}/`
  onReady = ready
  const timer = setTimeout(() => {
    if (hasModel() && listNotesForEmbedding(MODEL).length > 0) void warm()
  }, 3000)
  timer.unref()
}

/**
 * 返回语义相关的其他书笔记；模型尚未就绪时返回 null，调用方回退到标签匹配。
 * 模型未下载时不阻塞请求：后台下载并建索引，完成后通过 onReady 通知界面重查。
 */
export async function semanticRelatedNotes(
  bookId: string,
  queryText: string,
  limit = 6,
): Promise<RelatedNote[] | null> {
  const query = queryText.replace(/\s+/g, ' ').trim()
  if (query.length < 4) {
    debug('skip: query too short')
    return null
  }
  const candidates = listSemanticCandidates(bookId)
  debug('start', { bookId, queryLength: query.length, candidates: candidates.length, model: hasModel(), warming: Boolean(warming) })
  if (candidates.length === 0) return []

  if (!hasModel()) {
    void warm()
    debug('model missing, fallback while warming')
    return null
  }
  if (lastFailure > 0 && Date.now() - lastFailure < RETRY_DELAY) {
    debug('recent failure, fallback')
    return null
  }

  try {
    await warm()
    const ready = listSemanticCandidates(bookId).filter(
      (note) => note.vector && note.vector.length > 0 && note.model === MODEL,
    )
    debug('ready', { indexed: ready.length })
    if (ready.length === 0) return null
    const [vector] = await embed([query.slice(0, 1200)])
    if (!vector) return null

    const scored = ready
      .map((note) => ({
        id: note.id,
        bookId: note.bookId,
        bookTitle: note.bookTitle,
        chapterId: note.chapterId,
        chapterTitle: note.chapterTitle,
        title: note.title,
        content: note.content,
        tags: note.tags,
        score: Math.max(0, Math.min(1, dot(vector, note.vector ?? []))),
      }))
      .filter((note) => note.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    debug('matched', scored.map((note) => `${note.title}:${note.score.toFixed(3)}`))
    return scored
  } catch (error) {
    lastFailure = Date.now()
    debug('error', error instanceof Error ? error.message : error)
    console.warn('[semantic] 语义索引不可用，已回退到标签匹配', error instanceof Error ? error.message : error)
    return null
  }
}

function debug(...args: unknown[]): void {
  if (process.env.DEBUG_SEMANTIC) console.log('[semantic]', ...args)
}

function hasModel(): boolean {
  if (!cacheDir) return false
  const dir = path.join(cacheDir, MODEL, 'onnx')
  try {
    return fs.readdirSync(dir).some((file) => file.endsWith('.onnx'))
  } catch {
    return false
  }
}

async function loadExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor
  if (!loading) {
    loading = pipeline('feature-extraction', MODEL, { dtype: 'q8' }) as unknown as Promise<FeatureExtractionPipeline>
  }
  try {
    extractor = await loading
    return extractor
  } catch (error) {
    loading = null
    throw error
  }
}

async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const model = await loadExtractor()
  const output = await model(texts, { pooling: 'mean', normalize: true })
  return output.tolist() as number[][]
}

/** 把尚未建立索引的笔记补齐；多个入口共用同一个后台任务。 */
function warm(): Promise<void> {
  if (warming) return warming
  warming = (async () => {
    const pending = listNotesForEmbedding(MODEL)
    if (pending.length === 0) {
      if (hasModel()) await loadExtractor()
    } else {
      for (let index = 0; index < pending.length; index += BATCH_SIZE) {
        const batch = pending.slice(index, index + BATCH_SIZE)
        const vectors = await embed(batch.map(noteText))
        batch.forEach((note, offset) => {
          const vector = vectors[offset]
          if (vector && vector.length > 0) saveNoteEmbedding(note.id, MODEL, vector)
        })
      }
    }
    if (!announced) {
      announced = true
      onReady?.()
    }
  })()
    .catch((error: unknown) => {
      lastFailure = Date.now()
      console.warn('[semantic] 索引构建失败，稍后重试', error instanceof Error ? error.message : error)
    })
    .finally(() => {
      warming = null
    })
  return warming
}

function noteText(note: { title: string; content: string; tags: string[] }): string {
  const tags = note.tags.join(' ')
  return `${note.title}\n${tags}\n${note.content}`.slice(0, 1200)
}

function dot(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let sum = 0
  for (let index = 0; index < a.length; index++) sum += a[index]! * b[index]!
  return sum
}
