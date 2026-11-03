import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

if (process.platform !== 'darwin') {
  console.error('[packaged] 当前只验证 macOS 产物。')
  process.exit(1)
}

const appDir = fs
  .readdirSync('release', { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac'))
  .map((entry) => path.join('release', entry.name))
  .flatMap((dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
      .map((entry) => path.join(dir, entry.name)),
  )[0]

if (!appDir) {
  console.error('[packaged] 找不到 release/mac-*/*.app，请先运行 pnpm dist:mac。')
  process.exit(1)
}

const executable = path.join(appDir, 'Contents', 'MacOS', path.basename(appDir, '.app'))
if (!fs.existsSync(executable)) {
  console.error(`[packaged] 找不到可执行文件：${executable}`)
  process.exit(1)
}
const resources = path.join(appDir, 'Contents', 'Resources')
if (!fs.existsSync(path.join(resources, 'app.asar.unpacked'))) {
  console.error('[packaged] 安装包缺少 asar.unpacked 资源（onnxruntime / canvas / pdfjs）。')
  process.exit(1)
}

const child = spawn(executable, ['--smoke-test'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: { ...process.env, THINREAD_HEADLESS: '1' },
})
const timer = setTimeout(() => child.kill('SIGKILL'), 120_000)
const code = await new Promise((resolve) => {
  child.on('error', () => resolve(1))
  child.on('exit', (exitCode) => resolve(exitCode ?? 1))
})
clearTimeout(timer)
if (code === 0) console.log(`[packaged] PASSED ${appDir}`)
else console.error(`[packaged] FAILED (exit ${code})`)
process.exit(code)
