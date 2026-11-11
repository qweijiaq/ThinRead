import fs from 'node:fs'
import path from 'node:path'

/**
 * 架构边界检查：渲染层只能依赖 src/ 和 shared/。
 *
 * 这条规则比类型检查更早发现问题：一旦有人在 React 组件里 import electron、
 * node:fs 或主进程模块，类型检查通常仍能通过（因为 tsconfig 能看到 node 类型），
 * 但应用会在运行时崩溃，或者把主进程代码打进渲染层包。
 */

const root = process.cwd()
const srcDir = path.join(root, 'src')
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])
const errors = []

const forbiddenSpecifiers = [
  { pattern: /^electron$/, reason: '渲染层不能直接使用 electron 模块' },
  { pattern: /^node:/, reason: '渲染层不能使用 Node 内置模块' },
  { pattern: /^fs$|^path$|^child_process$|^crypto$|^os$/, reason: '渲染层不能使用 Node 内置模块' },
  { pattern: /(^|\/)dist-electron(\/|$)/, reason: '渲染层不能引用构建产物' },
  { pattern: /(^|\/)electron(\/|$)/, reason: '渲染层不能引用主进程代码' },
]

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (!extensions.has(path.extname(entry.name))) continue
    checkFile(full)
  }
}

function checkFile(file) {
  const relative = path.relative(root, file)
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match =
      /(?:^|\s)(?:import|export)\s[^'"]*from\s*['"]([^'"]+)['"]/.exec(line) ??
      /(?:^|\s)import\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(line) ??
      /require\(\s*['"]([^'"]+)['"]\s*\)/.exec(line)
    if (!match) continue
    const specifier = match[1]
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const resolved = path.resolve(path.dirname(file), specifier)
      const normalized = resolved.split(path.sep).join('/')
      if (!normalized.startsWith(srcDir.split(path.sep).join('/')) && !normalized.includes('/shared/')) {
        if (normalized.includes('/electron/')) {
          errors.push(`${relative}:${index + 1} 渲染层不能引用主进程代码（${specifier}）`)
        }
      }
      continue
    }
    for (const rule of forbiddenSpecifiers) {
      if (rule.pattern.test(specifier)) {
        errors.push(`${relative}:${index + 1} ${rule.reason}（${specifier}）`)
        break
      }
    }
  }
}

if (!fs.existsSync(srcDir)) {
  console.error('[check:boundaries] 找不到 src 目录')
  process.exit(1)
}

walk(srcDir)

if (errors.length > 0) {
  console.error('[check:boundaries] 失败')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('[check:boundaries] PASSED')
