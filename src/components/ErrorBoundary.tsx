import { Component, type ErrorInfo, type ReactNode } from 'react'

import { reportRendererError } from '../lib/report-error.js'

interface ErrorBoundaryProps {
  children: ReactNode
  /** 出错时的上下文，例如 app、reader、lab。 */
  scope?: string
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
  copied: boolean
}

/**
 * 兜住整棵子树的渲染错误。没有它时，任何一个组件抛错或 lazy chunk 加载失败
 * 都会让整页变白，用户只能杀进程。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null, copied: false }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null })
    reportRendererError(this.props.scope ?? 'app', error, { componentStack: info.componentStack })
  }

  private reload = (): void => {
    window.location.reload()
  }

  private copy = (): void => {
    const { error, componentStack } = this.state
    const text = [error?.name, error?.message, error?.stack, componentStack].filter(Boolean).join('\n\n')
    const done = (): void => this.setState({ copied: true })
    const fallback = (): void => {
      const api = window.api as { copyText?: (value: string) => Promise<void> } | undefined
      void api?.copyText?.(text).then(done).catch(() => undefined)
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(done).catch(fallback)
      return
    }
    fallback()
  }

  render(): ReactNode {
    const { error, componentStack, copied } = this.state
    if (!error) return this.props.children

    return (
      <div className="crash-screen" role="alert">
        <div className="crash-card">
          <p className="crash-eyebrow">页边 · ThinRead</p>
          <h1>界面遇到了问题</h1>
          <p className="crash-lead">
            这一步的界面没能渲染出来。书和笔记都还在本地，重新加载通常可以恢复；如果反复出现，先导出诊断包再反馈。
          </p>
          <div className="crash-actions">
            <button type="button" className="primary-button" onClick={this.reload}>
              重新加载
            </button>
            <button type="button" className="ghost-button" onClick={this.copy}>
              {copied ? '已复制' : '复制错误信息'}
            </button>
          </div>
          <details className="crash-details">
            <summary>查看错误详情</summary>
            <pre>
              {[error.name, error.message, error.stack, componentStack].filter(Boolean).join('\n\n')}
            </pre>
          </details>
          <p className="field-hint">
            重新加载后仍然打不开的话，把「设置 → 导出诊断包」生成的 zip 发给开发者，里面有本机日志。
          </p>
        </div>
      </div>
    )
  }
}
