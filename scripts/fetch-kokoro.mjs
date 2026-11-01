import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve('resources/kokoro')
const bases = [
  process.env.KOKORO_MODEL_BASE || 'https://hf-mirror.com/onnx-community/Kokoro-82M-v1.1-zh-ONNX/resolve/main',
  'https://huggingface.co/onnx-community/Kokoro-82M-v1.1-zh-ONNX/resolve/main',
]
const files = [
  ['config.json', 10],
  ['tokenizer.json', 100],
  ['tokenizer_config.json', 10],
  ['onnx/model.onnx', 100 * 1024 * 1024],
  ['voices/zf_001.bin', 100 * 1024],
  ['voices/zm_009.bin', 100 * 1024],
]

async function existsReady(file, minBytes) {
  try {
    const stat = await fs.stat(file)
    return stat.size >= minBytes
  } catch {
    return false
  }
}

async function download(file, minBytes) {
  const target = path.join(root, file)
  if (await existsReady(target, minBytes)) {
    console.log(`[kokoro] cached ${file}`)
    return
  }
  await fs.mkdir(path.dirname(target), { recursive: true })
  let lastError = null
  for (const base of bases) {
    try {
      console.log(`[kokoro] downloading ${file}`)
      const response = await fetch(`${base}/${file}`, {
        headers: { 'User-Agent': 'ThinRead-kokoro-fetch' },
        signal: AbortSignal.timeout(15 * 60 * 1000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = Buffer.from(await response.arrayBuffer())
      if (data.length < minBytes) throw new Error(`文件太小（${data.length} bytes）`)
      await fs.writeFile(target, data)
      console.log(`[kokoro] saved ${file} (${Math.round(data.length / 1024 / 1024)} MB)`)
      return
    } catch (error) {
      lastError = error
      console.warn(`[kokoro] ${base} failed: ${error instanceof Error ? error.message : error}`)
    }
  }
  throw lastError ?? new Error(`无法下载 ${file}`)
}

for (const [file, minBytes] of files) {
  await download(file, minBytes)
}
console.log('[kokoro] ready at resources/kokoro')
