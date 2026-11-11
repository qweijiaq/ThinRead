import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { gzip, gunzipSync } from 'node:zlib'

import type { SearchResult } from '../shared/types.js'
import type { SearchDocument } from './search.js'
import { searchDocuments, searchIndexSignature } from './search.js'

interface IndexCache {
  signature: string
  documents: SearchDocument[]
  byId: Map<string, SearchDocument>
  /** token -> 文档 id（type:id），不再依赖数组下标，便于增量更新。 */
  inverted: Map<string, string[]>
  /** 每个文档的 token，删除或更新时只处理它自己的倒排项。 */
  tokensById: Map<string, string[]>
}

interface SerializedIndex {
  version: number
  signature: string
  documents: SearchDocument[]
  inverted: Record<string, string[]>
  tokens: Record<string, string[]>
}

const INDEX_VERSION = 2
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

function documentKey(document: SearchDocument): string {
  return `${document.type}:${document.id}`
}

function sameDocument(left: SearchDocument, right: SearchDocument): boolean {
  return (
    left.title === right.title &&
    left.text === right.text &&
    left.updatedAt === right.updatedAt &&
    left.bookId === right.bookId &&
    left.chapterId === right.chapterId &&
    left.meta === right.meta
  )
}

function makeCache(
  signature: string,
  documents: SearchDocument[],
  inverted: Map<string, string[]>,
  tokensById: Map<string, string[]>,
): IndexCache {
  return {
    signature,
    documents,
    byId: new Map(documents.map((document) => [documentKey(document), document])),
    inverted,
    tokensById,
  }
}

function loadPersisted(): IndexCache | null {
  const file = cacheFile()
  if (!file || !fs.existsSync(file)) return null
  try {
    const parsed = JSON.parse(gunzipSync(fs.readFileSync(file)).toString('utf8')) as SerializedIndex
    if (parsed.version !== INDEX_VERSION) return null
    if (!Array.isArray(parsed.documents) || !parsed.inverted || !parsed.tokens) return null
    const inverted = new Map(
      Object.entries(parsed.inverted).filter(
        (entry): entry is [string, string[]] =>
          Array.isArray(entry[1]) && entry[1].every((item) => typeof item === 'string'),
      ),
    )
    const tokensById = new Map(
      Object.entries(parsed.tokens).filter(
        (entry): entry is [string, string[]] =>
          Array.isArray(entry[1]) && entry[1].every((item) => typeof item === 'string'),
      ),
    )
    if (parsed.documents.length > 0 && (inverted.size === 0 || tokensById.size === 0)) return null
    if (tokensById.size > 0 && tokensById.size !== parsed.documents.length) return null
    return makeCache(parsed.signature, parsed.documents, inverted, tokensById)
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
        tokens: Object.fromEntries(next.tokensById),
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

/** 中文按二元组切分，英文按词切分；不依赖 SQLite FTS5。 */
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

function documentTokens(document: SearchDocument): string[] {
  return tokenize(`${document.title}\n${document.title}\n${document.text}`)
}

function addDocument(
  document: SearchDocument,
  inverted: Map<string, string[]>,
  tokensById: Map<string, string[]>,
): void {
  const key = documentKey(document)
  const tokens = documentTokens(document)
  tokensById.set(key, tokens)
  for (const token of tokens) {
    const list = inverted.get(token)
    if (list) list.push(key)
    else inverted.set(token, [key])
  }
}

function removeDocument(
  key: string,
  inverted: Map<string, string[]>,
  tokensById: Map<string, string[]>,
): void {
  const tokens = tokensById.get(key)
  if (!tokens) return
  for (const token of tokens) {
    const list = inverted.get(token)
    if (!list) continue
    const index = list.indexOf(key)
    if (index >= 0) list.splice(index, 1)
    if (list.length === 0) inverted.delete(token)
  }
  tokensById.delete(key)
}

/**
 * 增量更新：只重新切分新增/变化的文档，未变化的文档复用倒排项。
 * searchDocuments() 仍会扫描数据库，但省掉了全库重新 tokenize 和重建 postings 的成本。
 */
function reindexDocuments(
  documents: SearchDocument[],
  signature: string,
  base: IndexCache | null,
): IndexCache {
  const nextById = new Map(documents.map((document) => [documentKey(document), document]))
  const inverted = new Map<string, string[]>()
  const tokensById = new Map<string, string[]>()
  if (base) {
    for (const [token, list] of base.inverted) inverted.set(token, [...list])
    for (const [key, tokens] of base.tokensById) tokensById.set(key, tokens)
  }

  if (base) {
    for (const key of base.byId.keys()) {
      if (!nextById.has(key)) removeDocument(key, inverted, tokensById)
    }
  }
  for (const document of documents) {
    const key = documentKey(document)
    const previous = base?.byId.get(key)
    if (previous && sameDocument(previous, document)) continue
    if (previous) removeDocument(key, inverted, tokensById)
    addDocument(document, inverted, tokensById)
  }
  return makeCache(signature, documents, inverted, tokensById)
}

async function buildFromScratchAsync(documents: SearchDocument[], signature: string): Promise<IndexCache> {
  const inverted = new Map<string, string[]>()
  const tokensById = new Map<string, string[]>()
  for (let index = 0; index < documents.length; index++) {
    const document = documents[index]!
    const key = documentKey(document)
    const tokens = documentTokens(document)
    tokensById.set(key, tokens)
    for (const token of tokens) {
      const list = inverted.get(token)
      if (list) list.push(key)
      else inverted.set(token, [key])
    }
    if (index % 40 === 39) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }
  return makeCache(signature, documents, inverted, tokensById)
}

function buildCache(): IndexCache {
  const signature = searchIndexSignature()
  if (cache && cache.signature === signature) return cache
  const persisted = loadPersisted()
  if (persisted?.signature === signature) {
    cache = persisted
    return persisted
  }
  const documents = searchDocuments()
  const next = reindexDocuments(documents, signature, cache ?? persisted)
  cache = next
  persist(next)
  return next
}

/** 分块建索引，避免大书库首次搜索时长时间占住主进程。 */
async function buildCacheAsync(): Promise<IndexCache> {
  if (building) return building
  building = (async () => {
    const signature = searchIndexSignature()
    if (cache && cache.signature === signature) return cache
    const persisted = loadPersisted()
    if (persisted?.signature === signature) {
      cache = persisted
      return persisted
    }
    const documents = searchDocuments()
    const base = cache ?? persisted
    const next = base
      ? reindexDocuments(documents, signature, base)
      : await buildFromScratchAsync(documents, signature)
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

function candidateIds(index: IndexCache, queryTokens: string[]): Set<string> | null {
  let candidates: Set<string> | null = null
  for (const token of queryTokens) {
    const list = index.inverted.get(token)
    if (!list || list.length === 0) return null
    const current = new Set(list)
    if (candidates === null) candidates = current
    else for (const item of [...candidates]) if (!current.has(item)) candidates.delete(item)
    if (candidates.size === 0) return null
  }
  return candidates
}

function runSearch(index: IndexCache, query: string, limit: number): SearchResult[] {
  const queryTokens = [...new Set(tokenize(query))]
  const candidates = candidateIds(index, queryTokens)
  if (!candidates) return []
  const scored = [...candidates]
    .map((key) => {
      const document = index.byId.get(key)
      return document ? { document, score: scoreDocument(document, query, queryTokens) } : null
    })
    .filter((item): item is { document: SearchDocument; score: number } => Boolean(item && item.score > 0))
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

/** 本地全文索引；签名不变时复用，变化时只重算变更文档。 */
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
    const candidates = candidateIds(index, queryTokens)
    if (!candidates) return []
    return [...candidates]
      .map((key) => {
        const document = index.byId.get(key)
        return document ? { document, score: scoreDocument(document, query, queryTokens) } : null
      })
      .filter(
        (item): item is { document: SearchDocument; score: number } =>
          Boolean(item && item.document.type === type && item.score > 0),
      )
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
