import assert from 'node:assert/strict'
import test from 'node:test'

import { parseListenScript, pickPodcastVoices, voiceLabel } from '../src/lib/listen-script.js'

test('parses a dual-host script without reading speaker labels or stage directions', () => {
  const segments = parseListenScript(
    '# 开场\nA：欢迎来到页边。\nB：谢谢。（笑）今天我们聊专注。\n* A：这本书最重要的判断是什么？\nB：专注不是意志力，而是环境设计。',
  )
  assert.deepEqual(
    segments.map((item) => [item.speaker, item.text]),
    [
      ['A', '欢迎来到页边。'],
      ['B', '谢谢。'],
      ['B', '今天我们聊专注。'],
      ['A', '这本书最重要的判断是什么？'],
      ['B', '专注不是意志力，而是环境设计。'],
    ],
  )
  assert.equal(segments.some((item) => item.text.includes('A：')), false)
  const years = parseListenScript('A：（2020）年的数据说明了什么？')
  assert.match(years[0]!.text, /2020/)
})

test('parses chapter prose as single-host sentences', () => {
  const segments = parseListenScript('第一段正文。第二段正文！')
  assert.deepEqual(
    segments.map((item) => item.speaker),
    [null, null],
  )
  assert.deepEqual(
    segments.map((item) => item.text),
    ['第一段正文。', '第二段正文！'],
  )
})

test('chooses two distinct Chinese voices when available', () => {
  const plan = pickPodcastVoices([
    { name: 'Ting-Ting', lang: 'zh-CN' },
    { name: 'Mei-Jia', lang: 'zh-CN' },
    { name: 'Samantha', lang: 'en-US' },
  ])
  assert.equal(plan.a?.name, 'Ting-Ting')
  assert.equal(plan.b?.name, 'Mei-Jia')
  assert.equal(plan.distinct, true)
  assert.match(voiceLabel(plan.a), /zh-CN/)
})

test('falls back to one Chinese voice with pitch separation', () => {
  const plan = pickPodcastVoices([{ name: 'Ting-Ting', lang: 'zh-CN' }])
  assert.equal(plan.a?.name, 'Ting-Ting')
  assert.equal(plan.b?.name, 'Ting-Ting')
  assert.equal(plan.distinct, false)
})
