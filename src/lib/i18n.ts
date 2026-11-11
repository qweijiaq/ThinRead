import { useSyncExternalStore } from 'react'

import en from './locales/en.json'

export type Locale = 'zh' | 'en'

const STORAGE_KEY = 'reading-notes-locale'
const listeners = new Set<() => void>()

function loadLocale(): Locale {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

let locale: Locale = loadLocale()

export function getLocale(): Locale {
  return locale
}

export function setLocale(next: Locale): void {
  if (next === locale) return
  locale = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
    document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN'
  } catch {
    // 本地存储不可用时只影响下次启动的语言。
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale)
}

/**
 * 英文词典先覆盖应用外壳（顶栏、通用按钮）。
 * 其余界面仍是中文；迁移方式是把中文字面量换成 t('原文')，未命中时自动回退中文。
 */
const EN: Record<string, string> = en


/**
 * 英文里名词要区分单复数；中文不区分，直接用 many。
 * one 传英文单数文案（例如 t('本书一')），在中文下不会被使用。
 */
export function countUnit(count: number, many: string, one: string): string {
  return getLocale() === 'zh' ? many : count === 1 ? one : many
}

/** 检查某条文案是否已经有英文翻译（测试和迁移工具用）。 */
export function hasTranslation(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(EN, key)
}

/** 以中文原文为 key 查英文；未覆盖时回退中文，迁移可以逐文件进行。 */
export function t(source: string): string {
  if (locale === 'zh') return source
  return EN[source] ?? source
}
