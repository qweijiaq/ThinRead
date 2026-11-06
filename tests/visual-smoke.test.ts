import assert from 'node:assert/strict'
import test from 'node:test'

import { createCanvas } from '@napi-rs/canvas'

import { renderShareCard, type ShareCardInput } from '../src/lib/share-card.js'

const base: ShareCardInput = {
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

test('renders share cards with expected dimensions and non-trivial pixels', () => {
  for (const template of ['quote', 'knowledge', 'condensed', 'book'] as const) {
    const canvas = createCanvas(1080, 1440)
    renderShareCard(canvas as unknown as HTMLCanvasElement, { ...base, template })
    assert.equal(canvas.width, 1080)
    assert.equal(canvas.height, 1440)
    const png = canvas.toBuffer('image/png')
    // 不同系统的字体回退会影响 PNG 体积；空白画布通常只有几 KB。
    assert.ok(png.length > 10_000, `${template} render is too small: ${png.length}`)
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  }
})
