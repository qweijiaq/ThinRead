import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.js'
import { ErrorBoundary } from './components/ErrorBoundary.js'
import { reportRendererError } from './lib/report-error.js'
import './styles.css'

// 渲染层兜底：没有 ErrorBoundary 能接住的异常（事件处理器、Promise、定时器）也写进本地日志。
window.addEventListener('error', (event) => {
  reportRendererError('window:error', event.error ?? event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  reportRendererError('window:unhandledrejection', event.reason)
})

const root = document.getElementById('root')!

if (!window.api) {
  // 直接用浏览器打开 Vite 地址时没有 preload，先给一句人话，
  // 而不是让界面在第一个 bridge 调用上崩掉。
  root.innerHTML = [
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;font:15px/1.7 -apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif;color:#2b2b2b;background:#f6f4ef">',
    '<div style="max-width:420px">',
    '<p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;color:#8a8378">页边 · ThinRead</p>',
    '<h1 style="margin:0 0 12px;font-size:22px">这个地址只给开发调试用</h1>',
    '<p style="margin:0 0 10px">页边需要桌面端提供的本地接口，浏览器里打不开。请回到已经打开的“页边”窗口，或从下载页安装 macOS 应用。</p>',
    '<p style="margin:0;color:#8a8378;font-size:13px">如果桌面窗口也显示同样的错误，关掉它重新运行 <code>pnpm dev</code> 即可。</p>',
    '</div></div>',
  ].join('')
} else {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary scope="app">
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}
