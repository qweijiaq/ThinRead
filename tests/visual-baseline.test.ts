import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createCanvas, type Canvas } from '@napi-rs/canvas'

import type { ChapterMeta, Note } from '../shared/types.js'
import { renderShareCard, type ShareCardInput } from '../src/lib/share-card.js'
import { planXhsCarousel, renderXhsPage } from '../src/lib/xhs-carousel.js'

const BASELINE = path.join(process.cwd(), 'docs', 'visual-baseline.json')
const UPDATE = process.env.UPDATE_VISUAL === '1'

const shareBase: ShareCardInput = {
  template: 'condensed',
  theme: 'paper',
  ratio: 'portrait',
  title: '专注的练习',
  body: '专注不是把注意力锁死在一个点上，而是不断把走神的自己带回来。真正可靠的方法不是禁止分心，而是缩短发现自己分心的时间。',
  quote: '专注不是把注意力锁死在一个点上。',
  source: '专注的练习 · 第一章',
  tags: ['注意力'],
  hideSource: false,
  hideTags: false,
  book: null,
  deck: null,
}

const chapter: ChapterMeta = {
  id: 'c1', idx: 0, title: '第一章 专注', chars: 100, hidden: false, kind: 'content',
  reason: null, classifiedBy: null, partTitle: null, partIndex: null, isPart: false,
}
const note: Note = {
  id: 'n1', bookId: 'b1', chapterId: 'c1', kind: 'point', title: '专注不是意志力',
  content: '专注不是意志力，而是不断把走神的自己带回来。环境设计比反复下决心更可靠。',
  quote: null, quoteVerified: false, author: 'ai', edited: false, tags: ['专注'], section: '第一节',
  importance: 4, role: '支撑本章判断', divergences: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}

function digest(canvas: Canvas): string {
  return crypto.createHash('sha256').update(canvas.toBuffer('image/png')).digest('hex')
}

function renderAll(): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const template of ['quote', 'knowledge', 'condensed', 'book'] as const) {
    const canvas = createCanvas(1080, 1440)
    renderShareCard(canvas as unknown as HTMLCanvasElement, { ...shareBase, template })
    hashes[`share-${template}`] = digest(canvas)
  }
  const measure = createCanvas(1080, 1440).getContext('2d') as unknown as CanvasRenderingContext2D
  const plan = planXhsCarousel({
    scope: 'chapter', bookTitle: '专注的练习', author: '作者', chapterTitle: '第一章 专注',
    chapters: [chapter], notes: [note], measure,
  })
  const cover = createCanvas(1080, 1440)
  renderXhsPage(cover as unknown as HTMLCanvasElement, plan, 0, 'paper')
  hashes['xhs-cover'] = digest(cover)
  const content = createCanvas(1080, 1440)
  renderXhsPage(content as unknown as HTMLCanvasElement, plan, 1, 'paper')
  hashes['xhs-content'] = digest(content)
  return hashes
}

test(
  'visual baselines match the committed hashes',
  {
    skip: process.env.CI
      ? '视觉基线依赖本机 macOS 字体，不在 CI 中校验；本地用 UPDATE_VISUAL=1 pnpm test 更新'
      : process.platform !== 'darwin'
        ? '视觉基线依赖 macOS 系统字体，仅在 macOS 上校验'
        : false,
  },
  () => {
  const actual = renderAll()
  if (UPDATE || !fs.existsSync(BASELINE)) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true })
    fs.writeFileSync(BASELINE, `${JSON.stringify({ updatedAt: new Date().toISOString(), hashes: actual }, null, 2)}\n`)
  }
  const expected = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as { hashes: Record<string, string> }
  assert.deepEqual(actual, expected.hashes, '视觉基线变化；确认改动符合预期后运行 UPDATE_VISUAL=1 pnpm test 更新')
},
)
