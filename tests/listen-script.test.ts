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

test('ignores non-dialogue lines after the conversation starts', () => {
  const segments = parseListenScript(
    '# 双人播客脚本\n本期简介：我们聊专注。\nA：第一句还没说完\n继续说完。\nB：这是回答。\n（片尾音乐）\n本期参考：《专注的练习》\n制作：页边',
  )
  assert.deepEqual(
    segments.map((item) => [item.speaker, item.text]),
    [
      ['A', '第一句还没说完继续说完。'],
      ['B', '这是回答。'],
    ],
  )
})

test('detects bold speaker labels and skips role descriptions', () => {
  const segments = parseListenScript(
    '**时长：约 5 分钟**\n**主持人 A：提问、推进**\n**主持人 B：用本章观点回答**\n\n**A：** 欢迎来到页边。\n**B：** 谢谢。',
  )
  assert.deepEqual(
    segments.map((item) => [item.speaker, item.text]),
    [
      ['A', '欢迎来到页边。'],
      ['B', '谢谢。'],
    ],
  )
})

test('drops chapter citations but keeps natural references', () => {
  const segments = parseListenScript(
    'A：这是回答（第二章第一节）。\nB：这也很重要（《认知觉醒》第2章第1节）。\nA：今天我们聊第二章。',
  )
  assert.deepEqual(
    segments.map((item) => item.text),
    ['这是回答。', '这也很重要。', '今天我们聊第二章。'],
  )
})

test('keeps closing quotes attached to the sentence', () => {
  const segments = parseListenScript(
    'B：书里说：“恐惧就是一个欺软怕硬的货色，你正视它，它就原形毕露。”\nA：明白了。',
  )
  assert.deepEqual(
    segments.map((item) => item.text),
    ['书里说：“恐惧就是一个欺软怕硬的货色，你正视它，它就原形毕露。”', '明白了。'],
  )
  assert.equal(segments.some((item) => item.text.trim() === '”'), false)
})

test('does not read markdown tables or bilingual shownotes', () => {
  const segments = parseListenScript(
    '## 时间轴 / Timeline\n| 时间 | 内容 |\n| --- | --- |\n| 00:00 | 开场 |\nA：这是对白。\nB：这是回答。\n### 参考 / References\n- 《书》第二章',
  )
  assert.deepEqual(
    segments.map((item) => [item.speaker, item.text]),
    [
      ['A', '这是对白。'],
      ['B', '这是回答。'],
    ],
  )
})

test('supports named hosts without reading metadata', () => {
  const segments = parseListenScript(
    '**小页：** 欢迎来到页边。\n**小边：** 今天聊专注。\n**小页：** 先从注意力开始。\n本期参考：《专注的练习》',
  )
  assert.deepEqual(
    segments.map((item) => [item.speaker, item.text]),
    [
      ['A', '欢迎来到页边。'],
      ['B', '今天聊专注。'],
      ['A', '先从注意力开始。'],
    ],
  )
})
