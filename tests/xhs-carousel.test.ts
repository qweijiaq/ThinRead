import assert from 'node:assert/strict'
import test from 'node:test'

import { createCanvas } from '@napi-rs/canvas'

import type { ChapterMeta, Note } from '../shared/types.js'
import { planXhsCarousel, renderXhsPage } from '../src/lib/xhs-carousel.js'

const CHAPTERS: ChapterMeta[] = [
  { id: 'c1', idx: 0, title: '第一章 认知', chars: 1000, hidden: false, kind: 'content', reason: null, classifiedBy: null, partTitle: null, partIndex: null, isPart: false },
  { id: 'c2', idx: 1, title: '第二章 行动', chars: 1200, hidden: false, kind: 'content', reason: null, classifiedBy: null, partTitle: null, partIndex: null, isPart: false },
  { id: 'c3', idx: 2, title: '隐藏章节', chars: 200, hidden: true, kind: 'content', reason: null, classifiedBy: null, partTitle: null, partIndex: null, isPart: false },
]

function note(
  id: string,
  title: string,
  content: string,
  chapterId: string | null = 'c1',
  kind: Note['kind'] = 'point',
  tags: string[] = ['认知'],
): Note {
  return {
    id,
    bookId: 'b1',
    chapterId,
    kind,
    title,
    content,
    quote: null,
    quoteVerified: false,
    author: 'ai',
    edited: false,
    tags,
    section: null,
    importance: null,
    role: null,
    divergences: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function measure() {
  const canvas = createCanvas(1080, 1440)
  const ctx = canvas.getContext('2d')
  return { canvas, ctx: ctx as unknown as CanvasRenderingContext2D }
}

test('packs all chapter knowledge points exactly once and splits long cards', () => {
  const { ctx } = measure()
  const long = `长卡片。${'这是一个需要继续写下去的知识点，'.repeat(120)}最后一句。`
  const notes = [
    note('n1', '注意力是有限的', '注意力是有限的，环境设计比意志力更可靠。'),
    note('n2', '长卡片', long),
    note('n3', '元认知', '元认知让人从自动反应里退后一步。'),
    note('n4', '不是知识点', '这条不是知识点。', 'c1', 'summary'),
  ]
  const plan = planXhsCarousel({
    scope: 'chapter',
    bookTitle: '认知之书',
    author: '作者',
    chapterTitle: '第一章 认知',
    chapters: CHAPTERS,
    notes,
    measure: ctx,
  })
  assert.equal(plan.totalCards, 3)
  assert.equal(plan.coveredCards, 3)
  assert.equal(plan.pages[0]?.kind, 'cover')
  assert.equal(plan.pages.at(-1)?.kind, 'closing')
  const ids = plan.pages.flatMap((page) => page.parts.map((part) => part.cardId))
  assert.deepEqual(new Set(ids), new Set(['n1', 'n2', 'n3']))
  assert.equal(ids.filter((id) => id === 'n2').length > 1, true)
  assert.ok(plan.pages.some((page) => page.parts.some((part) => part.continuation)))
})

test('orders book pages by chapter and skips hidden chapters', () => {
  const { ctx } = measure()
  const notes = [
    note('n2', '第二章知识点', '第二章的内容。', 'c2'),
    note('n1', '第一章知识点', '第一章的内容。', 'c1'),
    note('n3', '隐藏章节知识点', '不应出现。', 'c3'),
  ]
  const plan = planXhsCarousel({
    scope: 'book',
    bookTitle: '一本小书',
    author: '作者',
    chapters: CHAPTERS,
    notes,
    measure: ctx,
  })
  assert.deepEqual(plan.chapterTitles, ['第一章 认知', '第二章 行动'])
  assert.equal(plan.totalCards, 2)
  assert.equal(plan.coveredCards, 2)
  const chapterOrder = plan.pages
    .filter((page) => page.kind === 'content')
    .map((page) => page.chapterTitle)
  assert.deepEqual(chapterOrder, ['第一章 认知', '第二章 行动'])
  const ids = plan.pages.flatMap((page) => page.parts.map((part) => part.cardId))
  assert.deepEqual(new Set(ids), new Set(['n1', 'n2']))
})

test('renders cover, content and closing pages at 1080 x 1440', () => {
  const { canvas, ctx } = measure()
  const plan = planXhsCarousel({
    scope: 'chapter',
    bookTitle: '认知之书',
    author: '作者',
    chapterTitle: '第一章 认知',
    chapters: CHAPTERS,
    notes: [note('n1', '注意力是有限的', '注意力是有限的，环境设计比意志力更可靠。')],
    measure: ctx,
  })
  for (let index = 0; index < plan.pages.length; index++) {
    renderXhsPage(canvas as unknown as HTMLCanvasElement, plan, index, 'paper')
    assert.equal(canvas.width, 1080)
    assert.equal(canvas.height, 1440)
  }
})
