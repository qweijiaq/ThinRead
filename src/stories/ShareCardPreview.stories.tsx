import type { Meta, StoryObj } from '@storybook/react-vite'

import { ShareCardPreview } from './ShareCardPreview.js'
import { shareInputs } from './fixtures.js'

const meta = {
  title: '分享 / ShareCardPreview',
  component: ShareCardPreview,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          '直接调用 renderShareCard 的纯展示组件，不经过 ShareDialog，也不需要 Electron preload。用于检查五种模板与 paper/ink 两套配色。',
      },
    },
  },
  argTypes: {
    width: { control: { type: 'range', min: 180, max: 480, step: 10 } },
  },
  args: {
    input: shareInputs.quotePaper,
    width: 320,
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ShareCardPreview>

export default meta
type Story = StoryObj<typeof meta>

export const QuotePaper: Story = {
  name: '金句 · 纸',
  args: { input: shareInputs.quotePaper },
}

export const QuoteInk: Story = {
  name: '金句 · 墨',
  args: { input: shareInputs.quoteInk },
}

export const KnowledgePaper: Story = {
  name: '知识卡 · 纸',
  args: { input: shareInputs.knowledgePaper },
}

export const KnowledgeInk: Story = {
  name: '知识卡 · 墨',
  args: { input: shareInputs.knowledgeInk },
}

export const CondensedPaper: Story = {
  name: '读薄卡 · 纸',
  args: { input: shareInputs.condensedPaper },
}

export const CondensedInk: Story = {
  name: '读薄卡 · 墨',
  args: { input: shareInputs.condensedInk },
}

export const BookPaper: Story = {
  name: '整本书 · 纸',
  args: { input: shareInputs.bookPaper },
}

export const BookInk: Story = {
  name: '整本书 · 墨',
  args: { input: shareInputs.bookInk },
}

export const DeckPaper: Story = {
  name: '长图 · 纸',
  args: { input: shareInputs.deckPaper },
}

export const DeckInk: Story = {
  name: '长图 · 墨',
  args: { input: shareInputs.deckInk },
}

export const AllTemplates: Story = {
  name: '全部模板 (paper)',
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 28,
        alignItems: 'start',
        width: 'min(1400px, 100%)',
      }}
    >
      <ShareCardPreview input={shareInputs.quotePaper} width={260} />
      <ShareCardPreview input={shareInputs.knowledgePaper} width={260} />
      <ShareCardPreview input={shareInputs.condensedPaper} width={260} />
      <ShareCardPreview input={shareInputs.bookPaper} width={260} />
      <ShareCardPreview input={shareInputs.deckPaper} width={260} />
    </div>
  ),
}

export const AllTemplatesInk: Story = {
  name: '全部模板 (ink)',
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 28,
        alignItems: 'start',
        width: 'min(1400px, 100%)',
      }}
    >
      <ShareCardPreview input={shareInputs.quoteInk} width={260} />
      <ShareCardPreview input={shareInputs.knowledgeInk} width={260} />
      <ShareCardPreview input={shareInputs.condensedInk} width={260} />
      <ShareCardPreview input={shareInputs.bookInk} width={260} />
      <ShareCardPreview input={shareInputs.deckInk} width={260} />
    </div>
  ),
}
