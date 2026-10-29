import type { Note } from '../../shared/types.js'

export function noteBacklinks(note: Note, allNotes: Note[]): Note[] {
  const marker = `[[${note.title}]]`
  return allNotes.filter((candidate) => candidate.id !== note.id && candidate.content.includes(marker))
}

export function relatedNotes(activeChapterId: string | null, notes: Note[], allNotes: Note[]): Note[] {
  const chapterNotes = notes.filter((note) => note.chapterId === activeChapterId)
  const tags = new Set(chapterNotes.flatMap((note) => note.tags))
  if (tags.size === 0) return []
  return allNotes
    .filter((note) => note.chapterId !== activeChapterId && note.tags.some((tag) => tags.has(tag)))
    .slice(0, 6)
}

export function findNoteByTitle(title: string, notes: Note[]): Note | null {
  return notes.find((note) => note.title === title) ?? null
}

export function snippet(value: string, length = 60): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > length ? `${flat.slice(0, length)}…` : flat
}
