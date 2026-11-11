/**
 * 轻量检索：不建索引，直接从当前章节里挑出和问题最相关的段落。
 * 目的是替代「每轮都把整章重发一遍」，而不是做完整的语义检索。
 */
export function queryTerms(query: string): string[] {
  const normalized = query.toLowerCase().replace(/[^\p{Script=Han}a-z0-9]+/gu, ' ').trim()
  const terms = new Set<string>()
  for (const word of normalized.split(/\s+/)) {
    if (/^[a-z0-9]{2,}$/.test(word)) terms.add(word)
  }
  const han = normalized.replace(/[^\p{Script=Han}]/gu, '')
  for (let index = 0; index < han.length - 1; index++) terms.add(han.slice(index, index + 2))
  return [...terms].filter((term) => !/^(的是|了|和|与|在|这|那|一个|我们|可以|什么|怎么)$/.test(term))
}

export function scoreText(text: string, terms: string[]): number {
  if (terms.length === 0) return 0
  const lower = text.toLowerCase()
  let score = 0
  for (const term of terms) {
    let from = 0
    while (true) {
      const index = lower.indexOf(term, from)
      if (index < 0) break
      score += 1
      from = index + term.length
    }
  }
  return score
}

/** 从长文本里挑出和查询最相关的段落，保持原文顺序；没有命中时退回开头。 */
export function retrievePassages(text: string, query: string, budget: number): string {
  const paragraphs = text
    .split(/\n{2,}|(?<=[。！？!?])\s+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length >= 12)
  if (paragraphs.length === 0) return text.slice(0, budget)
  const terms = queryTerms(query)
  const scored = paragraphs.map((paragraph, index) => ({
    paragraph,
    index,
    score: scoreText(paragraph, terms),
  }))
  const picked = new Set<number>()
  let used = 0
  for (const row of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (row.score === 0 && picked.size > 0) break
    if (used + row.paragraph.length > budget) continue
    picked.add(row.index)
    used += row.paragraph.length
    if (used >= budget * 0.9) break
  }
  if (picked.size === 0) return text.slice(0, budget)
  // 命中段落前后各带一段，避免抽出的句子失去上下文。
  for (const index of [...picked]) {
    for (const neighbor of [index - 1, index + 1]) {
      if (neighbor < 0 || neighbor >= paragraphs.length || picked.has(neighbor)) continue
      const length = paragraphs[neighbor]!.length
      if (used + length > budget) continue
      picked.add(neighbor)
      used += length
    }
  }
  return [...picked]
    .sort((a, b) => a - b)
    .map((index) => paragraphs[index])
    .join('\n\n')
}
