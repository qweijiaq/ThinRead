import type { Note } from '../../shared/types.js'

/** 一次扫描建立的反向链接索引，替代每张卡片现算 allNotes.filter/includes。 */
export interface NoteIndex {
  byId: Map<string, Note>
  /** 标题 → 引用了 [[标题]] 的笔记。 */
  backlinks: Map<string, Note[]>
}

const WIKI_LINK = /\[\[([^\]\n]+)\]\]/g

export function buildNoteIndex(notes: Note[]): NoteIndex {
  const byId = new Map<string, Note>()
  const backlinks = new Map<string, Note[]>()
  for (const note of notes) byId.set(note.id, note)

  for (const note of notes) {
    for (const match of note.content.matchAll(WIKI_LINK)) {
      const title = match[1]?.trim()
      if (!title) continue
      const list = backlinks.get(title)
      if (!list) {
        backlinks.set(title, [note])
        continue
      }
      if (!list.some((item) => item.id === note.id)) list.push(note)
    }
  }
  return { byId, backlinks }
}

const EMPTY: Note[] = []

export function backlinksFor(index: NoteIndex, note: Note): Note[] {
  return index.backlinks.get(note.title) ?? EMPTY
}
