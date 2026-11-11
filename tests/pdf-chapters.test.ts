import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOutlineChapters,
  buildPagedChapters,
  detectPdfChapterStarts,
  type PdfPageText,
} from '../electron/parsers/pdf-chapters.js'
import { readOutlineStarts, type PdfDocument } from '../electron/parsers/pdf.js'

function pages(texts: string[]): PdfPageText[] {
  return texts.map((text, index) => ({ page: index + 1, text }))
}

test('uses PDF outline bookmarks before page ranges', () => {
  const input = pages(Array.from({ length: 20 }, (_, index) => `Page ${index + 1} body text.`))
  const chapters = buildOutlineChapters(
    input,
    [
      { page: 1, title: 'Chapter 1: Beginning' },
      { page: 11, title: 'Chapter 2: Ending' },
    ],
    20,
  )
  assert.equal(chapters.length, 2)
  assert.equal(chapters[0]?.title, 'Chapter 1: Beginning')
  assert.equal(chapters[1]?.title, 'Chapter 2: Ending')
  assert.match(chapters[0]?.text ?? '', /\[第 1 页\]/)
  assert.match(chapters[1]?.text ?? '', /\[第 20 页\]/)
})

test('resolves numeric, named and reference outline destinations', async () => {
  const doc = {
    numPages: 10,
    getOutline: async () => [
      { title: 'Chapter 1', dest: [0] },
      { title: 'Chapter 2', dest: 'chapter-2' },
      { title: 'Chapter 3', dest: [{ num: 8, gen: 0 }] },
    ],
    getDestination: async (id: string) => (id === 'chapter-2' ? [4] : null),
    getPageIndex: async () => 7,
  } as unknown as PdfDocument
  const starts = await readOutlineStarts(doc, 10)
  assert.deepEqual(
    starts.map((item) => [item.title, item.page]),
    [
      ['Chapter 1', 1],
      ['Chapter 2', 5],
      ['Chapter 3', 8],
    ],
  )
})

test('keeps front matter when the first bookmark starts later', () => {
  const input = pages(['Preface text that is long enough.', 'More preface text.', 'Chapter body.', 'More body.'])
  const chapters = buildOutlineChapters(input, [{ page: 3, title: 'Chapter 1' }], 4)
  assert.equal(chapters.length, 2)
  assert.match(chapters[0]?.title ?? '', /前言/)
  assert.equal(chapters[1]?.title, 'Chapter 1')
})

test('detects chapter headings near the top of a page', () => {
  const input = pages([
    'Chapter 1\nThis is the opening paragraph.',
    'Body text without a heading.',
    'Chapter 2\nSecond chapter starts here.',
    'More body text.',
  ])
  const starts = detectPdfChapterStarts(input)
  assert.deepEqual(
    starts.map((item) => item.page),
    [1, 3],
  )
  assert.equal(starts[1]?.title, 'Chapter 2')
})

test('ignores contents pages and repeated running headers', () => {
  const toc = pages([
    'Contents\nChapter 1\nChapter 2\nChapter 3',
    'Chapter 1\nBody.',
    'Chapter 2\nBody.',
    'Chapter 3\nBody.',
  ])
  const starts = detectPdfChapterStarts(toc)
  assert.equal(starts.length, 3)

  const running = pages([
    'Chapter 1\nBody one.',
    'Chapter 1\nBody two.',
    'Chapter 1\nBody three.',
    'Chapter 1\nBody four.',
  ])
  assert.equal(detectPdfChapterStarts(running).length, 0)
})

test('falls back to fixed page ranges when no structure is available', () => {
  const input = pages(Array.from({ length: 23 }, (_, index) => `Body ${index + 1}`))
  const chapters = buildPagedChapters(input, 10)
  assert.equal(chapters.length, 3)
  assert.equal(chapters[0]?.title, '第 1–10 页')
  assert.equal(chapters[2]?.title, '第 21–23 页')
})
