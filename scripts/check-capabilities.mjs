import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const allowed = new Set([
  'browser:capture',
  'reader:quote',
  'notes:write',
  'model:call',
  'network:fetch',
  'ui:panel',
])
const manifestPaths = ['browser-extension/manifest.json'].map((file) => path.join(root, file))
const errors = []
let checked = 0

for (const manifestPath of manifestPaths) {
  if (!fs.existsSync(manifestPath)) {
    errors.push(`缺少 ${path.relative(root, manifestPath)}`)
    continue
  }
  checked++
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    errors.push(`${path.relative(root, manifestPath)} 不是合法 JSON：${error.message}`)
    continue
  }
  const label = path.relative(root, manifestPath)
  const extensionDir = path.dirname(manifestPath)
  const popup = manifest.action?.default_popup
  if (popup && !fs.existsSync(path.join(extensionDir, popup))) {
    errors.push(`${label}: 找不到 action.default_popup ${popup}`)
  }
  const popupScript = path.join(extensionDir, 'popup.js')
  if (fs.existsSync(popupScript)) {
    try {
      new Function(fs.readFileSync(popupScript, 'utf8'))
    } catch (error) {
      errors.push(`${path.relative(root, popupScript)} 语法错误：${error.message}`)
    }
  }
  if (manifest.manifest_version !== 3) errors.push(`${label}: 需要 manifest_version 3`)
  if (!manifest.name || !manifest.version) errors.push(`${label}: 缺少 name 或 version`)
  const capabilities = manifest.thinread?.capabilities
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    errors.push(`${label}: 缺少 thinread.capabilities`)
  } else {
    for (const capability of capabilities) {
      if (!allowed.has(capability)) errors.push(`${label}: 未声明的能力 ${capability}`)
    }
    if (capabilities.includes('browser:capture')) {
      const permissions = new Set(manifest.permissions ?? [])
      if (!permissions.has('activeTab')) errors.push(`${label}: browser:capture 需要 activeTab`)
      if (!permissions.has('scripting')) errors.push(`${label}: browser:capture 需要 scripting`)
      const hosts = manifest.host_permissions ?? []
      if (hosts.includes('<all_urls>')) errors.push(`${label}: browser:capture 不应申请 <all_urls>`)
    }
  }
}

if (errors.length > 0) {
  console.error('[check:capabilities] 失败')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log(`[check:capabilities] PASSED · ${checked} 个扩展`)
