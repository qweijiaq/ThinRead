import type { Meta, StoryObj } from '@storybook/react-vite'
import type { JSX } from 'react'

import { ErrorBoundary } from '../components/ErrorBoundary.js'

function Boom(): JSX.Element {
  throw new Error('Storybook 里故意触发的渲染错误，用来预览崩溃兜底页。')
}

const meta = {
  title: '状态/ErrorBoundary',
  component: ErrorBoundary,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ErrorBoundary>

export default meta

type Story = StoryObj<typeof meta>

export const Fallback: Story = {
  args: {
    scope: 'storybook',
    children: <Boom />,
  },
}
