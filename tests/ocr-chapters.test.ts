import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOutlineChapters, isOcrNoisePage } from '../electron/parsers/pdf-ocr.js'

test('filters obvious ad and copyright pages without dropping a preface', () => {
  assert.equal(isOcrNoisePage('灵语网络英语培训班招生，报名从速，微信咨询，课程优惠。'), true)
  assert.equal(isOcrNoisePage('图书在版编目（CIP）数据 ISBN 978-7-5327-0000-0'), true)
  assert.equal(isOcrNoisePage('我的作品在中国——新版文集总序。这是一段正常的作者自述。'), false)
})

test('uses PDF outline titles and skips ignored front matter', () => {
  const pages = Array.from({ length: 30 }, (_, index) => ({
    page: index + 1,
    text: `第 ${index + 1} 页正文，包含足够长的内容用于测试章节切分和页码范围。`.repeat(4),
  }))
  const chapters = buildOutlineChapters(
    pages,
    [
      { title: '封面', page: 1, depth: 1 },
      { title: '目录', page: 2, depth: 1 },
      { title: '第一章 开始', page: 3, depth: 1 },
      { title: '第二章 继续', page: 15, depth: 1 },
    ],
    30,
  )
  assert.deepEqual(chapters.map((chapter) => chapter.title), ['第一章 开始', '第二章 继续'])
  assert.match(chapters[0]!.text, /第 3 页/)
  assert.match(chapters[0]!.text, /第 14 页/)
  assert.match(chapters[1]!.text, /第 15 页/)
})
