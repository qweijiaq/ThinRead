import { useCallback, useState } from 'react'

const KEY = 'reading-notes-core-mode'

function read(): boolean {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === null ? true : stored !== 'false'
  } catch {
    return true
  }
}

/** 精简模式默认开启：只保留阅读、读薄、卡片和成书主线。 */
export function useCoreMode(): [boolean, (value: boolean) => void] {
  const [coreMode, setCoreMode] = useState(read)
  const update = useCallback((value: boolean) => {
    setCoreMode(value)
    try {
      localStorage.setItem(KEY, String(value))
    } catch {
      // 存储不可用时只影响本次会话。
    }
  }, [])
  return [coreMode, update]
}
