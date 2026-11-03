import assert from 'node:assert/strict'
import test from 'node:test'

import type { Note } from '../shared/types.js'
import { buildChapterMarkdown } from '../src/lib/export.js'
import { setLocale } from '../src/lib/i18n.js'

function note(partial: Partial<Note>): Note {
  return {
    id: partial.id ?? 'n1',
    bookId: 'b1',
    chapterId: 'c1',
    kind: 'point',
    title: '',
    content: '',
    quote: null,
    quoteVerified: false,
    author: 'ai',
    edited: false,
    tags: [],
    section: null,
    importance: 3,
    role: null,
    divergences: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

test('localizes exported Markdown labels in English', () => {
  setLocale('en')
  try {
    const markdown = buildChapterMarkdown({
      bookTitle: 'Attention',
      author: 'Author',
      chapterTitle: 'Chapter 1',
      date: '2026-01-01',
      condensed: note({ kind: 'condensed', content: 'Condensed body.' }),
      cards: [
        note({
          content: 'Focus is limited.',
          role: 'Supports the main claim.',
          quote: 'Focus is limited.',
          quoteVerified: true,
          divergences: [{ type: 'boundary', text: 'Under fatigue.' }],
        }),
      ],
      includeCards: true,
    })
    assert.match(markdown, /\*\*Role in the text\*\*/)
    assert.match(markdown, /\*\*Source evidence\*\*/)
    assert.match(markdown, /## Core cards/)
    assert.match(markdown, /\*\*Extensions\*\*/)
    assert.match(markdown, /Boundary/)
  } finally {
    setLocale('zh')
  }
})
