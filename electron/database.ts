import type { DatabaseSync } from 'node:sqlite'

let db: DatabaseSync | null = null

export function getDatabase(): DatabaseSync {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

export function setDatabase(connection: DatabaseSync | null): void {
  db = connection
}

export function closeDatabase(): void {
  db?.close()
  db = null
}
