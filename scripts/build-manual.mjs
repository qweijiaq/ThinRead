import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const markedPath = path.join(process.cwd(), 'node_modules/.pnpm/marked@16.4.2/node_modules/marked/lib/marked.esm.js')
const { marked } = await import(pathToFileURL(markedPath).href)

const source = fs.readFileSync('docs/user-manual.md', 'utf8')
let body = marked.parse(source, { gfm: true, breaks: false })
body = body.replace(/<h([2-4])>(.*?)<\/h\1>/g, (_match, depth, text) => {
  const plain = String(text).replace(/<[^>]+>/g, '')
  const id = plain
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\- ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
  return `<h${depth} id="${id}">${text}</h${depth}>`
})

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>页边 ThinRead 用户手册</title>
<style>
  :root {
    --paper: #f6f3ec;
    --sheet: #fffdf8;
    --ink: #1b1915;
    --muted: #6a6358;
    --faint: #9a9284;
    --line: #ddd4c4;
    --accent: #b23a2e;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif;
    font-size: 15px;
    line-height: 1.85;
  }
  .page {
    max-width: 880px;
    margin: 0 auto;
    padding: 56px 64px 80px;
    background: var(--sheet);
  }
  h1 {
    margin: 0 0 10px;
    font-family: "Songti SC", "STSong", "Noto Serif CJK SC", Georgia, serif;
    font-size: 38px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }
  h2 {
    margin: 56px 0 16px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
    font-family: "Songti SC", "STSong", "Noto Serif CJK SC", Georgia, serif;
    font-size: 25px;
    font-weight: 600;
    line-height: 1.3;
  }
  h3 {
    margin: 30px 0 8px;
    font-size: 18px;
    font-weight: 600;
    line-height: 1.45;
  }
  h4 { margin: 22px 0 6px; font-size: 16px; }
  p { margin: 9px 0; }
  a { color: var(--accent); text-decoration: none; border-bottom: 1px solid rgba(178, 58, 46, .3); }
  blockquote {
    margin: 18px 0 28px;
    padding: 12px 18px;
    border-left: 3px solid var(--accent);
    color: var(--muted);
    background: #faf6ee;
  }
  blockquote p { margin: 2px 0; }
  ul, ol { padding-left: 1.4em; margin: 10px 0; }
  li { margin: 3px 0; }
  strong { font-weight: 600; }
  code {
    padding: 2px 5px;
    border-radius: 4px;
    background: #f1ebdf;
    font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, monospace;
    font-size: 0.88em;
  }
  pre {
    padding: 14px 16px;
    overflow-x: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: #faf6ee;
  }
  pre code { padding: 0; background: transparent; font-size: 12.5px; line-height: 1.65; }
  table {
    width: 100%;
    margin: 16px 0 22px;
    border-collapse: collapse;
    font-size: 13px;
    line-height: 1.65;
  }
  th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
  th { background: #f5eee2; font-weight: 600; }
  img {
    display: block;
    width: 100%;
    height: auto;
    margin: 18px 0 28px;
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: 0 12px 28px rgba(30, 26, 20, .10);
  }
  hr { margin: 40px 0; border: 0; border-top: 1px solid var(--line); }
  .print-note { display: none; }

  @page { size: A4; margin: 16mm 16mm 18mm; }
  @media print {
    html, body { background: #fff; }
    .page { max-width: none; padding: 0; background: #fff; }
    body { font-size: 10.5pt; line-height: 1.8; }
    h1 { font-size: 28pt; }
    h2 { font-size: 17pt; page-break-before: always; }
    h2:first-of-type { page-break-before: auto; }
    h3 { font-size: 12.5pt; page-break-after: avoid; }
    p, li { orphans: 2; widows: 2; }
    table, pre, img, blockquote { page-break-inside: avoid; }
    img { box-shadow: none; border-radius: 4px; }
    a { color: inherit; border: 0; }
    .print-note { display: block; margin-top: 24px; color: #777; font-size: 9pt; }
  }
</style>
</head>
<body>
<main class="page">
${body}
<p class="print-note">页边 ThinRead 用户手册 · 小范围内测版本 · 未签名、未公证</p>
</main>
</body>
</html>
`

// 同步一份给渲染层内嵌：图片改成 public/manual 下的相对路径。
fs.mkdirSync('src/assets', { recursive: true })
fs.mkdirSync('public/manual', { recursive: true })
const embedded = source
  .replace(/\n## 目录\n[\s\S]*?(?=\n## )/, '\n')
  .replace(/\]\(features\//g, '](manual/')
fs.writeFileSync('src/assets/user-manual.md', embedded)
for (const name of fs.readdirSync('docs/features')) {
  if (!name.endsWith('.png')) continue
  fs.copyFileSync(path.join('docs/features', name), path.join('public/manual', name))
}

fs.writeFileSync('docs/user-manual.html', html)
console.log('wrote docs/user-manual.html')

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const pdf = spawnSync(chrome, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--no-pdf-header-footer',
  `--print-to-pdf=${path.join(process.cwd(), 'docs/user-manual.pdf')}`,
  pathToFileURL(path.join(process.cwd(), 'docs/user-manual.html')).href,
], { stdio: 'ignore' })
if (pdf.status === 0) console.log('wrote docs/user-manual.pdf')
else console.warn('PDF skipped: Chrome not available or print failed')
