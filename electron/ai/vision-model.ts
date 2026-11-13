import { PROVIDER_PRESETS } from '../../shared/types.js'
import type { ModelConfig } from './provider.js'
import type { ProviderId } from '../../shared/types.js'
import { listProviderModels } from './models.js'
import { supportsVision } from './note-images.js'
import { getActiveSettings, getConfiguredProviders, getProviderApiKey } from '../settings.js'

/** 从便宜到贵的视觉模型候选；只使用服务商 /models 里实际存在的型号。 */
const VISION_CANDIDATES: Partial<Record<ProviderId, string[]>> = {
  alibaba: [
    'qwen3.5-omni-flash',
    'qwen3.8-omni-flash',
    'qwen3-vl-plus',
    'qwen3.5-omni-plus',
    'qwen-vl-plus',
    'qwen-vl-max',
    'qwen-vl-ocr',
  ],
  zhipu: ['glm-4.6v', 'glm-4v-flash', 'glm-4v-plus'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-5.6-sol', 'gpt-5'],
  anthropic: ['claude-haiku-5-5', 'claude-haiku-5', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-opus-5'],
  'opencode-go': ['gemini-4-argon', 'claude-haiku-5-5', 'claude-haiku-5', 'gpt-4o-mini', 'gpt-4o', 'gemini-2.5-flash'],
  opencode: ['gemini-4-argon', 'claude-haiku-5-5', 'claude-haiku-5', 'gpt-4o-mini', 'gpt-4o', 'gemini-2.5-flash'],
  openrouter: ['google/gemini-2.5-flash', 'openai/gpt-4o-mini', 'openai/gpt-4o', 'anthropic/claude-haiku-5'],
  opendesign: ['deepseek-v4-flash', 'claude-haiku-5-5', 'gpt-6-luna'],
  moonshot: ['moonshot-v1-8k-vision-preview', 'moonshot-v1-32k-vision-preview', 'kimi-latest'],
  ollama: ['qwen3-vl', 'qwen2.5vl', 'llava', 'minicpm-v', 'gemma3'],
  lmstudio: ['qwen3-vl', 'qwen2.5vl', 'llava', 'minicpm-v', 'gemma3'],
}

const PROVIDER_ORDER: ProviderId[] = [
  'alibaba',
  'zhipu',
  'openai',
  'anthropic',
  'opencode-go',
  'opencode',
  'opendesign',
  'openrouter',
  'moonshot',
  'ollama',
  'lmstudio',
]

export interface ResolvedVisionModel {
  config: ModelConfig
  provider: ProviderId
  model: string
  fallback: boolean
}

function presetBaseUrl(provider: ProviderId): string {
  return PROVIDER_PRESETS.find((item) => item.id === provider)?.baseUrl ?? ''
}

function modelMatches(available: string[], candidate: string): boolean {
  const needle = candidate.toLowerCase()
  return available.some((model) => model.toLowerCase() === needle)
}

/**
 * 优先用当前模型；不支持图片时，在已配置 Key 的服务商里找一个实际可用的视觉模型。
 * 候选按“便宜优先”排序，避免默认落到最贵的旗舰模型。
 */
export async function resolveVisionModel(exclude?: { provider: ProviderId; model: string }): Promise<ResolvedVisionModel> {
  const active = getActiveSettings('notes')
  const activeConfig: ModelConfig = {
    provider: active.provider,
    baseUrl: active.baseUrl,
    model: active.model,
    apiKey: active.apiKey,
  }
  if (
    active.provider !== 'demo' &&
    active.apiKey &&
    supportsVision(activeConfig) &&
    !(exclude?.provider === active.provider && exclude.model === active.model)
  ) {
    return { config: activeConfig, provider: active.provider, model: active.model, fallback: false }
  }

  const configured = new Set(getConfiguredProviders())
  // 当前模型不是视觉模型时，不优先当前服务商；按候选价格从低到高找。
  const order = PROVIDER_ORDER.filter((provider) => configured.has(provider))

  for (const provider of order) {
    const candidates = VISION_CANDIDATES[provider] ?? []
    if (candidates.length === 0) continue
    const apiKey = getProviderApiKey(provider)
    if (!apiKey) continue
    const baseUrl = provider === active.provider ? active.baseUrl : presetBaseUrl(provider)
    if (!baseUrl) continue
    const listed = await listProviderModels({ provider, baseUrl, apiKey })
    if (listed.models.length === 0) continue
    const model = candidates.find(
      (candidate) =>
        modelMatches(listed.models, candidate) &&
        !(exclude?.provider === provider && exclude.model === candidate),
    )
    if (!model) continue
    return {
      config: { provider, baseUrl, model, apiKey },
      provider,
      model,
      fallback: true,
    }
  }

  throw new Error(
    '没有找到可用的视觉模型。请在设置里给至少一个支持图片的服务商配置 Key（例如百炼的 Qwen-VL、OpenAI 的 gpt-4o、Claude），或把「图片理解」改成“总是发送”。',
  )
}
