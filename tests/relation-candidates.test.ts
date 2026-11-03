import assert from 'node:assert/strict'
import test from 'node:test'

import { candidateSnippets, extractCharacterCandidates } from '../electron/ai/relation-candidates.js'

const chapter =
  '司理理笑道：“殿下何必明知故问。”范闲说：“我只想知道真相。”' +
  '司理理沉默片刻，又道：“有些事知道得越少越好。”' +
  '范闲看着窗外，庆帝道：“让她说下去。”'

test('finds supporting characters from dialogue and surname patterns', () => {
  const names = extractCharacterCandidates([chapter, chapter], []).map((item) => item.name)
  assert.ok(names.includes('司理理'))
  assert.ok(names.includes('范闲'))
  assert.ok(names.includes('庆帝'))
  assert.ok(!names.includes('说道'))
  assert.ok(!names.includes('司理理笑'))
})

test('finds names, nicknames and titles without ordinary surnames', () => {
  const text =
    '四顾剑是四大宗师之一，苦荷也是四大宗师。庆帝坐在宫中，五竹站在门口。' +
    '叶流云看着四顾剑，苦荷说道：“你来了。”四顾剑道：“我来了。”' +
    '林婉儿与王启年站在宫外。'
  const names = extractCharacterCandidates([text, text, text], []).map((item) => item.name)
  for (const name of ['四顾剑', '苦荷', '庆帝', '五竹', '叶流云', '林婉儿', '王启年']) {
    assert.ok(names.includes(name), `missing ${name}`)
  }
  assert.ok(!names.includes('说道'))
  assert.ok(!names.includes('庆帝坐在宫'))
  assert.ok(!names.includes('五竹站在门'))
})

test('builds short original-text windows for candidates', () => {
  const snippets = candidateSnippets([chapter], ['司理理', '范闲'])
  assert.match(snippets, /司理理：/)
  assert.match(snippets, /范闲：/)
  assert.match(snippets, /殿下何必明知故问/)
})
