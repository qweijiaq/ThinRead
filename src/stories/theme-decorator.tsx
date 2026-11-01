import { useEffect, useState, type ReactElement } from 'react'

import type { Decorator } from '@storybook/react-vite'

const APP_THEME_CLASSES = ['theme-plain', 'theme-warm', 'theme-folio'] as const
const CYCLE = ['default', 'plain', 'warm', 'folio'] as const
const CYCLE_INTERVAL_MS = 2500

function applyTheme(theme: string): void {
  const root = document.documentElement
  root.classList.remove(...APP_THEME_CLASSES)
  if (theme !== 'default' && (APP_THEME_CLASSES as readonly string[]).includes(`theme-${theme}`)) {
    root.classList.add(`theme-${theme}`)
  }
}

interface ThemeFrameProps {
  story: ReactElement
  theme: string
}

function ThemeFrame({ story, theme }: ThemeFrameProps): ReactElement {
  const [cycleIndex, setCycleIndex] = useState(0)

  useEffect(() => {
    if (theme !== 'cycle') {
      applyTheme(theme)
      return
    }
    let index = 0
    applyTheme(CYCLE[index]!)
    const timer = window.setInterval(() => {
      index = (index + 1) % CYCLE.length
      setCycleIndex(index)
      applyTheme(CYCLE[index]!)
    }, CYCLE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [theme])

  return (
    <div
      className="story-frame"
      data-story-theme={theme === 'cycle' ? CYCLE[cycleIndex] : theme}
      style={{ minHeight: '100vh', padding: 32, background: 'var(--paper)', color: 'var(--ink)' }}
    >
      {story}
    </div>
  )
}

/**
 * 把选择器里的主题落到预览文档的 <html> 上，和应用里 App 设置 documentElement.className 的方式一致。
 * 工具栏选 “cycle” 时轮换 default/plain/warm/folio，方便一次看四种主题下的同一组件；
 * 默认的 “auto” 则尊重 story 的 parameters.theme，再退回 folio。
 */
export const withAppTheme: Decorator = (Story, context) => {
  const globalTheme = context.globals.theme as string | undefined
  const storyTheme = context.parameters.theme as string | undefined
  const theme = !globalTheme || globalTheme === 'auto' ? (storyTheme ?? 'folio') : globalTheme
  return <ThemeFrame story={<Story />} theme={theme} />
}
