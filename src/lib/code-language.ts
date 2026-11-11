/** 轻量代码语言识别：只负责显示标签，不做语法高亮。识别不出来就返回 null。 */

const ALIASES: Record<string, string> = {
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JSX',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  python: 'Python',
  sh: 'Shell',
  bash: 'Shell',
  shell: 'Shell',
  zsh: 'Shell',
  console: 'Shell',
  json: 'JSON',
  jsonc: 'JSON',
  html: 'HTML',
  htm: 'HTML',
  xml: 'XML',
  svg: 'SVG',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  sql: 'SQL',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  ini: 'INI',
  md: 'Markdown',
  markdown: 'Markdown',
  go: 'Go',
  rust: 'Rust',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  kotlin: 'Kotlin',
  swift: 'Swift',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  'c++': 'C++',
  cxx: 'C++',
  cs: 'C#',
  csharp: 'C#',
  rb: 'Ruby',
  ruby: 'Ruby',
  php: 'PHP',
  r: 'R',
  docker: 'Dockerfile',
  dockerfile: 'Dockerfile',
  diff: 'Diff',
  patch: 'Diff',
  graphql: 'GraphQL',
  gql: 'GraphQL',
  txt: 'Text',
  text: 'Text',
  plaintext: 'Text',
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/^language-/, '').replace(/^lang-/, '')
}

export function languageFromClassName(className?: string | null): string | null {
  if (!className) return null
  for (const token of className.split(/\s+/)) {
    const key = normalize(token)
    const label = ALIASES[key]
    if (label) return label
  }
  return null
}

function looksLikeJson(code: string): boolean {
  const trimmed = code.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function looksLikeHtml(code: string): boolean {
  const trimmed = code.trim()
  if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return true
  const tags = trimmed.match(/<\/?[a-z][\w:-]*(?:\s[^>]*)?>/gi) ?? []
  return tags.length >= 3 && /<\/(div|p|span|body|head|section|article|ul|table|a)>/i.test(trimmed)
}

function looksLikeCss(code: string): boolean {
  const trimmed = code.trim()
  if (!/[{}]/.test(trimmed)) return false
  if (/\b(function|const|let|var|=>|class\s+\w+\s*\{)\b/.test(trimmed)) return false
  return (
    /(^|\n)\s*[.#]?[a-z][\w-]*(?:\s+[.#]?[a-z][\w-]*)*\s*[{,]/.test(trimmed) &&
    /[a-z-]+\s*:\s*[^;{\n]+;/.test(trimmed)
  )
}

function looksLikeSql(code: string): boolean {
  return /\b(select|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+(table|index|view)|alter\s+table)\b/i.test(
    code,
  )
}

function looksLikeYaml(code: string): boolean {
  const lines = code
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
  if (lines.length < 2) return false
  const keyed = lines.filter((line) => /^[\w.-]+\s*:\s*(\S.*)?$/.test(line)).length
  const listed = lines.filter((line) => /^\s*-\s+\S/.test(line)).length
  return (keyed >= 2 || (keyed >= 1 && listed >= 1)) && !/[{};]/.test(code)
}

function looksLikePython(code: string): boolean {
  return (
    /^\s*(def|class)\s+\w+.*:/m.test(code) ||
    /^\s*(from\s+[\w.]+\s+import|import\s+[\w.]+)/m.test(code) ||
    /^\s*(if|for|while|try|with)\s+.*:\s*$/m.test(code)
  )
}

function looksLikeJavaScript(code: string): boolean {
  return (
    /^\s*(const|let|var)\s+[\w{[]/m.test(code) ||
    /^\s*(export\s+)?(async\s+)?function\s+\w+/m.test(code) ||
    /^\s*export\s+(const|let|var|class|interface|type)\s+/m.test(code) ||
    /=>/.test(code) ||
    /^\s*(import|export)\s+.*\bfrom\b/m.test(code) ||
    /^\s*(interface|type)\s+\w+/m.test(code)
  )
}

function looksLikeShell(code: string): boolean {
  return (
    /^#!\/(usr\/bin\/env\s+)?(ba|z|fi)?sh/m.test(code) ||
    /^\s*(npm|pnpm|yarn|git|cd|ls|mkdir|curl|brew|docker|kubectl)\s+/m.test(code) ||
    /^\s*\$\s+\S/m.test(code)
  )
}

function looksLikeGo(code: string): boolean {
  return /^\s*package\s+\w+/m.test(code) && /\bfunc\s+\w+/.test(code)
}

function looksLikeRust(code: string): boolean {
  return /^\s*fn\s+\w+/m.test(code) || /\blet\s+mut\s+/.test(code) || /^\s*use\s+[\w:]+;/m.test(code)
}

function looksLikeJvm(code: string): boolean {
  return (
    /^\s*(public\s+)?(class|interface|enum)\s+\w+/m.test(code) &&
    /\b(public|private|protected|static|void)\b/.test(code)
  )
}

function looksLikeKotlin(code: string): boolean {
  return /^\s*fun\s+\w+/m.test(code) || /^\s*(data\s+)?class\s+\w+/m.test(code)
}

function looksLikeSwift(code: string): boolean {
  return /^\s*(func|struct|class|enum)\s+\w+/m.test(code) && /\b(let|var)\s+\w+/.test(code)
}

function looksLikeDiff(code: string): boolean {
  return /^(diff --git|\+\+\+ |--- |@@ )/m.test(code)
}

function looksLikeDocker(code: string): boolean {
  return /^\s*(FROM|RUN|COPY|WORKDIR|ENV|CMD|ENTRYPOINT)\s+/m.test(code)
}

export function detectCodeLanguage(code: string, className?: string | null): string | null {
  const explicit = languageFromClassName(className)
  if (explicit) return explicit
  const trimmed = code.trim()
  if (trimmed.length < 12) return null

  if (looksLikeJson(trimmed)) return 'JSON'
  if (looksLikeDiff(trimmed)) return 'Diff'
  if (looksLikeDocker(trimmed)) return 'Dockerfile'
  if (looksLikeHtml(trimmed)) {
    return /^<\?xml/i.test(trimmed) || /^<svg[\s>]/i.test(trimmed) ? 'XML' : 'HTML'
  }
  if (looksLikeSql(trimmed)) return 'SQL'
  if (looksLikeCss(trimmed)) return 'CSS'
  if (looksLikeYaml(trimmed)) return 'YAML'
  if (looksLikePython(trimmed)) return 'Python'
  if (looksLikeGo(trimmed)) return 'Go'
  if (looksLikeRust(trimmed)) return 'Rust'
  if (looksLikeKotlin(trimmed)) return 'Kotlin'
  if (looksLikeSwift(trimmed)) return 'Swift'
  if (looksLikeJvm(trimmed)) return 'Java'
  if (looksLikeShell(trimmed)) return 'Shell'
  if (looksLikeJavaScript(trimmed)) return 'JavaScript'
  return null
}

/** 长代码默认折叠；短代码保持展开。 */
export function shouldCollapseCode(code: string): boolean {
  const lines = code.split('\n').length
  return lines > 18 || code.length > 1_200
}
