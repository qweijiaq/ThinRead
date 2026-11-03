export interface LayoutBox {
  x: number
  y: number
  width: number
  height: number
}

function orientation(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function onSegment(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): boolean {
  return (
    Math.min(a.x, b.x) <= c.x + 0.001 &&
    c.x <= Math.max(a.x, b.x) + 0.001 &&
    Math.min(a.y, b.y) <= c.y + 0.001 &&
    c.y <= Math.max(a.y, b.y) + 0.001
  )
}

/** 判断两条线段是否真正相交；共享端点的边不算交叉。 */
export function segmentsCross(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)
  if (o1 === 0 && onSegment(a, b, c)) return true
  if (o2 === 0 && onSegment(a, b, d)) return true
  if (o3 === 0 && onSegment(c, d, a)) return true
  if (o4 === 0 && onSegment(c, d, b)) return true
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)
}

/** 标签允许换行；宽度上限 180，避免一个长头衔把整张图撑开。 */
export function relationLabelWidth(label: string, circleSize: number): number {
  const estimated = Math.min(180, Math.max(circleSize, label.length * 11 + 14))
  return Math.ceil(estimated)
}

export function countCrossings(
  points: Map<string, { x: number; y: number }>,
  edges: Array<{ source: string; target: string }>,
): number {
  let crossings = 0
  for (let index = 0; index < edges.length; index++) {
    const left = edges[index]!
    const a = points.get(left.source)
    const b = points.get(left.target)
    if (!a || !b) continue
    for (let other = index + 1; other < edges.length; other++) {
      const right = edges[other]!
      if (
        left.source === right.source ||
        left.source === right.target ||
        left.target === right.source ||
        left.target === right.target
      ) {
        continue
      }
      const c = points.get(right.source)
      const d = points.get(right.target)
      if (!c || !d) continue
      if (segmentsCross(a, b, c, d)) crossings++
    }
  }
  return crossings
}

export function countOverlaps(boxes: LayoutBox[]): number {
  let overlaps = 0
  for (let index = 0; index < boxes.length; index++) {
    const left = boxes[index]!
    for (let other = index + 1; other < boxes.length; other++) {
      const right = boxes[other]!
      if (
        left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y
      ) {
        overlaps++
      }
    }
  }
  return overlaps
}
