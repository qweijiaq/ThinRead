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
    const previousEngine = localStorage.getItem('reading-notes-tts-engine')
    localStorage.setItem('reading-notes-tts-engine', 'edge')
    window.api = Object.assign(createApiStub(), {
      getTtsStatus: async () => ({
        edge: {
          online: true,
          voices: [
            { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女声', language: 'zh-CN', gender: 'female' },
            { id: 'zh-CN-YunxiNeural', label: '云希 · 男声', language: 'zh-CN', gender: 'male' },
          ],
        },
        kokoro: { ready: true, path: '/tmp/kokoro', voices: [], missing: [], modelFile: 'onnx/model.onnx', downloadUrl: '' },
        beatra: { configured: false },
      }),
      getBeatraVoices: async () => [],
      synthesizeTts: async () => ({ mime: 'audio/mpeg', base64: '' }),
      saveAudio: async () => ({ saved: false, path: null }),
    }) as ReadingApi
    setReady(true)
    return () => {
      window.api = previous
      if (previousEngine === null) localStorage.removeItem('reading-notes-tts-engine')
      else localStorage.setItem('reading-notes-tts-engine', previousEngine)
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
        component: '听读面板：Edge、Kokoro、Beatra、逐句播放和整章音频入口。',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ListenWithMock>

export default meta
type Story = StoryObj<typeof meta>

export const Edge: Story = {
  name: '双人播客 · Edge',
}
