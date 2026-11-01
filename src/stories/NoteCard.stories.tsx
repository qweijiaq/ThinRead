import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { NoteCard } from '../components/NoteCard.js'

import { noteCardBacklinks, noteCardNote } from './fixtures.js'

const noop = fn()

const meta = {
  title: '笔记 / NoteCard',
  component: NoteCard,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'AI 笔记卡片，带原文引用、标签、AI 延伸与反向链接。纯 props 渲染，不依赖 Electron。',
      },
    },
  },
  args: {
    note: noteCardNote,
    backlinks: noteCardBacklinks,
    linkCandidates: [],
    focusKey: 0,
    expanding: false,
    onUpdate: noop,
    onDelete: noop,
    onShare: noop,
    onExpand: noop,
    onJumpQuote: noop,
    onOpenNote: noop,
    onWikiLink: noop,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 560, padding: 8 }}>
        <Story />
      </div>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof NoteCard>

export default meta
type Story = StoryObj<typeof meta>

export const PointWithQuote: Story = {
  name: '知识点 · 原文引用 + 延伸',
}

export const Highlight: Story = {
  name: '高亮 · 用户笔记',
  args: {
    note: {
      ...noteCardNote,
      id: 'note-highlight-1',
      kind: 'highlight',
      title: '把时间花在真正重要的事情上',
      content: '这句话提醒我：时间不是不够，而是被太多“看起来紧急”的事切碎了。',
      quote: '所谓自由，不是想做什么就做什么，而是知道什么值得做，然后真的去做。',
      author: 'user',
      edited: false,
      importance: null,
      role: null,
      divergences: [],
      tags: ['时间', '自由'],
    },
    backlinks: [],
  },
}

export const Condensed: Story = {
  name: '读薄稿',
  args: {
    note: {
      ...noteCardNote,
      id: 'note-condensed-1',
      kind: 'condensed',
      title: '第三章读薄：先选择，再完成',
      content:
        '这一章讲的是从“把每件事都做完”转向“先决定什么值得做”。三个练习：只挑三件事、允许不完美、每天记下一个微小进展。秩序不是规划出来的，而是在一次次选择里长出来的。',
      quote: null,
      quoteVerified: false,
      section: null,
      role: null,
      divergences: [],
      tags: ['读薄'],
    },
    backlinks: [],
  },
}
