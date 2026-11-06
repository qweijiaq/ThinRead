import { useMemo, type JSX } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { defaultMeasureContext, planXhsCarousel } from '../lib/xhs-carousel.js'
import { XhsPagePreview } from './XhsPagePreview.js'
import { articleChapter, xhsNotes } from './fixtures.js'

function XhsPageGallery({ theme = 'paper' }: { theme?: 'paper' | 'ink' }): JSX.Element {
  const plan = useMemo(
    () =>
      planXhsCarousel({
        scope: 'chapter',
        bookTitle: '页边样书',
        author: '林一白',
        chapterId: articleChapter.id,
        chapterTitle: articleChapter.title,
        chapters: [articleChapter],
        notes: xhsNotes,
        title: articleChapter.title,
        measure: defaultMeasureContext(),
      }),
    [],
  )
  const contentIndex = plan.pages.findIndex((page) => page.kind === 'content')
  const closingIndex = plan.pages.length - 1
  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start', padding: 32 }}>
      <XhsPagePreview plan={plan} pageIndex={0} theme={theme} width={280} />
      <XhsPagePreview plan={plan} pageIndex={Math.max(1, contentIndex)} theme={theme} width={280} />
      <XhsPagePreview plan={plan} pageIndex={closingIndex} theme={theme} width={280} />
    </div>
  )
}

const meta = {
  title: '小红书 / XhsPagePreview',
  component: XhsPageGallery,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof XhsPageGallery>

export default meta
type Story = StoryObj<typeof meta>

export const AllPages: Story = {
  name: '封面 / 内容 / 结尾 · 纸',
}

export const AllPagesInk: Story = {
  name: '封面 / 内容 / 结尾 · 墨',
  render: () => <XhsPageGallery theme="ink" />,
}
