export interface MermaidFence {
  /** 围栏内的 Mermaid 源码，已去掉首尾围栏。 */
  source: string
  /** 在原始 Markdown 里的起止位置，便于做原地替换。 */
  start: number
  end: number
}

/**
 * 匹配 ```mermaid 或 ~~~mermaid 围栏。闭合围栏必须与开启围栏同字符同长度，
 * 这是 CommonMark 允许的最常见写法；缩进最多三个空格。
 */
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*mermaid(?:[ \t][^\n]*)?\r?\n([\s\S]*?)^[ \t]{0,3}\1[ \t]*\r?$/gm

export function extractMermaidFences(markdown: string): MermaidFence[] {
  const fences: MermaidFence[] = []
  for (const match of markdown.matchAll(FENCE_PATTERN)) {
    const start = match.index ?? 0
    fences.push({ source: match[2] ?? '', start, end: start + match[0].length })
  }
  return fences
}

export function hasMermaidFence(markdown: string): boolean {
  return extractMermaidFences(markdown).length > 0
}

/** 按出现顺序替换每一段 Mermaid 围栏，其余内容原样保留。 */
export function replaceMermaidFences(
  markdown: string,
  replacer: (source: string, index: number) => string,
): string {
  const fences = extractMermaidFences(markdown)
  if (fences.length === 0) return markdown
  let output = ''
  let cursor = 0
  fences.forEach((fence, index) => {
    output += markdown.slice(cursor, fence.start)
    output += replacer(fence.source, index)
    cursor = fence.end
  })
  return output + markdown.slice(cursor)
}
