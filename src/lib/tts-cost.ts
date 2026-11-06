/** 按“元/千字符”估算整章音频费用；未填价格时返回 null。 */
export function estimateSpeechCost(characters: number, pricePerK: number): number | null {
  const chars = Math.max(0, Math.floor(Number(characters) || 0))
  const price = Math.max(0, Number(pricePerK) || 0)
  if (chars === 0 || price === 0) return null
  return (chars / 1000) * price
}
