/**
 * 书籍级语言检测：只有整本书确实以外文为主时才开放翻译。
 * 单章检测容易被英文引用、术语表或版权页带偏，所以按可见正文聚合判断。
 */

export interface BookLanguageInfo {
  /** 是否认为这本书需要翻译。 */
  foreign: boolean
  /** 粗判的主要语言，用于提示文案。 */
  language: string
  /** 拉丁字母占「拉丁字母 + 汉字」的比例。 */
  ratio: number
  latin: number
  cjk: number
}

const SAMPLE_PER_CHAPTER = 30_000

function count(text: string): {
  cjk: number
  kana: number
  hangul: number
  cyrillic: number
  latin: number
} {
  const sample = text.slice(0, SAMPLE_PER_CHAPTER)
  return {
    cjk: (sample.match(/[\u3400-\u9fff]/g) ?? []).length,
    kana: (sample.match(/[\u3040-\u30ff]/g) ?? []).length,
    hangul: (sample.match(/[\uac00-\ud7af]/g) ?? []).length,
    cyrillic: (sample.match(/[\u0400-\u04ff]/g) ?? []).length,
    latin: (sample.match(/[A-Za-z]/g) ?? []).length,
  }
}

export function detectBookLanguage(texts: string[]): BookLanguageInfo {
  let cjk = 0
  let kana = 0
  let hangul = 0
  let cyrillic = 0
  let latin = 0
  for (const text of texts) {
    if (!text.trim()) continue
    const next = count(text)
    cjk += next.cjk
    kana += next.kana
    hangul += next.hangul
    cyrillic += next.cyrillic
    latin += next.latin
  }

  const ratio = latin / Math.max(1, latin + cjk)

  if (kana >= 240 && kana > cjk * 0.2) {
    return { foreign: true, language: '日文', ratio, latin, cjk }
  }
  if (hangul >= 240 && hangul > cjk * 0.2) {
    return { foreign: true, language: '韩文', ratio, latin, cjk }
  }
  if (cyrillic >= 400 && cyrillic > cjk * 0.4) {
    return { foreign: true, language: '俄文等西里尔文字', ratio, latin, cjk }
  }
  // 中文书里出现英文人名、术语和引用是常态；只有拉丁字母明显超过汉字，
  // 或者几乎没有汉字但有一定量拉丁文本时，才认为整本书是外文书。
  if (latin >= 1200 && latin > cjk * 1.5) {
    return { foreign: true, language: '英文等拉丁字母文字', ratio, latin, cjk }
  }
  if (cjk < 200 && latin >= 500) {
    return { foreign: true, language: '英文等拉丁字母文字', ratio, latin, cjk }
  }
  return { foreign: false, language: '中文', ratio, latin, cjk }
}
