import crypto from 'node:crypto'

export interface AppLockRecord {
  salt: string
  hash: string
}

export function createAppLock(passcode: string): AppLockRecord {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(passcode, salt, 64).toString('hex')
  return { salt, hash }
}

export function verifyAppLock(passcode: string, record: AppLockRecord | null | undefined): boolean {
  if (!record?.salt || !record.hash) return false
  try {
    const actual = crypto.scryptSync(passcode, record.salt, 64)
    const expected = Buffer.from(record.hash, 'hex')
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

export function isUsablePasscode(passcode: string): boolean {
  return passcode.trim().length >= 4 && passcode.trim().length <= 128
}
