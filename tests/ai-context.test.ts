import assert from 'node:assert/strict'
import test from 'node:test'

import { queryTerms, retrievePassages } from '../electron/ai/context.js'

test('retrieves the paragraphs that match the question instead of the chapter head', () => {
  const text = [
    '这一章先讲了一个很长的开场故事，用来铺垫作者为什么要讨论注意力。',
    '注意力是有限资源，每一次抵抗诱惑都会消耗一部分。',
    '环境设计比反复下决心更有效：把手机移出视线，等于提前做完了选择。',
    '最后作者提醒，环境只能减少摩擦，不能替你决定要做什么。',
  ].join('\n\n')

  const excerpt = retrievePassages(text, '环境设计为什么比决心更有效？', 70)
  assert.match(excerpt, /环境设计/)
  assert.ok(excerpt.length < text.length)

  assert.ok(queryTerms('环境设计').includes('环境'))
})
