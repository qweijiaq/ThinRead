import type { MermaidConfig } from 'mermaid'

type MermaidInstance = (typeof import('mermaid'))['default']

/** 纸色主题兜底值；导出页和没有 DOM 的环境都按这套配色渲染。 */
const PAPER_THEME: Record<string, string> = {
  background: '#fbf8f1',
  primaryColor: '#ede6d8',
  primaryTextColor: '#2b2720',
  primaryBorderColor: '#d2c5af',
  secondaryColor: '#f4efe5',
  tertiaryColor: '#fbf8f1',
  lineColor: '#847967',
  textColor: '#2b2720',
  mainBkg: '#ede6d8',
  nodeBorder: '#d2c5af',
  clusterBkg: '#fbf8f1',
  clusterBorder: '#d2c5af',
  edgeLabelBackground: '#fbf8f1',
  titleColor: '#2b2720',
  fontFamily: '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
  fontSize: '14px',
}

/**
 * 从当前主题的 CSS 变量里取纸色和墨色，让图表和阅读界面保持一致。
 * Mermaid 的 themeVariables 是 any，这里只传会用到的键，缺省时回落到纸色主题。
 */
function currentThemeVariables(): Record<string, string> {
  if (typeof document === 'undefined') return { ...PAPER_THEME }
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback
  const paper = read('--paper', '#f4efe5')
  const paper2 = read('--paper-2', '#fbf8f1')
  const paper3 = read('--paper-3', '#ede6d8')
  const ink = read('--ink', '#2b2720')
  const inkSoft = read('--ink-soft', '#4b443a')
  const muted = read('--muted', '#847967')
  const line = read('--line-strong', '#d2c5af')
  const accent = read('--accent', '#a84a2b')
  return {
    ...PAPER_THEME,
    background: paper2,
    primaryColor: paper3,
    primaryTextColor: ink,
    primaryBorderColor: line,
    secondaryColor: paper,
    tertiaryColor: paper2,
    lineColor: muted,
    textColor: ink,
    mainBkg: paper3,
    nodeBorder: line,
    clusterBkg: paper2,
    clusterBorder: line,
    edgeLabelBackground: paper2,
    titleColor: ink,
    // sequenceDiagram
    actorBkg: paper2,
    actorBorder: line,
    actorTextColor: ink,
    actorLineColor: muted,
    signalColor: inkSoft,
    signalTextColor: ink,
    labelBoxBkgColor: paper3,
    labelBoxBorderColor: line,
    labelTextColor: ink,
    loopTextColor: ink,
    noteBkgColor: paper3,
    noteTextColor: ink,
    noteBorderColor: line,
    // gantt / pie / quadrantChart
    sectionBkgColor: paper3,
    altSectionBkgColor: paper2,
    sectionBkgColor2: paper,
    taskBkgColor: accent,
    taskTextColor: '#fffdf9',
    gridColor: line,
    pie1: accent,
    pie2: read('--ai', '#3d6e5d'),
    pie3: read('--warn', '#a4772a'),
    pieStrokeColor: paper2,
    pieOuterStrokeColor: line,
    quadrant1Fill: paper3,
    quadrant2Fill: paper2,
    quadrant3Fill: paper,
    quadrant4Fill: paper2,
    quadrant1TextFill: ink,
    quadrant2TextFill: ink,
    quadrant3TextFill: ink,
    quadrant4TextFill: ink,
    quadrantPointFill: accent,
    quadrantPointTextFill: ink,
    quadrantXAxisTextFill: inkSoft,
    quadrantYAxisTextFill: inkSoft,
    quadrantInternalBorderStrokeFill: line,
    quadrantExternalBorderStrokeFill: line,
    fontFamily: PAPER_THEME.fontFamily,
    fontSize: PAPER_THEME.fontSize,
  }
}

let loader: Promise<MermaidInstance> | null = null
let sequence = 0

function loadMermaid(): Promise<MermaidInstance> {
  if (!loader) loader = import('mermaid').then((module) => module.default)
  return loader
}

function mermaidConfig(): MermaidConfig {
  return {
    startOnLoad: false,
    // 导出页会把 SVG 内联进 HTML；strict 会清理标签和链接，避免把脚本带出应用。
    securityLevel: 'strict',
    theme: 'base',
    htmlLabels: false,
    fontFamily: PAPER_THEME.fontFamily,
    themeVariables: currentThemeVariables(),
  }
}

/** 把一段 Mermaid 语法渲染成独立的 SVG 字符串；解析失败时抛错，由调用方回退到代码块。 */
export async function renderMermaidSvg(source: string): Promise<string> {
  const mermaid = await loadMermaid()
  mermaid.initialize(mermaidConfig())
  const parsed = await mermaid.parse(source, { suppressErrors: true })
  if (!parsed) throw new Error('Mermaid 图表语法无法解析')
  const id = `mermaid-diagram-${++sequence}`
  const { svg } = await mermaid.render(id, source)
  return svg
}
