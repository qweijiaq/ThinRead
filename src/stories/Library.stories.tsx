import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { Library } from '../components/Library.js'

import { libraryBooks } from './fixtures.js'

const meta = {
  title: '书架 / Library',
  component: Library,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          '书架主视图。Story 使用 hasCover=false 的书籍数据，因此封面占位逻辑可完全用纯 props 渲染。',
      },
    },
  },
  args: {
    books: libraryBooks,
    importing: false,
    onOpen: fn(),
    onImport: fn(),
    onDelete: fn(),
    onRename: fn(),
    onCompose: fn(),
    onMerge: fn(),
    onSettings: fn(),
    demo: false,
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Library>

export default meta
type Story = StoryObj<typeof meta>

export const Shelf: Story = {
  name: '书架 · 三本书',
  parameters: { theme: 'folio' },
}

export const WarmShelf: Story = {
  name: '书架 · Warm 主题',
  parameters: { theme: 'warm' },
}

export const Empty: Story = {
  name: '空书架 / 欢迎页',
  args: {
    books: [],
  },
}

export const Importing: Story = {
  name: '空书架 · 导入中',
  args: {
    books: [],
    importing: true,
  },
}
