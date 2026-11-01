import * as cheerio from 'cheerio'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Markdown } from '../components/Markdown.js'
import { renderMermaidInHtml } from './mermaid-html.js'

export interface BookBlogArgs {
  bookTitle: string
  author: string
  markdown: string
  date: string
  description?: string
  /** 发布包内用 cover.png；单独导出时可以直接传 data URL。 */
  coverSrc?: string
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function bookDescription(markdown: string, length = 150): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, length)
}

function withAnchors(body: string): { article: string; toc: Array<{ id: string; text: string; level: number }> } {
  const $ = cheerio.load(body, null, false)
  const toc: Array<{ id: string; text: string; level: number }> = []
  $('h2, h3').each((index, element) => {
    const node = $(element)
    const id = `section-${index + 1}`
    const text = node.text().replace(/\s+/g, ' ').trim()
    if (!text) return
    node.attr('id', id)
    toc.push({ id, text, level: Number(node.prop('tagName')?.slice(1)) || 2 })
  })
  return { article: $.html(), toc }
}

/**
 * 生成一个不依赖外部资源的博客分享页，直接把文件丢到静态托管就能看。
 * Mermaid 图表在导出前渲染成内联 SVG；单个图表失败时保留原始代码块。
 */
export async function buildBookBlogHtml(args: BookBlogArgs): Promise<string> {
  const rendered = withAnchors(renderToStaticMarkup(createElement(Markdown, { text: args.markdown })))
  const body = await renderMermaidInHtml(rendered.article)
  const title = escapeHtml(args.bookTitle)
  const author = escapeHtml(args.author || '')
  const description = escapeHtml(args.description?.trim() || bookDescription(args.markdown))
  const readingMinutes = Math.max(1, Math.round(args.markdown.replace(/\s+/g, '').length / 420))
  const coverSrc = args.coverSrc?.trim() ?? ''
  const coverHtml = coverSrc
    ? `<figure class="publish-cover"><img src="${escapeHtml(coverSrc)}" alt="${title} 封面" /></figure>`
    : ''
  const coverMeta = coverSrc && !coverSrc.startsWith('data:')
    ? `<meta property="og:image" content="${escapeHtml(coverSrc)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">`
    : ''
  const toc = rendered.toc.length >= 2
    ? `<nav class="toc" aria-label="本文目录">
    <strong>本文目录</strong>
    <ol>${rendered.toc.map((item) => `<li class="toc-level-${item.level}"><a href="#${item.id}">${escapeHtml(item.text)}</a></li>`).join('')}</ol>
  </nav>`
    : ''
  const articleLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: args.bookTitle,
    description,
    author: args.author ? { '@type': 'Person', name: args.author } : undefined,
    datePublished: args.date,
    inLanguage: 'zh-CN',
    publisher: { '@type': 'Organization', name: '页边 ThinRead' },
    ...(coverSrc && !coverSrc.startsWith('data:') ? { image: coverSrc } : {}),
  }).replace(/</g, '\u003c')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${description}">
<meta name="author" content="${author}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title} · 读书笔记">
<meta property="og:description" content="${description}">
<meta property="og:site_name" content="页边 ThinRead">
${coverMeta}
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${title} · 读书笔记">
<meta name="twitter:description" content="${description}">
<script type="application/ld+json">${articleLd}</script>
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
  overflow-x: hidden;
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
  overflow-x: visible;
  padding: 18px 20px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  border-radius: 10px;
  background: #2b2720;
  color: #f6f1e7;
}
article pre code { padding: 0; background: none; }
article .mermaid-diagram {
  margin: 1.4em 0;
  padding: 16px;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--sheet);
}
article .mermaid-diagram svg {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}
article table {
  width: 100%;
  max-width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  margin: 1.4em 0;
  font-size: 0.92em;
}
article th,
article td {
  padding: 7px 9px;
  border: 1px solid var(--line);
  text-align: left;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.toc {
  margin: 0 0 28px;
  padding: 20px 24px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255, 253, 248, 0.7);
  font-family: "PingFang SC", "Noto Sans CJK SC", sans-serif;
}
.toc strong { display: block; margin-bottom: 10px; font-size: 13px; letter-spacing: 0.04em; }
.toc ol { margin: 0; padding-left: 1.3em; }
.toc li { margin: 0.34em 0; font-size: 13px; }
.toc li.toc-level-3 { margin-left: 1.1em; color: var(--muted); }
.toc a { color: var(--ink-soft); text-decoration: none; }
.toc a:hover { color: var(--accent); }
article h2, article h3 { scroll-margin-top: 24px; }
.publish-cover {
  margin: 0 0 34px;
}
.publish-cover img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 20px 56px rgba(43, 39, 32, 0.12);
}
article img { max-width: 100%; height: auto; }
article a { overflow-wrap: anywhere; }
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
  article .mermaid-diagram { overflow: visible; border: 0; padding: 0; }
}
</style>
</head>
<body>
<div class="page">
  ${coverHtml}
  <header class="cover">
    <div class="kicker">页边 · 读书笔记</div>
    <h1>${title}</h1>
    <div class="meta">${author ? `${author} · ` : ''}${escapeHtml(args.date)} · 约 ${readingMinutes} 分钟</div>
  </header>
  ${toc}
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

export function bookPdfFilename(bookTitle: string): string {
  return bookHtmlFilename(bookTitle).replace(/\.html$/i, '.pdf')
}
