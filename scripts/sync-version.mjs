import fs from 'node:fs'

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
const dmg = `ThinRead-${version}-mac-arm64.dmg`

const edits = [
  {
    file: 'website/index.html',
    apply: (text) =>
      text
        .replace(/ThinRead-\d+\.\d+\.\d+-mac-arm64\.dmg/g, dmg)
        .replace(/BETA \d+\.\d+\.\d+/g, `BETA ${version}`)
        .replace(/(<span id="releaseLabel">)v\d+\.\d+\.\d+/g, `$1v${version}`)
        .replace(
          /(<div class="stat-row"><strong>)v\d+\.\d+\.\d+(<\/strong><span>当前版本)/g,
          `$1v${version}$2`,
        ),
  },
  {
    file: 'website/app.js',
    apply: (text) => text.replace(/ThinRead-\d+\.\d+\.\d+-mac-arm64\.dmg/g, dmg),
  },
  {
    file: 'electron/ai/client-identity.ts',
    apply: (text) => text.replace(/ThinRead\/\d+\.\d+\.\d+/, `ThinRead/${version}`),
  },
]

for (const { file, apply } of edits) {
  const before = fs.readFileSync(file, 'utf8')
  const after = apply(before)
  if (after !== before) {
    fs.writeFileSync(file, after)
    console.log(`[sync-version] ${file} -> ${version}`)
  }
}

const site = fs.readFileSync('website/index.html', 'utf8')
const app = fs.readFileSync('website/app.js', 'utf8')
const identity = fs.readFileSync('electron/ai/client-identity.ts', 'utf8')
if (!site.includes(dmg) || !app.includes(dmg) || !identity.includes(`ThinRead/${version}`)) {
  console.error(`[sync-version] ${version} 的下载链接或版本号未完全同步`)
  process.exit(1)
}
console.log(`[sync-version] PASSED ${version}`)
