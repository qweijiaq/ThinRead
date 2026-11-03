import path from 'node:path'

const BOOK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 书籍文件目录只接受 UUID，并强制落在 <dataDir>/books 下。
 * 渲染层传来的 id 不能直接拼进 fs.rm —— 否则 ../../ 就能删到用户目录。
 */
export function bookStorageDir(dataDir: string, bookId: unknown): string {
  if (typeof bookId !== 'string' || !BOOK_ID.test(bookId)) {
    throw new Error('书籍编号无效。')
  }
  const root = path.resolve(dataDir, 'books')
  const target = path.resolve(root, bookId)
  if (path.dirname(target) !== root) {
    throw new Error('书籍路径无效。')
  }
  return target
}
