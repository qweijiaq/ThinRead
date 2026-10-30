import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Markdown } from '../components/Markdown.js'

export interface BookBlogArgs {
  bookTitle: string
  author: string
  markdown: string
  date: string
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 生成一个不依赖外部资源的博客分享页，直接把文件丢到静态托管就能看。 */
export function buildBookBlogHtml(args: BookBlogArgs): string {
  const body = renderToStaticMarkup(createElement(Markdown, { text: args.markdown }))
  const title = escapeHtml(args.bookTitle)
  const author = escapeHtml(args.author || '')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · 读书笔记</title>
<style>
:root {
  --paper: #f7f3ea;
  --sheet: #fffdf8;
  --ink: #2b2720;
  --ink-soft: #4b443a;
  --muted: #847967;
  --line: #e4dccd;
  --accent: #a84a2b;
}
* { box-sizing: border-box; }
html { background: var(--paper); }
body {
  margin: 0;
  color: var(--ink);
  background:
    radial-gradient(circle at 20% 0%, rgba(168, 74, 43, 0.05), transparent 32rem),
    var(--paper);
  font-family: "Songti SC", "STSong", "Noto Serif CJK SC", "SimSun", Georgia, serif;
  font-size: 18px;
  line-height: 1.95;
  text-rendering: optimizeLegibility;
}
.page {
  width: min(760px, calc(100% - 40px));
  margin: 0 auto;
  padding: 72px 0 96px;
}
.cover {
  padding-bottom: 34px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 46px;
}
.kicker {
  color: var(--accent);
  font-family: "PingFang SC", "Noto Sans CJK SC", sans-serif;
  font-size: 12px;
  letter-spacing: 0.18em;
}
.cover h1 {
  margin: 16px 0 10px;
  font-size: clamp(34px, 6vw, 54px);
  line-height: 1.28;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.cover .meta {
  color: var(--muted);
  font-family: "PingFang SC", "Noto Sans CJK SC", sans-serif;
  font-size: 13px;
}
article {
  background: var(--sheet);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: clamp(26px, 5vw, 64px);
  box-shadow: 0 24px 70px rgba(43, 39, 32, 0.07);
}
article h1 { display: none; }
article h2 {
  margin: 2.2em 0 0.8em;
  padding-top: 0.2em;
  font-size: 1.6em;
  line-height: 1.35;
  font-weight: 600;
}
article h3 {
  margin: 1.8em 0 0.6em;
  font-size: 1.22em;
  line-height: 1.4;
  font-weight: 600;
}
article p { margin: 0 0 1.05em; }
article strong { font-weight: 700; }
article em { color: var(--accent); font-style: normal; }
article blockquote {
  margin: 1.5em 0;
  padding: 0.5em 0 0.5em 1.3em;
  border-left: 3px solid var(--accent);
  color: var(--ink-soft);
  font-size: 1.08em;
}
article blockquote p:last-child { margin-bottom: 0; }
article ul, article ol { margin: 0 0 1.1em; padding-left: 1.4em; }
article li { margin: 0.35em 0; }
article li::marker { color: var(--accent); }
article a { color: var(--accent); text-underline-offset: 3px; }
article code {
  padding: 0.12em 0.35em;
  border-radius: 5px;
  background: #f1eadc;
  font-family: "SFMono-Regular", ui-monospace, monospace;
  font-size: 0.86em;
}
article pre {
  overflow-x: auto;
  padding: 18px 20px;
  border-radius: 10px;
  background: #2b2720;
  color: #f6f1e7;
}
article pre code { padding: 0; background: none; }
article hr { margin: 2.6em 0; border: 0; border-top: 1px solid var(--line); }
footer {
  margin-top: 40px;
  color: var(--muted);
  font-family: "PingFang SC", "Noto Sans CJK SC", sans-serif;
  font-size: 12px;
  text-align: center;
}
@media (max-width: 560px) {
  body { font-size: 17px; line-height: 1.9; }
  .page { width: calc(100% - 24px); padding-top: 36px; }
  article { padding: 24px 20px; border-radius: 12px; }
}
@media print {
  html, body { background: #fff; }
  .page { width: auto; padding: 0; }
  article { border: 0; box-shadow: none; padding: 0; }
  .cover { margin-bottom: 28px; }
}
</style>
</head>
<body>
<div class="page">
  <header class="cover">
    <div class="kicker">页边 · 读书笔记</div>
    <h1>${title}</h1>
    <div class="meta">${author ? `${author} · ` : ''}${escapeHtml(args.date)}</div>
  </header>
  <article>${body}</article>
  <footer>由页边 ThinRead 整理 · 书和笔记都留在本机</footer>
</div>
</body>
</html>
`
}

export function bookHtmlFilename(bookTitle: string): string {
  const base = `${bookTitle} 读书笔记`.replace(/[\\/:*?"<>|#%{}]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return `${base || 'reading-note'}.html`
}
