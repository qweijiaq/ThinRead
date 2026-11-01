import type { Preview } from '@storybook/react-vite'

import { createApiStub } from '../src/stories/api-stub.js'
import { withAppTheme } from '../src/stories/theme-decorator.js'
import '../src/styles.css'

// 预览环境没有 Electron preload；挂一个空实现，让只在点击后才用到 window.api 的组件也能渲染。
if (typeof window !== 'undefined' && !window.api) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    writable: true,
    value: createApiStub(),
  })
}

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: 'todo',
    },
  },
  globalTypes: {
    theme: {
      name: '主题',
      description: '在预览的 <html> 上切换应用的 CSS 主题类',
      toolbar: {
        icon: 'paintbrush',
        dynamicTitle: true,
        items: [
          { value: 'auto', title: 'Auto · 跟随 Story 参数' },
          { value: 'folio', title: 'Folio · theme-folio' },
          { value: 'plain', title: 'Plain · theme-plain' },
          { value: 'warm', title: 'Warm · theme-warm' },
          { value: 'default', title: 'Default · :root' },
          { value: 'cycle', title: '自动轮换全部主题' },
        ],
      },
    },
  },
  initialGlobals: {
    theme: 'auto',
  },
  decorators: [withAppTheme],
}

export default preview
