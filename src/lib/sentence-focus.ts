/** 逐句专注：只处理纯文本段落，避免拆坏行内链接、代码和图片。 */

const BLOCK_SELECTOR = [
  '.chapter-html p',
  '.chapter-plain p',
  '.chapter-html li',
  '.chapter-plain li',
  '.chapter-html blockquote',
  '.chapter-plain blockquote',
  '.chapter-html dd',
  '.chapter-plain dd',
].join(',')

function canWrap(block: Element): boolean {
  if (block.querySelector('.reader-sentence')) return false
  if (block.querySelector('code, pre, img, svg, table, figure, button, a, .code-block')) return false
  return Array.from(block.childNodes).every(
    (node) => node.nodeType === Node.TEXT_NODE || (node instanceof HTMLElement && node.tagName === 'BR'),
  )
}

function splitSentences(text: string): string[] {
  return (text.match(/[^。！？!?；;.\n]+[。！？!?；;.]?/g) ?? [text])
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

/** 把纯文本段落拆成句子 span；返回是否实际包装了内容。 */
export function wrapSentences(root: HTMLElement): boolean {
  let wrapped = false
  for (const block of root.querySelectorAll(BLOCK_SELECTOR)) {
    if (!canWrap(block)) continue
    const text = block.textContent ?? ''
    const sentences = splitSentences(text)
    if (sentences.length === 0) continue
    const fragment = document.createDocumentFragment()
    for (const sentence of sentences) {
      const span = document.createElement('span')
      span.className = 'reader-sentence'
      span.textContent = sentence
      fragment.appendChild(span)
      if (/[.!?]$/.test(sentence)) fragment.appendChild(document.createTextNode(' '))
    }
    block.replaceChildren(fragment)
    wrapped = true
  }
  return wrapped
}

/** 还原成普通文本节点，避免影响后续选择、引用和复制。 */
export function unwrapSentences(root: HTMLElement): void {
  for (const span of root.querySelectorAll('.reader-sentence')) {
    const parent = span.parentNode
    span.replaceWith(document.createTextNode(span.textContent ?? ''))
    if (parent instanceof HTMLElement) parent.normalize()
  }
}

export function focusSentenceAt(event: MouseEvent, root: HTMLElement): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  const sentence = target.closest<HTMLElement>('.reader-sentence')
  if (!sentence || !root.contains(sentence)) return false
  for (const item of root.querySelectorAll('.reader-sentence.is-active')) {
    item.classList.remove('is-active')
  }
  sentence.classList.add('is-active')
  return true
}

export function clearSentenceFocus(root: HTMLElement): void {
  for (const item of root.querySelectorAll('.reader-sentence.is-active')) {
    item.classList.remove('is-active')
  }
}
