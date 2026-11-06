export type DiffKind = 'same' | 'add' | 'remove'

export interface DiffLine {
  kind: DiffKind
  text: string
}

const MAX_LCS_CELLS = 4_000_000

function splitLines(text: string): string[] {
  if (!text) return []
  return text.replace(/\r\n?/g, '\n').split('\n')
}

/**
 * 行级 diff：先裁掉公共前后缀，再对中间部分做 LCS。
 * 内容特别长时退化为“中间整段删除 + 新增”，避免一次对比占用太多内存。
 */
export function diffText(before: string, after: string): DiffLine[] {
  const left = splitLines(before)
  const right = splitLines(after)

  let prefix = 0
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++
  let suffix = 0
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix++
  }

  const leftMid = left.slice(prefix, left.length - suffix)
  const rightMid = right.slice(prefix, right.length - suffix)
  const result: DiffLine[] = []
  for (let index = 0; index < prefix; index++) result.push({ kind: 'same', text: left[index]! })

  if (leftMid.length === 0 && rightMid.length === 0) {
    // 完全相同的文本。
  } else if (leftMid.length === 0) {
    for (const text of rightMid) result.push({ kind: 'add', text })
  } else if (rightMid.length === 0) {
    for (const text of leftMid) result.push({ kind: 'remove', text })
  } else if (leftMid.length * rightMid.length > MAX_LCS_CELLS) {
    for (const text of leftMid) result.push({ kind: 'remove', text })
    for (const text of rightMid) result.push({ kind: 'add', text })
  } else {
    const columns = rightMid.length + 1
    const dp = new Uint32Array((leftMid.length + 1) * columns)
    for (let i = leftMid.length - 1; i >= 0; i--) {
      for (let j = rightMid.length - 1; j >= 0; j--) {
        dp[i * columns + j] =
          leftMid[i] === rightMid[j]
            ? dp[(i + 1) * columns + j + 1]! + 1
            : Math.max(dp[(i + 1) * columns + j]!, dp[i * columns + j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < leftMid.length && j < rightMid.length) {
      if (leftMid[i] === rightMid[j]) {
        result.push({ kind: 'same', text: leftMid[i]! })
        i++
        j++
      } else if (dp[(i + 1) * columns + j]! >= dp[i * columns + j + 1]!) {
        result.push({ kind: 'remove', text: leftMid[i]! })
        i++
      } else {
        result.push({ kind: 'add', text: rightMid[j]! })
        j++
      }
    }
    while (i < leftMid.length) result.push({ kind: 'remove', text: leftMid[i++]! })
    while (j < rightMid.length) result.push({ kind: 'add', text: rightMid[j++]! })
  }

  for (let index = suffix; index > 0; index--) {
    result.push({ kind: 'same', text: left[left.length - index]! })
  }
  return result
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number; unchanged: number } {
  let added = 0
  let removed = 0
  let unchanged = 0
  for (const line of lines) {
    if (line.kind === 'add') added++
    else if (line.kind === 'remove') removed++
    else unchanged++
  }
  return { added, removed, unchanged }
}
