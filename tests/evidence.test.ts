import assert from 'node:assert/strict'
import test from 'node:test'

import { bestEvidence, cleanPoint, findSupportingSentence, normalizeCards, verifyQuote } from '../electron/ai/notes.js'

const CHAPTER = [
  '我猜很多人并不真正了解自己，甚至从未了解过，所以才会对自身的各种问题困惑不已。',
  '这里我说的“自己”，特指自己的大脑部分，因为没有大脑，我们什么都不是。',
  '从大脑开始认识自己，相当于再进化一次。',
].join('')

test('keeps a verbatim quote', () => {
  const quote = '从大脑开始认识自己，相当于再进化一次。'
  assert.equal(verifyQuote(quote, CHAPTER), true)
  assert.equal(bestEvidence(quote, CHAPTER), quote)
})

test('accepts a verbatim fragment without inventing a longer sentence', () => {
  const quote = '这里我说的自己，特指自己的大脑部分'
  const evidence = bestEvidence(quote, CHAPTER)
  assert.equal(evidence, quote)
})

test('drops an unrelated or heavily rewritten quote', () => {
  assert.equal(bestEvidence('意志力是肌肉，可以被训练得更强。', CHAPTER), '')
  assert.equal(bestEvidence('从大脑开始认识自己，相当于再进化一次。', '完全无关的一段文字。'), '')
})

test('finds a supporting sentence for a point without a model quote', () => {
  const point = '注意力可分成落在行动上的部分和落在感受上的部分。'
  const sentence = findSupportingSentence(point, CHAPTER)
  assert.equal(sentence, '')
  const chapter = [
    '回顾任何一件事，我们的注意力其实都可以分为“集中在行动上的”和“集中在感受上的”两部分，比如：',
    '跑步时，把感受收回来，悉心体会抬腿摆臂、呼吸吐纳和迎面的微风。',
  ].join('')
  assert.match(findSupportingSentence(point, chapter), /注意力其实都可以分为/)
  assert.equal(findSupportingSentence('意志力是肌肉，可以被训练得更强。', chapter), '')
})

test('turns a markdown block into one clean point', () => {
  assert.equal(
    cleanPoint('# 深度沉浸\n- 注意力分为行动专注与感受专注。\n- 起初二者统一。'),
    '注意力分为行动专注与感受专注。',
  )
})

test('parses a bare array of cards', () => {
  const cards = normalizeCards(
    [
      {
        point: '从大脑开始认识自己，相当于再进化一次。',
        role: '支撑认识自己的必要性。',
        evidence: '从大脑开始认识自己，相当于再进化一次。',
        section: '第一节',
        concepts: ['大脑'],
        importance: 4,
      },
    ],
    CHAPTER,
  )
  assert.equal(cards.length, 1)
  assert.equal(cards[0]!.evidenceVerified, true)
})
