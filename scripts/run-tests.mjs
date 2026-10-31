import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { build } from 'esbuild'

const sourceDir = 'tests'
const outDir = '.test-build'
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const entries = fs
  .readdirSync(sourceDir)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()

if (entries.length === 0) {
  console.error('没有找到 tests/*.test.ts')
  process.exit(1)
}

const outputs = []
for (const entry of entries) {
  const outfile = path.join(outDir, entry.replace(/\.ts$/, '.cjs'))
  await build({
    entryPoints: [path.join(sourceDir, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    sourcemap: 'inline',
    logLevel: 'warning',
  })
  outputs.push(outfile)
}

const child = spawn(process.execPath, ['--test', ...outputs], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 1))
