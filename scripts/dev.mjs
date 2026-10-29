import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const build = spawn(process.execPath, ['scripts/build-electron.mjs'], { stdio: 'inherit' })
const buildCode = await new Promise((resolve) => build.on('exit', resolve))
if (buildCode !== 0) process.exit(buildCode ?? 1)

const vite = spawn('pnpm', ['exec', 'vite', '--port', '5173', '--strictPort'], { stdio: 'inherit' })

let ready = false
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const response = await fetch('http://localhost:5173')
    if (response.ok) {
      ready = true
      break
    }
  } catch {
    // 服务还没起来。
  }
  await delay(300)
}
if (!ready) {
  console.error('Vite 开发服务器没有在预期时间内启动。')
  vite.kill('SIGTERM')
  process.exit(1)
}

const electron = spawn('pnpm', ['exec', 'electron', '.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5173' },
})

function shutdown(code = 0) {
  electron.kill('SIGTERM')
  vite.kill('SIGTERM')
  process.exit(code)
}

electron.on('exit', (code) => shutdown(code ?? 0))
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
