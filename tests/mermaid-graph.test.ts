import assert from 'node:assert/strict'
import test from 'node:test'

import { knowledgeMapToMermaid, mermaidFence, relationGraphToMermaid } from '../src/lib/mermaid-graph.js'

test('converts the knowledge map to a Mermaid flowchart', () => {
  const text = knowledgeMapToMermaid({
    nodes: [
      { id: 'b1', type: 'book', label: '《书》', bookId: 'b1', bookTitle: '书', chapterId: null, chapterTitle: null, noteId: null, kind: null, weight: 1, tags: [], noteCount: 2, preview: null },
      { id: 'c1', type: 'concept', label: '概念 | 一', bookId: 'b1', bookTitle: '书', chapterId: null, chapterTitle: null, noteId: null, kind: null, weight: 2, tags: ['概念'], noteCount: 2, preview: null },
    ],
    edges: [{ id: 'e1', source: 'b1', target: 'c1', kind: 'book', weight: 1, cross: false }],
    semanticReady: true,
    totalNotes: 2,
    displayedNotes: 2,
  })
  assert.match(text, /^flowchart LR/)
  assert.match(text, /n0\["《书》"\]:::book/)
  assert.match(text, /n1\["概念 一"\]:::concept/)
  assert.match(text, /n0 -->\|书\| n1/)
  assert.match(mermaidFence(text), /^```mermaid/)
})

test('converts a relation graph and escapes dangerous label characters', () => {
  const text = relationGraphToMermaid({
    title: '测试',
    genre: '小说',
    summary: '',
    plot: '',
    nodes: [
      { id: 'a', label: '甲" | 乙', kind: 'person', role: 'detective', importance: 3, identity: '', rank: '', affiliation: '', aliases: [], realWorld: false, encyclopedia: '', description: '' },
      { id: 'b', label: '丙', kind: 'place', role: 'other', importance: 1, identity: '', rank: '', affiliation: '', aliases: [], realWorld: false, encyclopedia: '', description: '' },
    ],
    edges: [{ source: 'a', target: 'b', label: '前往', reverseLabel: '来自', kind: 'event', description: '' }],
  })
  assert.match(text, /^flowchart LR/)
  assert.match(text, /n0\["甲 乙<br\/>person · detective"\]:::person/)
  assert.match(text, /n0 -->\|前往\| n1/)
})
