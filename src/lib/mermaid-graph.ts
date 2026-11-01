import type { KnowledgeMapData, KnowledgeMapEdge, RelationGraph, RelationNodeKind } from '../../shared/types.js'

function escapeLabel(value: string, max = 28): string {
  const text = value.replace(/["|]/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function nodeId(index: number): string {
  return `n${index}`
}

function edgeLabel(kind: KnowledgeMapEdge['kind']): string {
  if (kind === 'book') return '书'
  if (kind === 'tag') return '标签'
  return '语义'
}

export function knowledgeMapToMermaid(data: KnowledgeMapData): string {
  const ids = new Map(data.nodes.map((node, index) => [node.id, nodeId(index)]))
  const lines = ['flowchart LR']
  data.nodes.forEach((node) => {
    const id = ids.get(node.id)!
    const label = escapeLabel(node.label)
    lines.push(`  ${id}["${label}"]:::${node.type}`)
  })
  const seen = new Set<string>()
  for (const edge of data.edges) {
    const source = ids.get(edge.source)
    const target = ids.get(edge.target)
    if (!source || !target) continue
    const key = `${source}:${target}:${edge.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`  ${source} -->|${edgeLabel(edge.kind)}${edge.cross ? ' · 跨书' : ''}| ${target}`)
  }
  lines.push('  classDef book fill:#e7ebf4,stroke:#264f8a,color:#1b1a15')
  lines.push('  classDef concept fill:#fbf8ef,stroke:#d7d0c0,color:#1b1a15')
  return lines.join('\n')
}

const RELATION_CLASS: Record<RelationNodeKind, string> = {
  person: 'person',
  organization: 'organization',
  place: 'place',
  event: 'event',
  concept: 'concept',
}

export function relationGraphToMermaid(graph: RelationGraph): string {
  const ids = new Map(graph.nodes.map((node, index) => [node.id, nodeId(index)]))
  const lines = ['flowchart LR']
  graph.nodes.forEach((node) => {
    const id = ids.get(node.id)!
    const role = node.kind === 'person' && node.role !== 'other' ? ` · ${node.role}` : ''
    lines.push(`  ${id}["${escapeLabel(node.label, 22)}<br/>${node.kind}${role}"]:::${RELATION_CLASS[node.kind]}`)
  })
  const seen = new Set<string>()
  for (const edge of graph.edges) {
    const source = ids.get(edge.source)
    const target = ids.get(edge.target)
    if (!source || !target) continue
    const key = `${source}:${target}:${edge.label}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`  ${source} -->|${escapeLabel(edge.label, 18)}| ${target}`)
  }
  lines.push('  classDef person fill:#f4e4db,stroke:#a84a2b,color:#1b1a15')
  lines.push('  classDef organization fill:#e4efe9,stroke:#3d6e5d,color:#1b1a15')
  lines.push('  classDef place fill:#e6e9f3,stroke:#2f4f9e,color:#1b1a15')
  lines.push('  classDef event fill:#f3ebdc,stroke:#a4772a,color:#1b1a15')
  lines.push('  classDef concept fill:#fbf8ef,stroke:#d7d0c0,color:#1b1a15')
  return lines.join('\n')
}

export function mermaidFence(code: string): string {
  return `\`\`\`mermaid\n${code.trim()}\n\`\`\``
}
