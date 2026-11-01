export interface ReadingPositionView {
  chapterId: string
  bookId: string
  scrollRatio: number
  scrollTop: number
  page: number | null
  updatedAt: string
}

export interface BookmarkView {
  id: string
  bookId: string
  chapterId: string
  chapterTitle: string
  scrollRatio: number
  scrollTop: number
  page: number | null
  label: string
  quote: string | null
  createdAt: string
}

export interface BookmarkDraft {
  bookId: string
  chapterId: string
  scrollRatio: number
  scrollTop: number
  page?: number | null
  label: string
  quote?: string | null
}
