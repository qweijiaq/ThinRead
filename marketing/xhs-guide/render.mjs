import { execFileSync } from 'node:child_process'
import path from 'node:path'

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const root = path.dirname(new URL(import.meta.url).pathname)

for (const no of ['01', '02', '03', '04', '05', '06', '07', '08']) {
  execFileSync(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1080,1440',
    '--force-device-scale-factor=1',
    '--virtual-time-budget=2500',
    `--screenshot=${path.join(root, `${no}.png`)}`,
    `file://${path.join(root, `slide-${no}.html`)}`,
  ], { stdio: 'ignore' })
}
console.log('rendered 8 slides at 1080×1440')
