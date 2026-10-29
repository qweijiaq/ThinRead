import type { ReadingApi } from '../shared/types.js'

declare global {
  interface Window {
    api: ReadingApi
  }
}

export {}
