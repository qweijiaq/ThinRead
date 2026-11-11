import { bridge } from '../lib/bridge.js'
import { detectCodeLanguage, shouldCollapseCode } from './code-language.js'
import { highlightCode } from './highlight.js'
import { t } from './i18n.js'

/**
 * 正文 HTML 由 dangerouslySetInnerHTML 渲染，无法直接换成 React 组件；
 * 这里在 DOM 层把 pre 包成带工具栏的代码块，和 Markdown 的 CodeBlock 共用样式。
 */
export function enhanceCodeBlocks(root: HTMLElement): void {
  for (const pre of root.querySelectorAll('pre')) {
    if (pre.closest('.code-block') || pre.closest('.mermaid-diagram')) continue
    const codeElements = [...pre.querySelectorAll('code')]
    const codeClass = codeElements
      .map((element) => element.className)
      .filter(Boolean)
      .join(' ')
    const className = `${pre.className} ${codeClass}`
    if (/\bmermaid\b/i.test(className)) continue
    const source = pre.textContent ?? ''
    if (!source.trim()) continue

    const language = detectCodeLanguage(source, className)
    const collapsible = shouldCollapseCode(source)
    const wrapper = document.createElement('div')
    wrapper.className = `code-block${collapsible ? ' is-collapsed' : ''}`
    if (language) wrapper.dataset.language = language

    const head = document.createElement('div')
    head.className = 'code-block-head'
    const label = document.createElement('span')
    label.className = 'code-block-lang'
    label.textContent = language ?? ''
    const actions = document.createElement('span')
    actions.className = 'code-block-actions'

    if (collapsible) {
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'code-block-action'
      toggle.dataset.codeAction = 'toggle'
      toggle.setAttribute('aria-expanded', 'false')
      toggle.textContent = t('展开')
      actions.appendChild(toggle)
    }

    const review = document.createElement('button')
    review.type = 'button'
    review.className = 'code-block-action'
    review.dataset.codeAction = 'review'
    review.textContent = t('检查')
    review.title = t('检查代码规范、错字、错误符号和缺漏字符')
    const explain = document.createElement('button')
    explain.type = 'button'
    explain.className = 'code-block-action'
    explain.dataset.codeAction = 'explain'
    explain.textContent = t('理解')
    explain.title = t('理解代码并插入正文')
    const fix = document.createElement('button')
    fix.type = 'button'
    fix.className = 'code-block-action'
    fix.dataset.codeAction = 'fix'
    fix.textContent = t('修复')
    fix.title = t('一键修复代码错误，混入的正文会用注释符注释掉')
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'code-block-action'
    copy.dataset.codeAction = 'copy'
    copy.textContent = t('复制')
    actions.append(review, fix, explain, copy)
    head.append(label, actions)

    const body = document.createElement('div')
    body.className = 'code-block-body'
    pre.replaceWith(wrapper)
    body.appendChild(pre)
    wrapper.append(head, body)

    // 有些 EPUB 会把每个 token 都包成 <code>，甚至夹着文本节点。
    // 先压成一个 code 元素，否则只替换第一个 code 会把整段内容再插一遍。
    let highlightTarget =
      codeElements.length === 1 && pre.childNodes.length === 1 ? codeElements[0]! : null
    if (!highlightTarget) {
      highlightTarget = document.createElement('code')
      if (codeClass) highlightTarget.className = codeClass
      highlightTarget.textContent = source
      pre.replaceChildren(highlightTarget)
    }
    if (highlightTarget.dataset.highlighted !== 'true') {
      highlightTarget.dataset.highlighted = 'true'
      const target = highlightTarget
      void highlightCode(source, language).then((result) => {
        if (!target.isConnected) return
        target.innerHTML = result.html
        target.classList.add('hljs')
      })
    }
  }
}

/** 代码块工具栏的事件委托；返回是否处理了这次点击。 */
export function handleCodeBlockClick(event: MouseEvent, root: HTMLElement): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  const action = target.closest<HTMLElement>('[data-code-action]')
  if (!action || !root.contains(action)) return false
  const wrapper = action.closest('.code-block')
  if (!wrapper) return false
  event.preventDefault()

  if (action.dataset.codeAction === 'toggle') {
    const collapsed = wrapper.classList.toggle('is-collapsed')
    action.textContent = collapsed ? t('展开') : t('收起')
    action.setAttribute('aria-expanded', String(!collapsed))
    return true
  }

  if (action.dataset.codeAction === 'copy') {
    const copyText = bridge?.copyText
    if (!copyText) return true
    const code = wrapper.querySelector('pre')?.textContent ?? ''
    void copyText(code).then(() => {
      action.textContent = t('已复制')
      window.setTimeout(() => {
        if (action.isConnected) action.textContent = t('复制')
      }, 1_400)
    }).catch(() => undefined)
    return true
  }
  return false
}


export interface CodeAssistClick {
  action: 'review' | 'explain' | 'fix'
  code: string
  language: string
}

/** 代码块「检查 / 理解」按钮的事件委托；不是这两个按钮时返回 null。 */
export function handleCodeAssistClick(event: MouseEvent, root: HTMLElement): CodeAssistClick | null {
  const target = event.target
  if (!(target instanceof HTMLElement)) return null
  const action = target.closest<HTMLElement>(
    '[data-code-action="review"], [data-code-action="explain"], [data-code-action="fix"]',
  )
  if (!action || !root.contains(action)) return null
  const wrapper = action.closest<HTMLElement>('.code-block')
  const pre = wrapper?.querySelector('pre')
  if (!wrapper || !pre) return null
  event.preventDefault()
  event.stopPropagation()
  return {
    action:
      action.dataset.codeAction === 'explain'
        ? 'explain'
        : action.dataset.codeAction === 'fix'
          ? 'fix'
          : 'review',
    code: pre.textContent ?? '',
    language: wrapper.dataset.language ?? '',
  }
}
