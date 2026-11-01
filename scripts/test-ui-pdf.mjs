import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import electronPath from 'electron'

const root = process.cwd()
const fixture = path.join(root, 'samples', 'sample.pdf')
if (!fs.existsSync(path.join(root, 'dist', 'index.html')) || !fs.existsSync(fixture)) {
  console.error('缺少 dist 或 samples/sample.pdf，请先运行 pnpm build。')
  process.exit(1)
}
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-ui-pdf-'))
const imported = spawnSync(electronPath, ['.', `--data-dir=${dataDir}`, `--import=${fixture}`, '--store'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, THINREAD_HEADLESS: '1' },
})
if (imported.status !== 0) {
  fs.rmSync(dataDir, { recursive: true, force: true })
  process.exit(imported.status ?? 1)
}

const child = spawn(
  electronPath,
  ['.', `--data-dir=${dataDir}`, `--exec-file=${path.join(root, 'tests', 'pdf-viewer-smoke.js')}`, '--dump-dom'],
  { cwd: root, stdio: 'inherit', env: { ...process.env, THINREAD_HEADLESS: '1' } },
)
const timer = setTimeout(() => child.kill('SIGKILL'), 120_000)
const code = await new Promise((resolve) => {
  child.on('error', (error) => {
    console.error('[ui-pdf] 启动失败', error)
    resolve(1)
  })
  child.on('exit', (exitCode) => resolve(exitCode ?? 1))
})
clearTimeout(timer)
fs.rmSync(dataDir, { recursive: true, force: true })
if (code === 0) console.log('[ui-pdf] PASSED')
else console.error(`[ui-pdf] FAILED (exit ${code})`)
process.exit(code)
