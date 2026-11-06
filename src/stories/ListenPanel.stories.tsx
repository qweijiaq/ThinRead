import { useEffect, useState, type JSX } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import type { ReadingApi } from '../../shared/types.js'
import { ListenPanel } from '../components/ListenPanel.js'
import { createApiStub } from './api-stub.js'

const script = `A：欢迎来到页边。今天我们不背结论，只把这一章里最难的一点聊清楚。
B：好。我先给判断：真正稀缺的不是意志力，而是及时发现注意力已经漂走的那个动作。
A：那它的边界在哪里？是不是所有问题都能靠环境设计解决？
B：不是。环境能减少摩擦，但不能替你决定要做什么。方向仍然要由人自己选。`

function ListenWithMock(): JSX.Element | null {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = window.api
    window.api = Object.assign(createApiStub(), {
      getTtsStatus: async () => ({
        qwen: {
          configured: true,
          baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
          model: 'qwen-audio-3.1-tts-flash',
          voiceA: 'longanhuan_v3.1',
          voiceB: 'longanhuan_v3.1',
          voiceEn: '',
          pricePerK: 0,
          voices: [{ id: 'longanhuan_v3.1', label: '龙安欢 v3.1', language: 'zh-CN' }],
        },
      }),
      synthesizeTts: async () => ({ mime: 'audio/mpeg', base64: '' }),
      saveAudio: async () => ({ saved: false, path: null }),
    }) as ReadingApi
    setReady(true)
    return () => {
      window.api = previous
    }
  }, [])
  return ready ? <ListenPanel title="双人播客 · 样章" text={script} onClose={fn()} /> : null
}

const meta = {
  title: '听读 / ListenPanel',
  component: ListenWithMock,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: '听读面板：千问 TTS、逐句播放和整章音频入口。',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ListenWithMock>

export default meta
type Story = StoryObj<typeof meta>

export const Qwen: Story = {
  name: '双人播客 · 千问 TTS',
}
