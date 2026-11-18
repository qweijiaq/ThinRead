import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const chrome = process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const profile = mkdtempSync(join(tmpdir(), 'thinread-xhs-'))

const shoot = (file, out, width, height) => {
  const target = join(root, out)
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    spawnSync(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--force-device-scale-factor=1',
      '--virtual-time-budget=4000',
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      `--screenshot=${target}`,
      pathToFileURL(join(root, file)).href,
    ], { stdio: 'ignore' })
    if (existsSync(target) && statSync(target).size > 10000) {
      console.log(`rendered ${out}`)
      return
    }
  }
  throw new Error(`failed to render ${out}`)
}

const slides = readdirSync(root)
  .filter((name) => /^slide-\d+\.html$/.test(name))
  .sort()

for (const file of slides) {
  const index = file.match(/^slide-(\d+)\.html$/)[1]
  shoot(file, `${index}.png`, 1080, 1440)
}

shoot('preview.html', 'preview.png', 2160, 1440)
