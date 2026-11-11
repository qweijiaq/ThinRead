import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { decryptSnapshot, encryptSnapshot, isEncryptedSnapshot } from '../electron/sync-crypto.js'

test('encrypts and decrypts a sync snapshot with a passphrase', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thinread-sync-crypto-'))
  try {
    const source = path.join(dir, 'snapshot.zip')
    fs.writeFileSync(source, 'thinread-library-payload')
    const encrypted = path.join(dir, 'snapshot.thinsync')
    encryptSnapshot(source, encrypted, 'correct horse battery staple')
    assert.equal(isEncryptedSnapshot(encrypted), true)
    assert.equal(fs.readFileSync(encrypted, 'utf8').includes('thinread-library-payload'), false)

    const output = path.join(dir, 'output.zip')
    decryptSnapshot(encrypted, output, 'correct horse battery staple')
    assert.equal(fs.readFileSync(output, 'utf8'), 'thinread-library-payload')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('rejects a wrong passphrase without writing plaintext', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thinread-sync-crypto-wrong-'))
  try {
    const source = path.join(dir, 'snapshot.zip')
    fs.writeFileSync(source, 'secret')
    const encrypted = path.join(dir, 'snapshot.thinsync')
    encryptSnapshot(source, encrypted, 'right-passphrase')
    const output = path.join(dir, 'output.zip')
    assert.throws(() => decryptSnapshot(encrypted, output, 'wrong-passphrase'), /口令不对|损坏/)
    assert.equal(fs.existsSync(output), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('rejects an empty passphrase when encrypting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thinread-sync-crypto-empty-'))
  try {
    const source = path.join(dir, 'snapshot.zip')
    fs.writeFileSync(source, 'secret')
    assert.throws(() => encryptSnapshot(source, path.join(dir, 'x.thinsync'), '   '), /口令不能为空/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
