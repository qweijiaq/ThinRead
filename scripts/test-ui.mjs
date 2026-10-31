import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import electronPath from 'electron'

const root = process.cwd()
const entry = path.join(root, 'dist', 'index.html')
if (!fs.existsSync(entry)) {
  console.error('找不到 dist/index.html，请先运行 pnpm build。')
  process.exit(1)
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-ui-'))
const args = [
  '.',
  `--data-dir=${dataDir}`,
  '--seed-demo',
  `--exec-file=${path.join(root, 'tests', 'ui-smoke.js')}`,
  '--dump-dom',
]
if (process.platform === 'linux') args.push('--no-sandbox')

const child = spawn(electronPath, args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, THINREAD_HEADLESS: '1' },
})
const timer = setTimeout(() => {
  console.error('[ui-smoke] 超时，结束 Electron 进程')
  child.kill('SIGKILL')
}, 120_000)

const code = await new Promise((resolve) => {
  child.on('error', (error) => {
    console.error('[ui-smoke] 启动失败', error)
    resolve(1)
  })
  child.on('exit', (exitCode) => resolve(exitCode ?? 1))
})

clearTimeout(timer)
fs.rmSync(dataDir, { recursive: true, force: true })
if (code === 0) console.log('[ui-smoke] PASSED')
else console.error(`[ui-smoke] FAILED (exit ${code})`)
process.exit(code)
