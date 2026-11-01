import { getNodesBounds, getViewportForBounds, type Node } from '@xyflow/react'

import type { SaveFileResult } from '../../shared/types.js'

const MIN_LONG_SIDE = 1200
const MAX_LONG_SIDE = 2400
const GRAPH_PADDING = 140
const PIXEL_RATIO = 2

/** html-to-image 只复制 documentElement 上存在的属性，SVG 的 fill/stroke 必须显式带上。 */
const SVG_STYLE_PROPERTIES = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'paint-order',
  'stop-color',
  'stop-opacity',
  'text-anchor',
  'dominant-baseline',
  'shape-rendering',
  'pointer-events',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'color',
  'opacity',
  'visibility',
]

/**
 * html-to-image 在 SVG 上不会可靠地带入 CSS 的 fill/stroke，克隆后会退回黑色。
 * 导出前把 SVG 的计算样式写成内联样式，导出结束再恢复。
 */
function inlineSvgStyles(root: HTMLElement): () => void {
  const elements = root.querySelectorAll<SVGElement>('svg, svg *')
  const previous: Array<{ element: SVGElement; style: string | null }> = []
  for (const element of elements) {
    const computed = getComputedStyle(element)
    const declarations = SVG_STYLE_PROPERTIES.map((name) => `${name}:${computed.getPropertyValue(name)}`).join(';')
    if (!declarations) continue
    const style = element.getAttribute('style')
    previous.push({ element, style })
    element.setAttribute('style', `${style ? `${style};` : ''}${declarations}`)
  }
  return () => {
    for (const item of previous) {
      if (item.style === null) item.element.removeAttribute('style')
      else item.element.setAttribute('style', item.style)
    }
  }
}

function styleProperties(): string[] {
  if (typeof document === 'undefined') return SVG_STYLE_PROPERTIES
  const base = Array.from(getComputedStyle(document.documentElement))
  return [...new Set([...base, ...SVG_STYLE_PROPERTIES])]
}

function paperBackground(): string {
  if (typeof document === 'undefined') return '#fbf8f1'
  return getComputedStyle(document.documentElement).getPropertyValue('--paper-2').trim() || '#fbf8f1'
}

function lineColor(): string {
  if (typeof document === 'undefined') return '#d2c5af'
  return getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#d2c5af'
}

/** React Flow 的 Dots 背景不在 viewport 里；导出时补一层同样的纸色点阵。 */
async function composePaperBackground(
  dataUrl: string,
  options: { zoom: number; offsetX: number; offsetY: number; pixelRatio: number },
): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('导出图片解码失败。'))
    element.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) return dataUrl

  context.fillStyle = paperBackground()
  context.fillRect(0, 0, canvas.width, canvas.height)
  const step = 22 * options.zoom * options.pixelRatio
  const radius = Math.max(1, 0.9 * options.zoom * options.pixelRatio)
  const offsetX = (((options.offsetX * options.pixelRatio) % step) + step) % step
  const offsetY = (((options.offsetY * options.pixelRatio) % step) + step) % step
  context.fillStyle = lineColor()
  context.globalAlpha = 0.7
  for (let y = offsetY; y < canvas.height; y += step) {
    for (let x = offsetX; x < canvas.width; x += step) {
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
    }
  }
  context.globalAlpha = 1
  context.drawImage(image, 0, 0)
  return canvas.toDataURL('image/png')
}

function imageSize(nodes: Node[]): { width: number; height: number } {
  const bounds = getNodesBounds(nodes)
  const longSide = Math.max(bounds.width, bounds.height) + GRAPH_PADDING * 2
  const aspect = Math.max(0.5, Math.min(3, bounds.width / Math.max(1, bounds.height)))
  const target = Math.round(Math.max(MIN_LONG_SIDE, Math.min(MAX_LONG_SIDE, longSide)))
  return aspect >= 1
    ? { width: target, height: Math.round(target / aspect) }
    : { width: Math.round(target * aspect), height: target }
}

/** 把 React Flow 的完整节点范围导出成 PNG，而不是只截当前视口。 */
export async function exportFlowImage(options: {
  root: HTMLElement | null
  nodes: Node[]
  filename: string
}): Promise<SaveFileResult> {
  if (!options.root) throw new Error('地图还没有准备好。')
  if (options.nodes.length === 0) throw new Error('地图里还没有可以导出的节点。')
  const viewport = options.root.querySelector<HTMLElement>('.react-flow__viewport')
  if (!viewport) throw new Error('找不到地图画布。')

  const bounds = getNodesBounds(options.nodes)
  const { width, height } = imageSize(options.nodes)
  const transform = getViewportForBounds(bounds, width, height, 0.2, 2, 0.06)
  const { toPng } = await import('html-to-image')
  const restoreSvgStyles = inlineSvgStyles(viewport)
  let dataUrl: string
  try {
    dataUrl = await toPng(viewport, {
      cacheBust: true,
      includeStyleProperties: styleProperties(),
      width,
      height,
      pixelRatio: PIXEL_RATIO,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
      },
    })
  } finally {
    restoreSvgStyles()
  }
  const image = await composePaperBackground(dataUrl, {
    zoom: transform.zoom,
    offsetX: transform.x,
    offsetY: transform.y,
    pixelRatio: PIXEL_RATIO,
  })
  return window.api.saveImage(image, options.filename)
}

export function graphImageFilename(prefix: string): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.png`
}
