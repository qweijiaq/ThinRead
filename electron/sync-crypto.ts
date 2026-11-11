import crypto from 'node:crypto'
import fs from 'node:fs'

/**
 * 同步快照的端到端加密。
 *
 * 快照本身是整库 zip，放进 iCloud Drive / Dropbox / NAS 时不应该以明文落盘。
 * 这里用口令派生密钥（scrypt）+ AES-256-GCM，口令不保存到任何地方；
 * 文件头带 magic，方便和普通 zip 快照区分。
 */

const MAGIC = Buffer.from('TRSYNC1\0', 'utf8')
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const

export function isEncryptedSnapshot(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r')
    const head = Buffer.alloc(MAGIC.length)
    const read = fs.readSync(fd, head, 0, MAGIC.length, 0)
    fs.closeSync(fd)
    return read === MAGIC.length && head.equals(MAGIC)
  } catch {
    return false
  }
}

export function encryptSnapshot(source: string, destination: string, passphrase: string): void {
  const secret = passphrase.trim()
  if (!secret) throw new Error('加密口令不能为空。')
  const data = fs.readFileSync(source)
  const salt = crypto.randomBytes(SALT_LEN)
  const iv = crypto.randomBytes(IV_LEN)
  const key = crypto.scryptSync(secret, salt, KEY_LEN, SCRYPT)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()])
  const tag = cipher.getAuthTag()
  fs.writeFileSync(destination, Buffer.concat([MAGIC, salt, iv, tag, ciphertext]), { mode: 0o600 })
}

export function decryptSnapshot(source: string, destination: string, passphrase: string): void {
  const secret = passphrase.trim()
  if (!secret) throw new Error('这个快照是加密的，需要输入口令。')
  const raw = fs.readFileSync(source)
  if (raw.length < MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN) throw new Error('快照文件不完整。')
  if (!raw.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('不是加密的页边同步快照。')
  let offset = MAGIC.length
  const salt = raw.subarray(offset, offset + SALT_LEN)
  offset += SALT_LEN
  const iv = raw.subarray(offset, offset + IV_LEN)
  offset += IV_LEN
  const tag = raw.subarray(offset, offset + TAG_LEN)
  offset += TAG_LEN
  const ciphertext = raw.subarray(offset)
  const key = crypto.scryptSync(secret, salt, KEY_LEN, SCRYPT)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  try {
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    fs.writeFileSync(destination, plain)
  } catch {
    throw new Error('口令不对，或快照已损坏。')
  }
}
