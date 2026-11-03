import assert from 'node:assert/strict'
import test from 'node:test'

import { apaCitation, bibtexCitation, risCitation } from '../src/lib/citations.js'

const input = { title: '注意力的练习', author: '测试作者', date: '2026-11-01' }

test('exports APA, BibTeX and RIS citations', () => {
  assert.equal(apaCitation(input), '测试作者. (2026). 注意力的练习.')
  assert.match(bibtexCitation(input), /@book\{/)
  assert.match(bibtexCitation(input), /title = \{注意力的练习\}/)
  assert.match(bibtexCitation(input), /author = \{测试作者\}/)
  assert.match(risCitation(input), /TY {2}- BOOK/)
  assert.match(risCitation(input), /TI {2}- 注意力的练习/)
  assert.match(risCitation(input), /PY {2}- 2026/)
})
