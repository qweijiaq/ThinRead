import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

import type { ProviderId } from '../../shared/types.js'

export interface ModelConfig {
  provider: ProviderId
  baseUrl: string
  model: string
  apiKey: string | null
}

export function createLanguageModel(config: ModelConfig): LanguageModel {
  if (!config.model.trim()) throw new Error('还没有填写模型名称。')
  if (config.provider === 'demo') throw new Error('演示模式不调用真实模型。')

  if (config.provider === 'anthropic') {
    const provider = createAnthropic({
      apiKey: config.apiKey ?? '',
      ...(config.baseUrl.trim() ? { baseURL: config.baseUrl.trim() } : {}),
    })
    return provider(config.model)
  }

  if (!config.baseUrl.trim()) throw new Error('还没有填写 Base URL。')
  if (!config.apiKey && config.provider !== 'ollama') throw new Error('还没有配置 API Key。')

  const provider = createOpenAICompatible({
    name: config.provider,
    baseURL: config.baseUrl.trim(),
    apiKey: config.apiKey ?? 'local',
    includeUsage: true,
  })
  return provider(config.model)
}
