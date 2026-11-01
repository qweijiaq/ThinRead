import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { gzip, gunzipSync } from 'node:zlib'

import type { SearchResult } from '../shared/types.js'
import type { SearchDocument } from './db.js'
import { searchDocuments, searchIndexSignature } from './db.js'

interface IndexCache {
  signature: string
  documents: SearchDocument[]
  inverted: Map<string, number[]>
}

interface SerializedIndex {
  version: number
  signature: string
  documents: SearchDocument[]
  inverted: Record<string, number[]>
}

const INDEX_VERSION = 1
const gzipAsync = promisify(gzip)
let cache: IndexCache | null = null
let building: Promise<IndexCache> | null = null
let cacheDir: string | null = null
let persisting: Promise<void> | null = null

/** 由主进程在确定用户数据目录后调用；未初始化时只在内存中工作。 */
export function initSearchIndex(dataDir: string): void {
  cacheDir = dataDir
}

function cacheFile(): string | null {
  return cacheDir ? path.join(cacheDir, 'search-index.json.gz') : null
}

function loadPersisted(signature: string): IndexCache | null {
  const file = cacheFile()
  if (!file || !fs.existsSync(file)) return null
  try {
    const parsed = JSON.parse(gunzipSync(fs.readFileSync(file)).toString('utf8')) as SerializedIndex
    if (parsed.version !== INDEX_VERSION || parsed.signature !== signature) return null
    if (!Array.isArray(parsed.documents) || !parsed.inverted || typeof parsed.inverted !== 'object') return null
    return {
      signature,
      documents: parsed.documents,
      inverted: new Map(Object.entries(parsed.inverted).filter((entry): entry is [string, number[]] => Array.isArray(entry[1]))),
    }
  } catch {
    return null
  }
}

function persist(next: IndexCache): void {
  const file = cacheFile()
  if (!file || persisting) return
  persisting = (async () => {
    try {
      const serialized: SerializedIndex = {
        version: INDEX_VERSION,
        signature: next.signature,
        documents: next.documents,
        inverted: Object.fromEntries(next.inverted),
      }
      const compressed = await gzipAsync(Buffer.from(JSON.stringify(serialized), 'utf8'))
      await fsp.mkdir(path.dirname(file), { recursive: true })
      await fsp.writeFile(file, compressed)
    } catch {
      // 索引缓存只是加速；写入失败下次重新构建即可。
    } finally {
      persisting = null
    }
  })()
}

function addToMap(map: Map<string, Set<number>>, token: string, documentIndex: number): void {
  const list = map.get(token) ?? new Set<number>()
  list.add(documentIndex)
  map.set(token, list)
}

/** 中文按单字 + 二元组切分，英文按词切分；不依赖 SQLite FTS5。 */
export function tokenize(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase()
  const tokens = new Set<string>()
  for (const match of normalized.matchAll(/[㐀-鿿]+/g)) {
    const run = match[0] ?? ''
    // 只索引二元组：单字查询走 LIKE，避免把整本书的每个字都挂进倒排表。
    for (let index = 0; index < run.length - 1; index++) {
      tokens.add(run.slice(index, index + 2))
    }
  }
  const latin = normalized.replace(/[㐀-鿿]+/g, ' ')
  for (const match of latin.matchAll(/[a-z0-9][a-z0-9_'-]*/g)) {
    const word = match[0] ?? ''
    if (word.length < 2) continue
    tokens.add(word)
    // well-being 这类词同时索引拆开的片段，查 well 也能命中。
    for (const part of word.split(/[-']/)) {
      if (part.length >= 2) tokens.add(part)
    }
  }
  return [...tokens]
}

function buildCache(): IndexCache {
  const signature = searchIndexSignature()
  if (cache && cache.signature === signature) return cache
  const persisted = loadPersisted(signature)
  if (persisted) {
    cache = persisted
    return persisted
  }
  const documents = searchDocuments()
  const temp = new Map<string, Set<number>>()
  documents.forEach((document, documentIndex) => {
    const tokens = new Set(tokenize(`${document.title}\n${document.title}\n${document.text}`))
    for (const token of tokens) addToMap(temp, token, documentIndex)
  })
  const inverted = new Map<string, number[]>()
  for (const [token, list] of temp) inverted.set(token, [...list])
  cache = { signature, documents, inverted }
  persist(cache)
  return cache
}

/** 分块建索引，避免大书库首次搜索时长时间占住主进程。 */
async function buildCacheAsync(): Promise<IndexCache> {
  if (building) return building
  building = (async () => {
    const signature = searchIndexSignature()
    if (cache && cache.signature === signature) return cache
    const persisted = loadPersisted(signature)
    if (persisted) {
      cache = persisted
      return persisted
    }
    const documents = searchDocuments()
    const temp = new Map<string, Set<number>>()
    for (let documentIndex = 0; documentIndex < documents.length; documentIndex++) {
      const document = documents[documentIndex]!
      const tokens = new Set(tokenize(`${document.title}\n${document.title}\n${document.text}`))
      for (const token of tokens) addToMap(temp, token, documentIndex)
      if (documentIndex % 40 === 39) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
    const inverted = new Map<string, number[]>()
    for (const [token, list] of temp) inverted.set(token, [...list])
    const next = { signature, documents, inverted }
    cache = next
    persist(next)
    return next
  })()
  try {
    return await building
  } finally {
    building = null
  }
}

function makeSnippet(text: string, query: string, tokens: string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const needle = query.toLowerCase()
  let index = flat.toLowerCase().indexOf(needle)
  let length = query.length
  if (index < 0) {
    for (const token of tokens) {
      index = flat.toLowerCase().indexOf(token)
      if (index >= 0) {
        length = token.length
        break
      }
    }
  }
  if (index < 0) return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat
  const start = Math.max(0, index - 56)
  const end = Math.min(flat.length, index + length + 72)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

function scoreDocument(document: SearchDocument, query: string, tokens: string[]): number {
  const title = document.title.toLowerCase()
  const text = document.text.toLowerCase()
  const needle = query.trim().toLowerCase()
  let score = title.includes(needle) ? 24 : 0
  for (const token of tokens) {
    if (title.includes(token)) score += 6
    let at = 0
    let hits = 0
    while ((at = text.indexOf(token, at)) >= 0) {
      hits++
      at += token.length
      if (hits >= 12) break
    }
    score += hits * 2
  }
  if (document.type === 'book') score += 8
  if (document.type === 'chapter') score += 2
  return score
}

function runSearch(index: IndexCache, query: string, limit: number): SearchResult[] {
  const queryTokens = [...new Set(tokenize(query))]
  let candidates: Set<number> | null = null
  for (const token of queryTokens) {
    const list = index.inverted.get(token)
    if (!list || list.length === 0) return []
    const current = new Set(list)
    if (candidates === null) candidates = current
    else for (const item of [...candidates]) if (!current.has(item)) candidates.delete(item)
    if (candidates.size === 0) return []
  }
  if (!candidates) return []

  const scored = [...candidates]
    .map((documentIndex) => {
      const document = index.documents[documentIndex]!
      return { document, score: scoreDocument(document, query, queryTokens) }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(limit, 1), 80))

  return scored.map(({ document }) => ({
    type: document.type,
    id: document.id,
    bookId: document.bookId,
    bookTitle: document.bookTitle,
    chapterId: document.chapterId,
    chapterTitle: document.chapterTitle,
    title: document.title,
    snippet: document.type === 'book' ? (document.meta ?? '') : makeSnippet(document.text, query, queryTokens),
    updatedAt: document.updatedAt,
  }))
}

function prepareQuery(rawQuery: string): string | null {
  const query = rawQuery.replace(/\s+/g, ' ').trim()
  if (query.length < 2) return null
  return tokenize(query).length === 0 ? null : query
}

/** 本地全文索引；签名不变时复用。返回 null 表示当前查询不适合索引。 */
export function searchIndex(rawQuery: string, limit = 40): SearchResult[] | null {
  const query = prepareQuery(rawQuery)
  if (!query) return null
  let index: IndexCache
  try {
    index = buildCache()
  } catch {
    return null
  }
  return runSearch(index, query, limit)
}

/** 与 searchIndex 相同，但索引分块构建，适合 IPC 等不能长时间阻塞的场景。 */
export async function searchIndexAsync(rawQuery: string, limit = 40): Promise<SearchResult[] | null> {
  const query = prepareQuery(rawQuery)
  if (!query) return null
  try {
    await warmSearchIndex()
    return runSearch(cache!, query, limit)
  } catch {
    return null
  }
}

/** 返回某一类型下所有匹配文档的 id；null 表示索引不可用，调用方应回退 LIKE。 */
export async function searchIndexIds(
  rawQuery: string,
  type: SearchResult['type'],
  limit = 500,
): Promise<string[] | null> {
  const query = prepareQuery(rawQuery)
  if (!query) return null
  try {
    await warmSearchIndex()
    const index = cache!
    const queryTokens = [...new Set(tokenize(query))]
    let candidates: Set<number> | null = null
    for (const token of queryTokens) {
      const list = index.inverted.get(token)
      if (!list || list.length === 0) return []
      const current = new Set(list)
      if (candidates === null) candidates = current
      else for (const item of [...candidates]) if (!current.has(item)) candidates.delete(item)
      if (candidates.size === 0) return []
    }
    if (!candidates) return []
    return [...candidates]
      .map((documentIndex) => {
        const document = index.documents[documentIndex]!
        return { document, score: scoreDocument(document, query, queryTokens) }
      })
      .filter((item) => item.document.type === type && item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(Math.max(limit, 1), 2000))
      .map((item) => item.document.id)
  } catch {
    return null
  }
}

/** 应用启动后可以提前预热，让第一次搜索直接命中缓存。 */
export async function warmSearchIndex(): Promise<void> {
  try {
    const signature = searchIndexSignature()
    if (cache?.signature === signature) return
    await buildCacheAsync()
  } catch {
    // 索引预热失败不影响 LIKE 兜底搜索。
  }
}

/** 测试或手动刷新索引时使用。 */
export function clearSearchIndex(): void {
  cache = null
}
