import { t } from './i18n.js'

const WRAP_CLASS = 'reader-image-wrap'
const ACTION = 'reader-image-action'

function setButtonStatus(button: HTMLButtonElement, text: string, fallback: string): void {
  button.textContent = text
  window.setTimeout(() => {
    if (button.isConnected) button.textContent = fallback
  }, 1_500)
}

async function imageToDataUrl(src: string): Promise<string> {
  if (/^data:image\//i.test(src)) return src
  const response = await fetch(src)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 给正文图片加一个悬浮复制按钮。图片本身仍由原 HTML 渲染，
 * 这里只包一层定位容器，不改变图片地址和样式。
 */
export function enhanceImages(root: HTMLElement): number {
  let count = 0
  for (const img of root.querySelectorAll('img')) {
    if (img.closest(`.${WRAP_CLASS}`)) continue
    if (img.closest('.code-block, pre, .mermaid-diagram')) continue
    const src = img.getAttribute('src')?.trim() ?? ''
    if (!src) continue
    const width = Number(img.getAttribute('width') ?? 0)
    const height = Number(img.getAttribute('height') ?? 0)
    if ((width > 0 && width <= 2) || (height > 0 && height <= 2)) continue

    const wrapper = document.createElement('span')
    wrapper.className = WRAP_CLASS
    img.replaceWith(wrapper)
    wrapper.appendChild(img)
    const actions = document.createElement('span')
    actions.className = 'reader-image-actions'
    const copyButton = document.createElement('button')
    copyButton.type = 'button'
    copyButton.className = ACTION
    copyButton.dataset.imageAction = 'copy'
    copyButton.textContent = t('复制图片')
    copyButton.setAttribute('aria-label', t('复制图片'))
    const understandButton = document.createElement('button')
    understandButton.type = 'button'
    understandButton.className = ACTION
    understandButton.dataset.imageAction = 'understand'
    understandButton.textContent = t('理解图片')
    understandButton.setAttribute('aria-label', t('理解图片'))
    actions.append(copyButton, understandButton)
    wrapper.appendChild(actions)
    count += 1
  }
  return count
}

/** 图片复制按钮的事件委托。 */
export function handleImageCopyClick(event: MouseEvent, root: HTMLElement): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  const button = target.closest<HTMLButtonElement>('[data-image-action="copy"]')
  if (!button || !root.contains(button)) return false
  const wrapper = button.closest(`.${WRAP_CLASS}`)
  const img = wrapper?.querySelector('img')
  if (!img) return false
  event.preventDefault()
  event.stopPropagation()
  const fallback = t('复制图片')
  const src = img.currentSrc || img.src
  void (async () => {
    try {
      const copyImage = window.api?.copyImage
      if (!copyImage) throw new Error('剪贴板不可用')
      await copyImage(await imageToDataUrl(src))
      setButtonStatus(button, t('已复制图片'), fallback)
    } catch {
      setButtonStatus(button, t('复制失败'), fallback)
    }
  })()
  return true
}


/** 返回被点击图片的地址；不是“理解图片”按钮时返回 null。 */
export function handleImageUnderstandClick(event: MouseEvent, root: HTMLElement): string | null {
  const target = event.target
  if (!(target instanceof HTMLElement)) return null
  const button = target.closest<HTMLButtonElement>('[data-image-action="understand"]')
  if (!button || !root.contains(button)) return null
  const wrapper = button.closest(`.${WRAP_CLASS}`)
  const img = wrapper?.querySelector('img')
  if (!img) return null
  event.preventDefault()
  event.stopPropagation()
  return img.currentSrc || img.src
}
