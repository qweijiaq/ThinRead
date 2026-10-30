export interface ContentCurrentDetail {
  tool: string
  scope: string
}

const EVENT_NAME = 'reading-notes:content-current'

export function notifyContentCurrent(detail: ContentCurrentDetail): void {
  window.dispatchEvent(new CustomEvent<ContentCurrentDetail>(EVENT_NAME, { detail }))
}

export function onContentCurrent(cb: (detail: ContentCurrentDetail) => void): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<ContentCurrentDetail>).detail
    if (detail?.tool && detail?.scope) cb(detail)
  }
  window.addEventListener(EVENT_NAME, listener)
  return () => window.removeEventListener(EVENT_NAME, listener)
}
