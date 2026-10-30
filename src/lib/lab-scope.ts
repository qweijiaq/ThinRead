import type { LabToolId } from '../../shared/types.js'

export function labReportScope(
  tool: LabToolId,
  bookIds: string[],
  bookId: string,
  chapterId: string,
  _question: string,
): string {
  if (tool === 'margin-note') return `chapter:${chapterId}`
  if (tool === 'adaptive-quiz' || tool === 'argument-map' || tool === 'chapter-annotations' || tool === 'fact-check' || tool === 'podcast') {
    return `chapter:${chapterId}`
  }
  if (tool === 'entity-network') return `book:${bookId}`
  if (tool === 'cross-book-synthesis' || tool === 'reading-path') {
    return `books:${[...bookIds].sort().join(',')}`
  }
  return 'all'
}

export function labChatScope(tool: LabToolId, bookIds: string[], chapterId: string): string {
  if (tool === 'author-roundtable') return `books:${[...bookIds].sort().join(',')}`
  if (tool === 'devils-advocate' || tool === 'book-club') return `chapter:${chapterId}`
  return 'library'
}
