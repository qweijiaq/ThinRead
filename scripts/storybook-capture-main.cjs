const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const url = process.env.SB_URL
const out = process.env.SB_OUT
const stories = JSON.parse(process.env.SB_STORIES || '[]')

async function main() {
  const window = new BrowserWindow({
    width: 1440,
    height: 1000,
    useContentSize: true,
    enableLargerThanScreen: true,
    show: false,
    backgroundColor: '#f4efe5',
    webPreferences: { offscreen: false },
  })
  window.setContentSize(1440, 1000)
  fs.mkdirSync(out, { recursive: true })
  const manifest = {}
  for (const story of stories) {
    await window.loadURL(`${url}/iframe.html?id=${encodeURIComponent(story)}&viewMode=story`)
    await new Promise((resolve) => setTimeout(resolve, 1400))
    const image = await window.webContents.capturePage()
    const file = path.join(out, `${story}.png`)
    const buffer = image.toPNG()
    fs.writeFileSync(file, buffer)
    manifest[story] = require('node:crypto').createHash('sha256').update(buffer).digest('hex')
    console.log(`[storybook-capture] ${story} ${buffer.length}`)
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  app.quit()
}

app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
