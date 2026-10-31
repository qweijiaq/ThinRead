import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeRelationAliases } from '../electron/ai/lab.js'
import type { RelationGraph } from '../shared/types.js'

const node = (id: string, label: string, aliases: string[] = [], chapters: string[] = []) => ({
  id,
  label,
  kind: 'person' as const,
  role: 'other' as const,
  importance: 3,
  identity: '',
  rank: '',
  affiliation: '',
  aliases,
  realWorld: false,
  encyclopedia: '',
  description: '',
  chapters,
})

const graph: RelationGraph = {
  title: '测试关系图',
  genre: '小说',
  summary: '',
  plot: '',
  nodes: [node('a', '张三', ['三哥'], ['第一章']), node('b', '张三', [], ['第二章']), node('c', '李四')],
  edges: [
    { source: 'a', target: 'c', label: '认识', reverseLabel: '被认识', kind: 'other', description: '', chapters: ['第一章'] },
    { source: 'b', target: 'c', label: '认识', reverseLabel: '被认识', kind: 'other', description: '' },
  ],
}

test('merges alias nodes and keeps chapter references', () => {
  const merged = mergeRelationAliases(graph)
  assert.equal(merged.nodes.length, 2)
  const mergedPerson = merged.nodes.find((item) => item.label === '张三')!
  assert.deepEqual(mergedPerson.aliases, ['三哥'])
  assert.deepEqual(mergedPerson.chapters, ['第一章', '第二章'])
  assert.equal(merged.edges.length, 1)
  assert.equal(merged.edges[0]!.chapters?.[0], '第一章')
})
