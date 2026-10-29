import { listMapNotes } from './db.js'
import type { KnowledgeMapData, KnowledgeMapEdge, KnowledgeMapNode } from '../shared/types.js'

const MAX_NOTES = 300
const SEMANTIC_THRESHOLD = 0.58
const MAX_LINKS_PER_NOTE = 2

/** 把全库笔记组织成「书 -> 笔记」两层节点，优先用语义相似度连边，退化时用共享标签。 */
export function buildKnowledgeMap(): KnowledgeMapData {
  const { notes, total } = listMapNotes(MAX_NOTES)
  const nodes: KnowledgeMapNode[] = []
  const edges: KnowledgeMapEdge[] = []
  const degree = new Map<string, number>()
  const noteNodes = new Map<string, KnowledgeMapNode>()
  const bookNodes = new Map<string, KnowledgeMapNode>()
  const edgeKeys = new Set<string>()

  function addEdge(source: string, target: string, kind: KnowledgeMapEdge['kind'], weight: number, cross: boolean): void {
    const key = [source, target].sort().join('|')
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ id: `edge:${key}`, source, target, kind, weight: Math.round(weight * 100) / 100, cross })
    degree.set(source, (degree.get(source) ?? 0) + 1)
    degree.set(target, (degree.get(target) ?? 0) + 1)
  }

  for (const note of notes) {
    const noteId = `note:${note.id}`
    const node: KnowledgeMapNode = {
      id: noteId,
      type: 'note',
      label: note.title,
      bookId: note.bookId,
      bookTitle: note.bookTitle,
      chapterId: note.chapterId,
      chapterTitle: note.chapterTitle,
      noteId: note.id,
      kind: note.kind,
      weight: note.importance,
      tags: note.tags,
      noteCount: null,
    }
    noteNodes.set(note.id, node)
    nodes.push(node)

    const bookId = `book:${note.bookId}`
    let book = bookNodes.get(note.bookId)
    if (!book) {
      book = {
        id: bookId,
        type: 'book',
        label: note.bookTitle,
        bookId: note.bookId,
        bookTitle: note.bookTitle,
        chapterId: null,
        chapterTitle: null,
        noteId: null,
        kind: null,
        weight: 0,
        tags: [],
        noteCount: 0,
      }
      bookNodes.set(note.bookId, book)
      nodes.push(book)
    }
    book.noteCount = (book.noteCount ?? 0) + 1
    addEdge(bookId, noteId, 'book', 0.12, false)
  }

  const withVectors = notes.filter((note) => note.vector && note.vector.length > 0)
  const linked = new Set<string>()

  if (withVectors.length > 0) {
    const candidates = new Map<string, Array<{ id: string; score: number }>>()
    for (let index = 0; index < withVectors.length; index++) {
      const left = withVectors[index]!
      for (let other = index + 1; other < withVectors.length; other++) {
        const right = withVectors[other]!
        const score = cosine(left.vector ?? [], right.vector ?? [])
        if (score < SEMANTIC_THRESHOLD) continue
        if (!candidates.has(left.id)) candidates.set(left.id, [])
        if (!candidates.has(right.id)) candidates.set(right.id, [])
        candidates.get(left.id)!.push({ id: right.id, score })
        candidates.get(right.id)!.push({ id: left.id, score })
      }
    }
    for (const [noteId, links] of candidates) {
      for (const link of links.sort((a, b) => b.score - a.score).slice(0, MAX_LINKS_PER_NOTE)) {
        const a = noteNodes.get(noteId)
        const b = noteNodes.get(link.id)
        if (!a || !b) continue
        addEdge(a.id, b.id, 'semantic', link.score, a.bookId !== b.bookId)
        linked.add(noteId)
        linked.add(link.id)
      }
    }
  }

  // 没有语义向量的笔记，用共享标签补一层弱连接，保证地图不是一堆孤点。
  const tagNotes = notes.filter((note) => !linked.has(note.id))
  const byTag = new Map<string, string[]>()
  for (const note of tagNotes) {
    for (const tag of note.tags) {
      const key = tag.trim().toLowerCase()
      if (!key) continue
      if (!byTag.has(key)) byTag.set(key, [])
      byTag.get(key)!.push(note.id)
    }
  }
  const tagCandidates = new Map<string, Array<{ id: string; score: number }>>()
  for (const ids of byTag.values()) {
    for (let index = 0; index < ids.length; index++) {
      for (let other = index + 1; other < ids.length; other++) {
        const a = ids[index]!
        const b = ids[other]!
        if (a === b) continue
        if (!tagCandidates.has(a)) tagCandidates.set(a, [])
        if (!tagCandidates.has(b)) tagCandidates.set(b, [])
        tagCandidates.get(a)!.push({ id: b, score: 0.2 })
        tagCandidates.get(b)!.push({ id: a, score: 0.2 })
      }
    }
  }
  for (const [noteId, links] of tagCandidates) {
    for (const link of links.slice(0, MAX_LINKS_PER_NOTE)) {
      const a = noteNodes.get(noteId)
      const b = noteNodes.get(link.id)
      if (!a || !b) continue
      addEdge(a.id, b.id, 'tag', link.score, a.bookId !== b.bookId)
    }
  }

  for (const node of nodes) {
    const links = degree.get(node.id) ?? 0
    node.weight =
      node.type === 'book'
        ? Math.min(12, 2 + (node.noteCount ?? 0) * 0.7)
        : Math.min(9, 2 + links * 0.4 + (node.kind === 'condensed' ? 2 : 0))
  }

  return {
    nodes,
    edges: edges.slice(0, 800),
    semanticReady: withVectors.length > 0,
    totalNotes: total,
    displayedNotes: notes.length,
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let index = 0; index < a.length; index++) {
    dot += a[index]! * b[index]!
    na += a[index]! * a[index]!
    nb += b[index]! * b[index]!
  }
  if (na === 0 || nb === 0) return 0
  return dot / Math.sqrt(na * nb)
}
