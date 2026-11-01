import { useEffect, useState, type JSX } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import type { LabArtifact, ReadingApi, RelationGraph } from '../../shared/types.js'
import { LabRelationGraph } from '../components/LabRelationGraph.js'
import { createApiStub } from './api-stub.js'

const relationGraphFixture: RelationGraph = {
  title: '雾港疑云',
  genre: '侦探',
  summary: '一桩发生在雾港的失踪案，把侦探、码头和旧船厂连在一起。',
  plot: '林默受委托寻找失踪的钟表匠，沿着旧船厂的线索发现周岚伪造了出港记录。',
  nodes: [
    {
      id: 'person-lin',
      label: '林默',
      kind: 'person',
      role: 'detective',
      importance: 5,
      identity: '私家侦探',
      rank: '',
      affiliation: '雾港警局',
      aliases: ['老林'],
      realWorld: false,
      encyclopedia: '',
      description: '习惯先观察再开口的侦探。',
      chapters: ['第一章'],
    },
    {
      id: 'person-zhou',
      label: '周岚',
      kind: 'person',
      role: 'killer',
      importance: 5,
      identity: '船厂会计',
      rank: '',
      affiliation: '旧船厂',
      aliases: [],
      realWorld: false,
      encyclopedia: '',
      description: '掌握出港记录的人。',
      chapters: ['第三章'],
    },
    {
      id: 'org-yard',
      label: '旧船厂',
      kind: 'organization',
      role: 'other',
      importance: 4,
      identity: '码头船厂',
      rank: '',
      affiliation: '雾港',
      aliases: [],
      realWorld: false,
      encyclopedia: '',
      description: '案件的核心地点。',
      chapters: ['第二章'],
    },
    {
      id: 'place-harbor',
      label: '雾港',
      kind: 'place',
      role: 'other',
      importance: 3,
      identity: '港口城市',
      rank: '',
      affiliation: '',
      aliases: [],
      realWorld: false,
      encyclopedia: '',
      description: '常年有雾的港口。',
      chapters: ['第一章'],
    },
    {
      id: 'event-ledger',
      label: '出港记录',
      kind: 'event',
      role: 'other',
      importance: 4,
      identity: '关键物证',
      rank: '',
      affiliation: '',
      aliases: [],
      realWorld: false,
      encyclopedia: '',
      description: '记录被篡改的日期。',
      chapters: ['第三章'],
    },
  ],
  edges: [
    {
      source: 'person-lin',
      target: 'person-zhou',
      label: '追查',
      reverseLabel: '被追查',
      kind: 'suspect',
      description: '林默从账本里发现了周岚的痕迹。',
      chapters: ['第三章'],
    },
    {
      source: 'person-zhou',
      target: 'org-yard',
      label: '任职于',
      reverseLabel: '雇佣',
      kind: 'other',
      description: '周岚在旧船厂做会计。',
      chapters: ['第二章'],
    },
    {
      source: 'org-yard',
      target: 'place-harbor',
      label: '位于',
      reverseLabel: '包含',
      kind: 'other',
      description: '船厂在雾港北岸。',
      chapters: ['第一章'],
    },
    {
      source: 'event-ledger',
      target: 'org-yard',
      label: '存放于',
      reverseLabel: '记录',
      kind: 'clue',
      description: '出港记录锁在船厂档案室。',
      chapters: ['第三章'],
    },
  ],
}

function LabRelationGraphWithMock(): JSX.Element | null {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = window.api
    window.api = Object.assign(createApiStub(), {
      getLabArtifact: async (tool: string, scope: string): Promise<LabArtifact> => ({
        id: 'relation-story',
        tool,
        scope,
        title: '人物关系图',
        content: JSON.stringify(relationGraphFixture),
        meta: null,
        createdAt: '2026-11-01T00:00:00.000Z',
      }),
    }) as ReadingApi
    setReady(true)
    return () => {
      window.api = previous
    }
  }, [])
  return ready ? <LabRelationGraph bookId="book-story" bookTitle="雾港疑云" /> : null
}

const meta = {
  title: '地图 / LabRelationGraph',
  component: LabRelationGraphWithMock,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: '人物关系图的 React Flow 版本：节点、方向标签、MiniMap 和边详情都可以在隔离 story 里检查。',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof LabRelationGraphWithMock>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: '人物关系图 · 默认',
}
