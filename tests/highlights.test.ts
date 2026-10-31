import assert from 'node:assert/strict'
import test from 'node:test'

import { groupHighlights, parseHighlightsFile } from '../electron/parsers/highlights.js'

const CSV = `Highlight,Book Title,Book Author,Note,Tags,Location,URL
"专注不是意志力，而是环境设计。","专注的练习","测试作者","先改环境。","专注,习惯",12,https://example.com/a
"缩短发现分心的时间。","专注的练习","测试作者","","专注",18,https://example.com/a
"历史由人推动。","明朝那些事儿","当年明月","","历史",33,https://example.com/b
"专注不是意志力，而是环境设计。","专注的练习","测试作者","重复","专注",12,https://example.com/a
`

const KINDLE = `专注的练习 (测试作者)
- 您的位置 12 | 添加于 2026年1月1日

专注不是意志力，而是环境设计。
==========
专注的练习 (测试作者)
- 您的位置 18 | 添加于 2026年1月1日

缩短发现分心的时间。
==========
明朝那些事儿 (当年明月)
- 您的位置 33 | 添加于 2026年1月1日

历史由人推动。
==========
`

test('parses and groups Readwise CSV exports', () => {
  const entries = parseHighlightsFile(CSV, 'readwise.csv')
  assert.equal(entries.length, 3)
  const groups = groupHighlights(entries)
  assert.equal(groups.length, 2)
  assert.equal(groups[0]!.title, '专注的练习')
  assert.equal(groups[0]!.author, '测试作者')
  assert.deepEqual(groups[0]!.entries[0]!.tags, ['专注', '习惯'])
  assert.equal(groups[0]!.entries[0]!.note, '先改环境。')
})

test('parses Kindle My Clippings', () => {
  const entries = parseHighlightsFile(KINDLE, 'My Clippings.txt')
  assert.equal(entries.length, 3)
  const groups = groupHighlights(entries)
  assert.equal(groups.length, 2)
  assert.equal(groups[0]!.author, '测试作者')
  assert.equal(groups[0]!.entries.length, 2)
  assert.equal(groups[1]!.author, '当年明月')
  assert.equal(groups[1]!.entries[0]!.location, '33')
})

test('deduplicates identical highlights', () => {
  const entries = parseHighlightsFile(CSV, 'readwise.csv')
  assert.equal(entries.filter((entry) => entry.text === '专注不是意志力，而是环境设计。').length, 1)
})
