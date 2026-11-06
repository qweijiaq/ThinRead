import assert from 'node:assert/strict'
import test from 'node:test'

import { createAppLock, isUsablePasscode, verifyAppLock } from '../electron/app-lock.js'

test('hashes and verifies an app-lock passcode', () => {
  const lock = createAppLock('correct horse')
  assert.equal(verifyAppLock('correct horse', lock), true)
  assert.equal(verifyAppLock('wrong', lock), false)
  assert.equal(verifyAppLock('correct horse', null), false)
})

test('requires a usable passcode length', () => {
  assert.equal(isUsablePasscode('123'), false)
  assert.equal(isUsablePasscode('1234'), true)
  assert.equal(isUsablePasscode(''), false)
  assert.equal(isUsablePasscode('x'.repeat(129)), false)
})
