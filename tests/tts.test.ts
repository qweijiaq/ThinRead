import assert from 'node:assert/strict'
import test from 'node:test'

import { getTtsStatus, synthesizeTts } from '../electron/tts.js'

test('reports Edge voices and Beatra configuration state', () => {
  const status = getTtsStatus(false)
  assert.equal(status.edge.online, true)
  assert.ok(status.edge.voices.some((voice) => voice.id === 'zh-CN-XiaoxiaoNeural'))
  assert.ok(status.edge.voices.every((voice) => voice.language === 'zh-CN'))
  assert.equal(status.beatra.configured, false)
  assert.equal(getTtsStatus(true).beatra.configured, true)
  // Kokoro 已移除，状态里不能再出现本地模型字段。
  assert.equal('kokoro' in status, false)
})

test('validates synthesis input before calling the provider', async () => {
  await assert.rejects(
    () => synthesizeTts({ engine: 'edge', text: '   ', voice: 'zh-CN-XiaoxiaoNeural', rate: 1 }),
    /没有可合成的文字/,
  )
  await assert.rejects(
    () => synthesizeTts({ engine: 'edge', text: '字'.repeat(2001), voice: 'zh-CN-XiaoxiaoNeural', rate: 1 }),
    /太长/,
  )
  await assert.rejects(
    () => synthesizeTts({ engine: 'edge', text: '你好', voice: 'not-a-voice', rate: 1 }),
    /不支持的 Edge 音色/,
  )
})
