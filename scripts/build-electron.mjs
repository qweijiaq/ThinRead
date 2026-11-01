import { build } from 'esbuild'

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  external: ['electron', 'pdfjs-dist', 'pdfjs-dist/*', '@huggingface/transformers', 'onnxruntime-node', 'node-edge-tts', '@uzen/kokoro-js'],
}

await build({
  ...shared,
  entryPoints: ['electron/main.ts'],
  outfile: 'dist-electron/main.cjs',
  format: 'cjs',
})

await build({
  ...shared,
  entryPoints: ['electron/preload.ts'],
  outfile: 'dist-electron/preload.cjs',
  format: 'cjs',
})
