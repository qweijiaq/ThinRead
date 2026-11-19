import { logWarn } from './logger.js'

const corruptRowCounts = new Map<string, number>()

/** 读时降级不是错误，但需要可度量；诊断包会带上这里的计数。 */
export function markCorruptRow(scope: string): void {
  const next = (corruptRowCounts.get(scope) ?? 0) + 1
  corruptRowCounts.set(scope, next)
  if (next === 1) logWarn('db:corrupt-row', '读取到损坏数据，已降级', { scope })
}

export function getDataHealth(): { corruptRows: number; corruptSamples: Record<string, number> } {
  return {
    corruptRows: [...corruptRowCounts.values()].reduce((sum, value) => sum + value, 0),
    corruptSamples: Object.fromEntries(corruptRowCounts),
  }
}

