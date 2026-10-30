import type { Note } from '../../shared/types.js'

function flatten(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * AI 知识点卡片的标题是从正文截出来的，常见「标题 = 正文前缀」。
 * 这类标题既不全，也会和正文重复，展示时应让正文承担标题角色。
 */
export function titleRepeatsContent(note: Pick<Note, 'kind' | 'title' | 'content'>): boolean {
  if (note.kind !== 'point' && note.kind !== 'claim') return false
  const title = flatten(note.title)
  const content = flatten(note.content)
  if (!title) return true
  if (!content) return false
  const trimmed = title.replace(/…$/, '')
  return content === trimmed || content.startsWith(trimmed) || trimmed.startsWith(content)
}

export function noteDisplayTitle(note: Pick<Note, 'kind' | 'title' | 'content'>): string {
  return titleRepeatsContent(note) ? flatten(note.content) : note.title
}
