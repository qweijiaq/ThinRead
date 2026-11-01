import * as cheerio from 'cheerio'

import { renderMermaidSvg } from './mermaid.js'

export type MermaidSvgRenderer = (source: string) => Promise<string>

/**
 * 把已经由 Markdown 渲染出的 HTML 中的 mermaid 代码块替换成内联 SVG。
 * 单个图表解析或渲染失败时保留原始代码块，导出页仍然可读。
 * 渲染结果不包含外部脚本或 CDN 资源，适合自包含 HTML。
 */
export async function renderMermaidInHtml(
  html: string,
  renderSvg: MermaidSvgRenderer = renderMermaidSvg,
): Promise<string> {
  if (!html.includes('language-mermaid')) return html
  const $ = cheerio.load(html, null, false)
  const blocks = $('pre > code.language-mermaid').toArray()
  let replaced = false
  for (const element of blocks) {
    const code = $(element)
    const pre = code.parent()
    try {
      const svg = await renderSvg(code.text())
      pre.replaceWith(`<div class="mermaid-diagram">${svg}</div>`)
      replaced = true
    } catch {
      // 语法错误或运行环境不支持 DOM 时回退到代码块。
    }
  }
  return replaced ? $.html() : html
}
