import { listMapNotes } from './db.js'
import type { KnowledgeMapData, KnowledgeMapEdge, KnowledgeMapNode } from '../shared/types.js'

const MAX_NOTES = 300
const MAX_CONCEPTS = 60
const MAX_LINKS_PER_CONCEPT = 3

interface ConceptAccumulator {
  key: string
  label: string
  noteCount: number
  bookIds: Set<string>
}

/**
 * 概念图：书是大节点，标签是概念节点。
 * 笔记不直接铺在图上，而是挂在概念下面，避免一屏几百个点。
 */
export function buildKnowledgeMap(): KnowledgeMapData {
  const { notes, total } = listMapNotes(MAX_NOTES)
  const nodes: KnowledgeMapNode[] = []
  const edges: KnowledgeMapEdge[] = []
  const edgeKeys = new Set<string>()
  const bookNodes = new Map<string, KnowledgeMapNode>()
  const concepts = new Map<string, ConceptAccumulator>()
  const noteTags = new Map<string, string[]>()

  function addEdge(source: string, target: string, kind: KnowledgeMapEdge['kind'], weight: number): void {
    const key = [source, target].sort().join('|')
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ id: `edge:${key}`, source, target, kind, weight: Math.round(weight * 100) / 100, cross: false })
  }

  for (const note of notes) {
    let book = bookNodes.get(note.bookId)
    if (!book) {
      book = {
        id: `book:${note.bookId}`,
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
        preview: null,
      }
      bookNodes.set(note.bookId, book)
      nodes.push(book)
    }
    book.noteCount = (book.noteCount ?? 0) + 1

    const tags = [...new Set(note.tags.map((tag) => tag.trim()).filter(Boolean))]
    noteTags.set(note.id, tags)
    for (const tag of tags) {
      const key = tag.toLowerCase()
      let concept = concepts.get(key)
      if (!concept) {
        concept = { key, label: tag, noteCount: 0, bookIds: new Set() }
        concepts.set(key, concept)
      }
      concept.noteCount += 1
      concept.bookIds.add(note.bookId)
    }
  }

  const picked = [...concepts.values()]
    .sort((a, b) => b.noteCount - a.noteCount || a.label.localeCompare(b.label))
    .slice(0, MAX_CONCEPTS)
  const pickedKeys = new Set(picked.map((concept) => concept.key))
  const conceptNodes = new Map<string, KnowledgeMapNode>()

  for (const concept of picked) {
    const id = `concept:${concept.key}`
    const node: KnowledgeMapNode = {
      id,
      type: 'concept',
      label: concept.label,
      bookId: '',
      bookTitle: '',
      chapterId: null,
      chapterTitle: null,
      noteId: null,
      kind: null,
      weight: concept.noteCount,
      tags: [concept.label],
      noteCount: concept.noteCount,
      preview: null,
    }
    conceptNodes.set(concept.key, node)
    nodes.push(node)
    for (const bookId of concept.bookIds) {
      const book = bookNodes.get(bookId)
      if (!book) continue
      addEdge(book.id, id, 'book', Math.min(3, 1 + concept.noteCount * 0.1))
    }
  }

  const cooccurrence = new Map<string, { a: string; b: string; count: number }>()
  for (const note of notes) {
    const tags = (noteTags.get(note.id) ?? []).filter((tag) => pickedKeys.has(tag.toLowerCase()))
    for (let index = 0; index < tags.length; index++) {
      for (let other = index + 1; other < tags.length; other++) {
        const a = `concept:${tags[index]!.toLowerCase()}`
        const b = `concept:${tags[other]!.toLowerCase()}`
        if (a === b) continue
        const key = [a, b].sort().join('|')
        const entry = cooccurrence.get(key)
        if (entry) entry.count += 1
        else cooccurrence.set(key, { a, b, count: 1 })
      }
    }
  }

  const perConcept = new Map<string, Array<{ id: string; count: number }>>()
  for (const entry of cooccurrence.values()) {
    if (!perConcept.has(entry.a)) perConcept.set(entry.a, [])
    if (!perConcept.has(entry.b)) perConcept.set(entry.b, [])
    perConcept.get(entry.a)!.push({ id: entry.b, count: entry.count })
    perConcept.get(entry.b)!.push({ id: entry.a, count: entry.count })
  }
  for (const [conceptId, links] of perConcept) {
    for (const link of links.sort((a, b) => b.count - a.count).slice(0, MAX_LINKS_PER_CONCEPT)) {
      addEdge(conceptId, link.id, 'tag', Math.min(4, 0.6 + link.count * 0.6))
    }
  }

  for (const node of nodes) {
    if (node.type === 'book') node.weight = 2 + (node.noteCount ?? 0) * 0.6
    else node.weight = Math.min(16, 4 + (node.noteCount ?? 0) * 1.4)
  }

  return {
    nodes,
    edges: edges.slice(0, 600),
    semanticReady: true,
    totalNotes: total,
    displayedNotes: notes.filter((note) => (noteTags.get(note.id) ?? []).length > 0).length,
  }
}
