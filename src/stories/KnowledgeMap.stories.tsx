import { useEffect, useState, type JSX } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import type { ReadingApi } from '../../shared/types.js'
import { KnowledgeMap } from '../components/KnowledgeMap.js'
import { createApiStub } from './api-stub.js'
import { knowledgeMapFixture, libraryBooks, xhsNotes } from './fixtures.js'

function KnowledgeMapWithMock(): JSX.Element | null {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = window.api
    window.api = Object.assign(createApiStub(), {
      getKnowledgeMap: async () => knowledgeMapFixture,
      listLibraryNotes: async () => xhsNotes,
    }) as ReadingApi
    setReady(true)
    return () => {
      window.api = previous
    }
  }, [])
  return ready ? (
    <KnowledgeMap
      books={libraryBooks}
      onBack={fn()}
      onOpenNote={fn()}
      onOpenBook={fn()}
    />
  ) : null
}

const meta = {
  title: '地图 / KnowledgeMap',
  component: KnowledgeMapWithMock,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'React Flow 知识地图：节点拖拽、MiniMap、搜索定位和边选择都可以在这个隔离 story 里检查。',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof KnowledgeMapWithMock>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: '知识地图 · 默认',
}
