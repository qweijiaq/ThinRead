import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { Reader } from '../components/Reader.js'
import type { ReaderStyle } from '../../shared/types.js'

import {
  articleChapter,
  articleEchoes,
  articleMarks,
  readerStyle,
} from './fixtures.js'

const noop = fn()

const meta = {
  title: '阅读 / Reader',
  component: Reader,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          '正文阅读区。Story 直接传入 ChapterContent / ReaderMark / RelatedNote 等纯 props，不依赖 Electron preload。',
      },
    },
  },
  argTypes: {
    loading: { control: 'boolean' },
  },
  args: {
    chapter: articleChapter,
    loading: false,
    style: readerStyle,
    bookTitle: '页边样书',
    scrollTarget: null,
    echoes: articleEchoes,
    excerpt: '所谓自由，不是想做什么就做什么，而是知道什么值得做，然后真的去做。',
    marks: articleMarks,
    onCreateMark: noop,
    onClearMarks: noop,
    onOpenFormat: noop,
    onOpenEcho: noop,
    onListen: noop,
    onRenameChapter: noop,
    onMarginNote: noop,
    onAsk: noop,
    onShareQuote: noop,
    onListenSelection: noop,
    onOpenXhs: noop,
    positionTarget: null,
    onCreateBookmark: noop,
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Reader>

export default meta
type Story = StoryObj<typeof meta>

export const FolioSerif: Story = {
  name: 'Folio · 衬线正文 + 标记',
  parameters: { theme: 'folio' },
}

export const WarmSerif: Story = {
  name: 'Warm · 衬线正文',
  parameters: { theme: 'warm' },
  args: {
    style: { ...readerStyle, theme: 'warm' },
  },
}

export const PlainSans: Story = {
  name: 'Plain · 无衬线正文',
  parameters: { theme: 'plain' },
  args: {
    style: {
      fontFamily: 'sans',
      fontSize: 18,
      lineHeight: 1.85,
      paragraphSpacing: 1.2,
      indent: false,
      theme: 'plain',
    } satisfies ReaderStyle,
  },
}

export const Loading: Story = {
  name: '加载中骨架',
  args: {
    chapter: null,
    loading: true,
    echoes: [],
    marks: [],
  },
}
