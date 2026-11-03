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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary scope="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
