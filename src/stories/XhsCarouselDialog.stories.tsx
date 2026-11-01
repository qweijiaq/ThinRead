import { useEffect, useState, type JSX } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import type { ReadingApi } from '../../shared/types.js'
import { XhsCarouselDialog } from '../components/XhsCarouselDialog.js'
import { createApiStub } from './api-stub.js'
import { articleChapter, xhsNotes } from './fixtures.js'

function XhsCarouselWithMock(): JSX.Element | null {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = window.api
    window.api = Object.assign(createApiStub(), {
      listNotes: async (_bookId: string, chapterId?: string | null) =>
        chapterId ? xhsNotes.filter((note) => note.chapterId === chapterId) : xhsNotes,
      auditXhsCoverage: async () => ({
        missing: [
          {
            id: 'coverage:story:1',
            chapterId: 'chapter-3',
            chapterTitle: '第三章 把时间花在真正重要的事情上',
            point: '环境会改变默认选择',
            evidence: '把手机放到另一个房间',
          },
        ],
        checkedChapters: 1,
        note: 'Storybook mock：发现 1 个疑似漏点。',
      }),
    }) as ReadingApi
    setReady(true)
    return () => {
      window.api = previous
    }
  }, [])
  return ready ? (
    <XhsCarouselDialog
      bookId="book-thinread-demo"
      bookTitle="页边样书"
      author="林一白"
      chapters={[articleChapter]}
      chapterId="chapter-3"
      chapterTitle="第三章 把时间花在真正重要的事情上"
      initialScope="chapter"
      onClose={fn()}
    />
  ) : null
}

const meta = {
  title: '小红书 / XhsCarouselDialog',
  component: XhsCarouselWithMock,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: '小红书图文弹窗：封面、分页内容、覆盖检查、预览和保存状态。',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof XhsCarouselWithMock>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: '小红书图文 · 章节',
}
