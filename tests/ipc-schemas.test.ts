import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bookIdArgs,
  labArtifactArgs,
  mergeBooksArgs,
  noteDraftArgs,
  notePatchArgs,
  saveTextArgs,
  splitBookArgs,
  textImportArgs,
} from '../shared/ipc-schemas.js'

const id = '4d21ddfd-5a47-4e01-bb5b-e4b9db2a7c9c'
const id2 = '7ca8a115-2c21-4462-8aca-3bf4b7b25c54'

test('accepts well-formed book arguments', () => {
  assert.deepEqual(bookIdArgs.parse([id]), [id])
  const [ids, title] = mergeBooksArgs.parse([[id, id2], '合并后的书', '作者'])
  assert.deepEqual(ids, [id, id2])
  assert.equal(title, '合并后的书')
  assert.deepEqual(splitBookArgs.parse([id, id2, '下半部']), [id, id2, '下半部'])
})

test('rejects path-like book ids and too few books', () => {
  for (const value of ['../../etc', '..', `${id}/..`, 'not-a-uuid']) {
    assert.throws(() => bookIdArgs.parse([value]))
  }
  assert.throws(() => mergeBooksArgs.parse([[id], '', '']), /至少选择两本书/)
})

test('caps oversized import text and note content', () => {
  assert.throws(
    () => textImportArgs.parse([{ text: 'x'.repeat(10_000_001) }]),
    /1000 万字上限/,
  )
  assert.doesNotThrow(() => textImportArgs.parse([{ text: 'x'.repeat(1000), title: '标题' }]))
  assert.throws(
    () => notePatchArgs.parse([id, { content: 'x'.repeat(200_001) }]),
    /20 万字上限/,
  )
})

test('accepts note drafts with nullable chapter and rejects unknown kinds', () => {
  const [draft] = noteDraftArgs.parse([{ bookId: id, chapterId: null, kind: 'thought', content: '' }])
  assert.equal(draft.chapterId, null)
  assert.equal(draft.content, '')
  assert.throws(() => noteDraftArgs.parse([{ bookId: id, kind: 'idea', content: 'x' }]))
})

test('caps generated artifact and exported file content', () => {
  assert.throws(
    () => labArtifactArgs.parse([{ tool: 'lab', scope: 'x', title: 't', content: 'x'.repeat(5_000_001) }]),
    /500 万字上限/,
  )
  assert.throws(() => saveTextArgs.parse(['a.md', 'x'.repeat(20_000_001)]), /2000 万字上限/)
  assert.doesNotThrow(() => saveTextArgs.parse(['a.md', '# 标题']))
})
