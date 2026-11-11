import { PROVIDER_PRESETS } from '../../shared/types.js'
import type { AiModelListInput, AiModelListResult, ProviderId } from '../../shared/types.js'
import { clientRequestHeaders } from './client-identity.js'

function trimBase(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function endpointFor(provider: ProviderId, baseUrl: string): string {
  const base = trimBase(baseUrl)
  if (provider === 'anthropic') {
    const root = base || 'https://api.anthropic.com'
    return /\/v1$/i.test(root) ? `${root}/models` : `${root}/v1/models`
  }
  return `${base}/models`
}

function extractModels(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          const row = item as Record<string, unknown>
          return typeof row.id === 'string' ? row.id : typeof row.name === 'string' ? row.name : ''
        }
        return ''
      })
      .filter(Boolean)
  }
  if (payload && typeof payload === 'object') {
    const object = payload as Record<string, unknown>
    for (const key of ['data', 'models', 'items']) {
      if (Array.isArray(object[key])) return extractModels(object[key])
    }
  }
  return []
}

/** 从服务商的 /models 端点读取可用模型；失败时返回可读错误，不抛异常。 */
export async function listProviderModels(input: AiModelListInput): Promise<AiModelListResult> {
  const provider = input.provider ?? 'demo'
  const preset = PROVIDER_PRESETS.find((item) => item.id === provider)
  if (!preset || provider === 'demo') return { models: [], error: '演示模式没有模型列表。' }

  const baseUrl = trimBase(input.baseUrl ?? '') || preset.baseUrl
  if (!baseUrl) return { models: [], error: '还没有填写 Base URL。' }

  const apiKey = input.apiKey?.trim() || ''
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...clientRequestHeaders(provider),
  }
  if (provider === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  try {
    const response = await fetch(endpointFor(provider, baseUrl), {
      headers,
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)
      return {
        models: [],
        error: `读取模型列表失败：HTTP ${response.status}${detail ? ` ${detail}` : ''}`,
      }
    }
    const payload = (await response.json().catch(() => null)) as unknown
    const models = [...new Set(extractModels(payload).map((id) => id.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'en'),
    )
    return models.length > 0 ? { models } : { models: [], error: '服务返回了空的模型列表。' }
  } catch (error) {
    return {
      models: [],
      error: `读取模型列表失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
