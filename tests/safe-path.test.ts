import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { bookStorageDir } from '../electron/safe-path.js'

const dataDir = '/tmp/thinread-safe-path'
const id = '4d21ddfd-5a47-4e01-bb5b-e4b9db2a7c9c'

test('resolves a normal book directory under dataDir/books', () => {
  assert.equal(bookStorageDir(dataDir, id), path.join(dataDir, 'books', id))
})

test('rejects ids that are not UUIDs', () => {
  for (const value of ['', '..', '../../etc', 'books/../../x', `${id}/../../x`, null, 42]) {
    assert.throws(() => bookStorageDir(dataDir, value as unknown), /书籍编号无效|书籍路径无效/)
  }
})

test('rejects traversal attempts that still look like paths', () => {
  assert.throws(() => bookStorageDir(dataDir, `${id}/..`), /书籍编号无效/)
  assert.throws(() => bookStorageDir(dataDir, `../${id}`), /书籍编号无效/)
})
