import assert from 'node:assert/strict'
import test from 'node:test'

import { parseComposeArtifact, versionLabel } from '../src/lib/book-compose.js'

const base = {
  id: 'a1',
  tool: 'book-compose',
  scope: 'book:b1',
  title: '测试成稿',
  content: '',
  meta: null,
  createdAt: '2026-01-02T03:04:05.000Z',
  kind: 'compose' as const,
  bookId: 'b1',
  chapterId: null,
  bookTitle: null,
  chapterTitle: null,
  favorite: false,
  status: 'draft' as const,
  updatedAt: '2026-01-02T03:04:05.000Z',
  appliedNoteId: null,
}

test('parses structured compose artifacts and falls back for legacy markdown', () => {
  const structured = parseComposeArtifact({
    ...base,
    content: JSON.stringify({
      title: '标题',
      markdown: '# 标题\n\n正文',
      sourceChapters: 2,
      sourceChars: 100,
      outputChars: 8,
      durationMs: 10,
      model: 'm',
      createdAt: '2026-01-02T03:04:05.000Z',
      options: { length: 'tight', voice: 'calm' },
    }),
  })
  assert.equal(structured?.title, '标题')
  assert.equal(structured?.sourceChapters, 2)
  assert.match(structured?.markdown ?? '', /正文/)

  const legacy = parseComposeArtifact({ ...base, content: '# 旧稿\n\n正文' })
  assert.equal(legacy?.title, '测试成稿')
  assert.match(legacy?.markdown ?? '', /旧稿/)
  assert.equal(parseComposeArtifact(null), null)
})

test('formats version labels from artifact timestamps', () => {
  assert.match(versionLabel(base), /^1\/2 \d{2}:\d{2} · 测试成稿$/)
})
