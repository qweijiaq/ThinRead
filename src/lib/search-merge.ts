import type { SearchResult } from '../../shared/types.js'

function key(item: SearchResult): string {
  return `${item.type}:${item.id}`
}

/**
 * Reciprocal Rank Fusion：关键词和语义两路结果按名次融合。
 * 只在同一类结果内部生效，搜索面板仍按书/章节/笔记/内容分组展示。
 */
export function mergeSearchResults(base: SearchResult[], extra: SearchResult[]): SearchResult[] {
  const entries = new Map<string, { item: SearchResult; score: number }>()
  const add = (items: SearchResult[], weight: number): void => {
    items.forEach((item, index) => {
      const id = key(item)
      const current = entries.get(id) ?? { item, score: 0 }
      current.score += weight / (60 + index + 1)
      entries.set(id, current)
    })
  }
  add(base, 1)
  add(extra, 1)
  return [...entries.values()].sort((left, right) => right.score - left.score).map((entry) => entry.item)
}
