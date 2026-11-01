import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

import { createCanvas, loadImage } from '@napi-rs/canvas'
import electronPath from 'electron'

const ROOT = process.cwd()
const STATIC = path.join(ROOT, 'storybook-static')
const OUT = path.join(ROOT, 'storybook-screenshots')
const CURRENT = path.join(ROOT, 'storybook-screenshots-current')
const STORIES = [
  '分享-sharecardpreview--quote-paper',
  '分享-sharecardpreview--knowledge-ink',
  '分享-sharedialog--deck',
  '阅读-reader--folio-serif',
  '书架-library--shelf',
  '笔记-notecard--point-with-quote',
  '地图-knowledgemap--default',
  '地图-labrelationgraph--default',
  '小红书-xhscarouseldialog--default',
  '听读-listenpanel--edge',
]
const CHECK = process.argv.includes('--check')
// 允许 0.5% 的像素有轻微抗锯齿差异，布局或文案变化会明显超过这个比例。
const MAX_DIFF_RATIO = 0.005
const PIXEL_TOLERANCE = 16

async function comparePng(baselineFile, currentFile) {
  const [baseline, current] = await Promise.all([
    loadImage(await fsp.readFile(baselineFile)),
    loadImage(await fsp.readFile(currentFile)),
  ])
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return { ratio: 1, maxDelta: 255, sizeChanged: true }
  }
  const draw = (image) => {
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return context.getImageData(0, 0, image.width, image.height).data
  }
  const before = draw(baseline)
  const after = draw(current)
  let changed = 0
  let maxDelta = 0
  for (let index = 0; index < before.length; index += 4) {
    const delta = Math.max(
      Math.abs(before[index] - after[index]),
      Math.abs(before[index + 1] - after[index + 1]),
      Math.abs(before[index + 2] - after[index + 2]),
    )
    if (delta > PIXEL_TOLERANCE) changed++
    if (delta > maxDelta) maxDelta = delta
  }
  return { ratio: changed / (baseline.width * baseline.height), maxDelta, sizeChanged: false }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
}

if (!fs.existsSync(path.join(STATIC, 'index.json'))) {
  console.error('找不到 storybook-static，请先运行 pnpm build-storybook。')
  process.exit(1)
}

const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname)
  const file = path.resolve(STATIC, `.${pathname}`)
  if (!file.startsWith(STATIC)) {
    response.writeHead(403)
    response.end()
    return
  }
  const body = await fsp.readFile(file).catch(() => null)
  if (!body) {
    response.writeHead(404)
    response.end()
    return
  }
  response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
  response.end(body)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const port = typeof address === 'object' && address ? address.port : 0
const url = `http://127.0.0.1:${port}`

const outputDir = CHECK ? CURRENT : OUT
if (CHECK) {
  const missing = STORIES.filter((story) => !fs.existsSync(path.join(OUT, `${story}.png`)))
  if (missing.length > 0) {
    console.error('[storybook-capture] 缺少截图基线，请先运行 pnpm capture:storybook。')
    for (const story of missing) console.error(`  缺失：${story}`)
    process.exit(1)
  }
  await fsp.rm(CURRENT, { recursive: true, force: true })
}

const child = spawn(electronPath, ['--force-device-scale-factor=1', path.join(ROOT, 'scripts', 'storybook-capture-main.cjs')], {
  cwd: ROOT,
  env: { ...process.env, SB_URL: url, SB_OUT: outputDir, SB_STORIES: JSON.stringify(STORIES) },
  stdio: 'inherit',
})
const code = await new Promise((resolve) => child.on('exit', (exitCode) => resolve(exitCode ?? 1)))
server.close()
if (code !== 0) process.exit(code)

if (CHECK) {
  let changed = 0
  for (const story of STORIES) {
    const result = await comparePng(path.join(OUT, `${story}.png`), path.join(CURRENT, `${story}.png`))
    if (result.sizeChanged || result.ratio > MAX_DIFF_RATIO) {
      console.error(
        `[storybook-capture] changed: ${story} (${(result.ratio * 100).toFixed(2)}% 像素不同，最大色差 ${result.maxDelta})`,
      )
      changed++
    }
  }
  if (changed > 0) {
    console.error(`[storybook-capture] ${changed} 张截图超出差异阈值；本次截图保留在 ${CURRENT}`)
    process.exit(1)
  }
  await fsp.rm(CURRENT, { recursive: true, force: true })
  console.log(`[storybook-capture] ${STORIES.length} 张截图与基线一致`)
} else {
  console.log(`[storybook-capture] screenshots written to ${OUT}`)
}

