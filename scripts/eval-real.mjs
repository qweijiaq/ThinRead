import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

import electronPath from 'electron'

const dataDir =
  process.env.THINREAD_DATA_DIR ||
  (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'reading-notes')
    : path.join(os.homedir(), '.config', 'reading-notes'))

const child = spawn(electronPath, ['.', `--data-dir=${dataDir}`, '--eval-real'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
})
const timer = setTimeout(() => {
  console.error('[eval-real] 超时')
  child.kill('SIGKILL')
}, 600_000)

const code = await new Promise((resolve) => {
  child.on('error', (error) => {
    console.error('[eval-real] 启动失败', error)
    resolve(1)
  })
  child.on('exit', (exitCode) => resolve(exitCode ?? 1))
})
clearTimeout(timer)
process.exit(code)
