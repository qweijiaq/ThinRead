import type { HLJSApi } from 'highlight.js'

export interface HighlightedCode {
  html: string
  language: string | null
}

const LANGUAGE_IDS: Record<string, string> = {
  TypeScript: 'typescript',
  TSX: 'typescript',
  JavaScript: 'javascript',
  JSX: 'javascript',
  Python: 'python',
  Shell: 'bash',
  JSON: 'json',
  HTML: 'xml',
  XML: 'xml',
  SVG: 'xml',
  CSS: 'css',
  SCSS: 'scss',
  Less: 'less',
  SQL: 'sql',
  YAML: 'yaml',
  TOML: 'ini',
  INI: 'ini',
  Markdown: 'markdown',
  Go: 'go',
  Rust: 'rust',
  Java: 'java',
  Kotlin: 'kotlin',
  Swift: 'swift',
  C: 'c',
  'C++': 'cpp',
  'C#': 'csharp',
  Ruby: 'ruby',
  PHP: 'php',
  Dockerfile: 'dockerfile',
  Diff: 'diff',
  GraphQL: 'graphql',
  Text: 'plaintext',
}

let hljsPromise: Promise<HLJSApi> | null = null

function loadHighlighter(): Promise<HLJSApi> {
  if (!hljsPromise) {
    hljsPromise = Promise.all([
      import('highlight.js/lib/common'),
      import('highlight.js/lib/languages/dockerfile'),
    ]).then(([common, dockerfile]) => {
      const highlighter = common.default
      highlighter.registerLanguage('dockerfile', dockerfile.default)
      return highlighter
    })
  }
  return hljsPromise
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 懒加载 highlight.js；显式语言优先，识别不出来时再做一次受限的自动识别。
 * 自动识别只用于着色，不用于显示语言标签（标签仍由 code-language 决定）。
 */
export async function highlightCode(
  code: string,
  languageLabel?: string | null,
): Promise<HighlightedCode> {
  if (!code.trim()) return { html: escapeHtml(code), language: null }
  const hljs = await loadHighlighter()
  const explicit = languageLabel ? LANGUAGE_IDS[languageLabel] : null
  try {
    if (explicit && hljs.getLanguage(explicit)) {
      const result = hljs.highlight(code, { language: explicit, ignoreIllegals: true })
      return { html: result.value, language: explicit }
    }
    if (code.length > 12_000) {
      const result = hljs.highlight(code, { language: 'plaintext' })
      return { html: result.value, language: 'plaintext' }
    }
    const result = hljs.highlightAuto(code)
    return { html: result.value, language: result.language ?? null }
  } catch {
    return { html: escapeHtml(code), language: null }
  }
}
