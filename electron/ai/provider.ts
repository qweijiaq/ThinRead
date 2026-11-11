import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

import type { ProviderId } from '../../shared/types.js'
import { clientRequestHeaders } from './client-identity.js'

export interface ModelConfig {
  provider: ProviderId
  baseUrl: string
  model: string
  apiKey: string | null
}

/**
 * DeepSeek V4 默认开启思考模式，会把输出预算花在 reasoning 上，导致 JSON 被截断、
 * 单章生成从几十秒变成十几分钟。读薄/卡片这类结构化任务显式关闭思考。
 * 只对 DeepSeek 模型生效；其他模型保持服务商默认。
 */
export function nonThinkingProviderOptions(
  config: ModelConfig,
): Record<string, { thinking: { type: 'disabled' } }> | undefined {
  if (!/deepseek/i.test(config.model)) return undefined
  if (config.provider !== 'deepseek' && config.provider !== 'opencode' && config.provider !== 'opencode-go') {
    return undefined
  }
  const optionKey = config.provider === 'opencode-go' ? 'opencodeGo' : config.provider
  return { [optionKey]: { thinking: { type: 'disabled' } } }
}

export function createLanguageModel(config: ModelConfig): LanguageModel {
  if (!config.model.trim()) throw new Error('还没有填写模型名称。')
  if (config.provider === 'demo') throw new Error('演示模式不调用真实模型。')

  const headers = clientRequestHeaders(config.provider)

  if (config.provider === 'anthropic') {
    const provider = createAnthropic({
      apiKey: config.apiKey ?? '',
      headers,
      ...(config.baseUrl.trim() ? { baseURL: config.baseUrl.trim() } : {}),
    })
    return provider(config.model)
  }

  if (!config.baseUrl.trim()) throw new Error('还没有填写 Base URL。')
  if (!config.apiKey && config.provider !== 'ollama' && config.provider !== 'lmstudio') throw new Error('还没有配置 API Key。')

  const provider = createOpenAICompatible({
    name: config.provider,
    baseURL: config.baseUrl.trim(),
    apiKey: config.apiKey ?? 'local',
    headers,
    includeUsage: true,
  })
  return provider(config.model)
}
