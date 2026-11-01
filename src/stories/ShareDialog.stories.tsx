import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { ShareDialog } from '../components/ShareDialog.js'

import {
  shareBook,
  shareCondensedNote,
  shareDeckNotes,
  shareKnowledgeNote,
  shareQuoteNote,
} from './fixtures.js'

const meta = {
  title: '分享 / ShareDialog',
  component: ShareDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          '应用里的分享弹窗。预览环境通过 .storybook/preview.tsx 注入的 window.api 空实现渲染；复制 / 保存按钮可点击，但不会真的写文件。',
      },
    },
  },
  argTypes: {
    onClose: { action: 'close' },
  },
  args: {
    onClose: fn(),
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ShareDialog>

export default meta
type Story = StoryObj<typeof meta>

export const QuoteNote: Story = {
  name: '金句卡',
  args: {
    note: shareQuoteNote,
    initialTemplate: 'quote',
  },
}

export const KnowledgeNote: Story = {
  name: '知识卡',
  args: {
    note: shareKnowledgeNote,
    initialTemplate: 'knowledge',
  },
}

export const CondensedNote: Story = {
  name: '读薄卡',
  args: {
    note: shareCondensedNote,
    initialTemplate: 'condensed',
  },
}

export const BookSummary: Story = {
  name: '整本书',
  args: {
    book: shareBook,
    initialTemplate: 'book',
  },
}

export const Deck: Story = {
  name: '长图摘录集',
  args: {
    notes: shareDeckNotes,
    initialTemplate: 'deck',
  },
}
