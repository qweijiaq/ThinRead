import type { Note } from '../../shared/types.js'

export interface Cloze {
  text: string
  answer: string
}

/** 从笔记标签里挑一个在正文中出现的术语挖空；没有可挖的就返回 null。 */
export function buildCloze(note: Pick<Note, 'content' | 'tags'>): Cloze | null {
  const content = note.content.trim()
  if (!content) return null
  const tags = [...note.tags]
    .map((tag) => tag.trim())
    .filter((tag) => tag.length >= 2 && tag.length <= 16)
    .sort((a, b) => b.length - a.length)
  for (const tag of tags) {
    const index = content.indexOf(tag)
    if (index < 0) continue
    return {
      text: `${content.slice(0, index)}____${content.slice(index + tag.length)}`,
      answer: tag,
    }
  }
  return null
}

export function normalizeClozeAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s　，。,.!！?？；;：:、"'“”‘’（）()【】\[\]]/g, '')
    .trim()
}
