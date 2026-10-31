import type { SearchResult } from '../shared/types.js'
import type { SearchDocument } from './db.js'
import { searchDocuments, searchIndexSignature } from './db.js'

interface IndexCache {
  signature: string
  documents: SearchDocument[]
  inverted: Map<string, number[]>
}

let cache: IndexCache | null = null

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
  const documents = searchDocuments()
  const temp = new Map<string, Set<number>>()
  documents.forEach((document, documentIndex) => {
    const tokens = new Set(tokenize(`${document.title}\n${document.title}\n${document.text}`))
    for (const token of tokens) addToMap(temp, token, documentIndex)
  })
  const inverted = new Map<string, number[]>()
  for (const [token, list] of temp) inverted.set(token, [...list])
  cache = { signature, documents, inverted }
  return cache
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

/**
 * 本地全文索引；签名不变时复用。返回 null 表示当前查询不适合索引，
 * 调用方应回退到原有 LIKE 搜索。
 */
export function searchIndex(rawQuery: string, limit = 40): SearchResult[] | null {
  const query = rawQuery.replace(/\s+/g, ' ').trim()
  if (query.length < 2) return null
  const queryTokens = [...new Set(tokenize(query))]
  if (queryTokens.length === 0) return null
  let index: IndexCache
  try {
    index = buildCache()
  } catch {
    return null
  }

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

/** 测试或手动刷新索引时使用。 */
export function clearSearchIndex(): void {
  cache = null
}
