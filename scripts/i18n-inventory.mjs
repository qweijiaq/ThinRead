import fs from 'node:fs'
import path from 'node:path'

/**
 * 扫描渲染层里的中文文案，输出迁移清单（AI 提示词在主进程，不属于 UI 翻译范围）。
 * 只做静态统计，不改源码：用于估算 i18n 工作量和按文件分批迁移。
 */

const ROOTS = ['src']
const CJK = /[\u3400-\u9fff]/
const STRING = /(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g
const FILE_EXT = new Set(['.ts', '.tsx', '.mjs'])

const byFile = new Map()
const unique = new Set()

function scanFile(file) {
  if (file.endsWith('lib/i18n.ts')) return 0
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split('\n')
  let count = 0
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    for (const match of line.matchAll(STRING)) {
      const value = match[2]
      if (!value || !CJK.test(value)) continue
      // 跳过注释和明显不是 UI 文案的模板片段。
      const prefix = line.slice(0, match.index).trimEnd()
      if (prefix.endsWith('//') || prefix.endsWith('*')) continue
      // 已经包进 t(...) 的文案不再计入待翻译。
      if (prefix.endsWith('t(') || prefix.endsWith('t( ')) continue
      if (/^[\s\d\p{P}]+$/u.test(value)) continue
      unique.add(value)
      count++
    }
  }
  if (count > 0) byFile.set(file, count)
  return count
}

function walk(dir) {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'stories') continue
      total += walk(full)
      continue
    }
    if (!FILE_EXT.has(path.extname(entry.name))) continue
    total += scanFile(full)
  }
  return total
}

let total = 0
for (const root of ROOTS) {
  if (fs.existsSync(root)) total += walk(root)
}

const report = {
  generatedAt: new Date().toISOString(),
  totalLiterals: total,
  uniqueStrings: unique.size,
  byFile: Object.fromEntries([...byFile.entries()].sort((a, b) => b[1] - a[1])),
  strings: [...unique].sort(),
}

fs.mkdirSync('docs', { recursive: true })
fs.writeFileSync('docs/i18n-inventory.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(
  `[i18n] ${total} 处中文字面量，${unique.size} 条唯一文案，覆盖 ${byFile.size} 个文件 → docs/i18n-inventory.json`,
)
