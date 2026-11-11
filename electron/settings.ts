import fs from 'node:fs'
import path from 'node:path'

import { safeStorage } from 'electron'

import { PROVIDER_PRESETS, REFERENCE_AI_PRICING } from '../shared/types.js'
import type { AiModelPricing, GenerationMode, NotesLanguage, ProviderId, SettingsPatch, SettingsView, VisionMode } from '../shared/types.js'
import { createAppLock, isUsablePasscode, verifyAppLock, type AppLockRecord } from './app-lock.js'

interface StoredKey {
  enc?: string
  plain?: string
  hint?: string
}

interface StoredSettings {
  version: number
  provider: ProviderId
  baseUrl: string
  model: string
  generationMode: GenerationMode
  notesLanguage: NotesLanguage
  visionMode: VisionMode
  notesModel: string
  composeModel: string
  labModel: string
  aiPricing?: AiModelPricing
  aiBudget?: { monthlyCny: number; enabled: boolean }
  syncFolder?: string
  readwise?: StoredKey
  ui?: {
    autoNext?: boolean
    dailyGoal?: number
  }
  lock?: AppLockRecord
  qwenTts?: {
    baseUrl: string
    model: string
    voiceA: string
    voiceB: string
    voiceEn: string
    pricePerK: number
    voices: string[]
    key?: StoredKey
  }
  keys: Partial<Record<ProviderId, StoredKey>>
}

export const QWEN_TTS_DEFAULTS = {
  baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  model: 'qwen-audio-3.1-tts-flash',
  voiceA: 'longanhuan_v3.1',
  voiceB: 'xunanchuan_v3.1',
  voiceEn: 'Emily_v3.1',
  pricePerK: 0,
} as const

let filePath = ''
let cached: StoredSettings | null = null

const DEFAULT_SETTINGS: StoredSettings = {
  version: 1,
  provider: 'demo',
  baseUrl: '',
  model: 'demo',
  generationMode: 'standard',
  notesLanguage: 'zh',
  visionMode: 'auto',
  notesModel: '',
  composeModel: '',
  labModel: '',
  aiBudget: { monthlyCny: 0, enabled: false },
  syncFolder: '',
  keys: {},
}

export function initSettings(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true })
  filePath = path.join(dataDir, 'settings.json')
  cached = readFile()
}

function normalizeMode(value: unknown): GenerationMode {
  return value === 'fast' || value === 'deep' ? value : 'standard'
}

function normalizeNotesLanguage(value: unknown): NotesLanguage {
  return value === 'source' ? 'source' : 'zh'
}

function normalizeVisionMode(value: unknown): VisionMode {
  return value === 'always' || value === 'off' ? value : 'auto'
}

/** 只接受非负数字；价格按人民币 / 百万 token 保存。 */
export function normalizeAiPricing(value: unknown): AiModelPricing {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: AiModelPricing = {}
  for (const [model, raw] of Object.entries(value as Record<string, unknown>)) {
    const id = model.trim()
    if (!id || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    const input = Math.max(0, Number(row.inputPerMTokens) || 0)
    const output = Math.max(0, Number(row.outputPerMTokens) || 0)
    if (input === 0 && output === 0) continue
    result[id] = { inputPerMTokens: input, outputPerMTokens: output }
  }
  return result
}

function normalizeAiBudget(value: unknown): { monthlyCny: number; enabled: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { monthlyCny: 0, enabled: false }
  const row = value as Record<string, unknown>
  return {
    monthlyCny: Math.max(0, Number(row.monthlyCny) || 0),
    enabled: row.enabled === true,
  }
}

function readFile(): StoredSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<StoredSettings>
    return {
      version: 1,
      provider: (raw.provider ?? DEFAULT_SETTINGS.provider) as ProviderId,
      baseUrl: raw.baseUrl ?? '',
      model: raw.model ?? DEFAULT_SETTINGS.model,
      generationMode: normalizeMode(raw.generationMode),
      notesLanguage: normalizeNotesLanguage(raw.notesLanguage),
      visionMode: normalizeVisionMode(raw.visionMode),
      notesModel: typeof raw.notesModel === 'string' ? raw.notesModel : '',
      composeModel: typeof raw.composeModel === 'string' ? raw.composeModel : '',
      labModel: typeof raw.labModel === 'string' ? raw.labModel : '',
      aiPricing: normalizeAiPricing(raw.aiPricing),
      aiBudget: normalizeAiBudget(raw.aiBudget),
      syncFolder: typeof raw.syncFolder === 'string' ? raw.syncFolder : '',
      readwise: raw.readwise,
      ui: raw.ui,
      lock: raw.lock,
      qwenTts: raw.qwenTts,
      keys: raw.keys ?? {},
    }
  } catch {
    return { ...DEFAULT_SETTINGS, keys: {} }
  }
}

function settings(): StoredSettings {
  if (!cached) throw new Error('设置尚未初始化')
  return cached
}

function persist(): void {
  fs.writeFileSync(filePath, JSON.stringify(settings(), null, 2), { mode: 0o600 })
}

export function getActiveSettings(task?: 'notes' | 'compose' | 'lab'): {
  provider: ProviderId
  baseUrl: string
  model: string
  apiKey: string | null
  generationMode: GenerationMode
  notesLanguage: NotesLanguage
  visionMode: VisionMode
} {
  const current = settings()
  const model =
    task === 'notes' ? current.notesModel || current.model
      : task === 'compose' ? current.composeModel || current.model
        : task === 'lab' ? current.labModel || current.model
          : current.model
  return {
    provider: current.provider,
    baseUrl: current.baseUrl,
    model,
    apiKey: readKey(current.provider),
    generationMode: current.generationMode,
    notesLanguage: current.notesLanguage,
    visionMode: current.visionMode,
  }
}

function readStoredKey(stored: StoredKey | undefined): string | null {
  if (!stored) return null
  if (stored.enc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.enc, 'base64'))
    } catch {
      return null
    }
  }
  return stored.plain ?? null
}

function readKey(provider: ProviderId): string | null {
  return readStoredKey(settings().keys[provider])
}

/** 供模型列表等只读操作使用；不把 Key 暴露给渲染进程。 */
export function getProviderApiKey(provider: ProviderId): string | null {
  return readKey(provider)
}

/** 已配置 Key 的服务商；用于自动寻找可用的视觉模型。 */
export function getConfiguredProviders(): ProviderId[] {
  const current = settings()
  return (Object.keys(current.keys) as ProviderId[]).filter((provider) => Boolean(readKey(provider)))
}

/** 备份跨机器恢复时，safeStorage 加密的 Key 可能解不开；只提示重填，不回传明文。 */
function needsReentry(stored: StoredKey | undefined): boolean {
  return Boolean(stored?.enc) && readStoredKey(stored) === null
}

function anyKeyNeedsReentry(): boolean {
  const current = settings()
  return (
    Object.values(current.keys).some((stored) => needsReentry(stored)) ||
    needsReentry(current.readwise) ||
    needsReentry(current.qwenTts?.key)
  )
}

export function getAiPricing(): AiModelPricing {
  // 用户填写优先；没填过的模型使用内置参考价，打开统计页就能看到估算费用。
  return { ...REFERENCE_AI_PRICING, ...normalizeAiPricing(settings().aiPricing) }
}

export function getAiBudget(): { monthlyCny: number; enabled: boolean } {
  return normalizeAiBudget(settings().aiBudget)
}

export function setSyncFolder(folder: string): void {
  const current = settings()
  current.syncFolder = folder.trim()
  persist()
}

export function getReadwiseToken(): string | null {
  return readStoredKey(settings().readwise)
}

function resolveQwenVoiceB(voiceA: string, voiceB: string | undefined): string {
  if (voiceB && voiceB.trim() && voiceB !== voiceA) return voiceB
  return voiceA === QWEN_TTS_DEFAULTS.voiceB ? QWEN_TTS_DEFAULTS.voiceA : QWEN_TTS_DEFAULTS.voiceB
}

export function getQwenTtsConfig(): {
  baseUrl: string
  model: string
  voiceA: string
  voiceB: string
  voiceEn: string
  pricePerK: number
  apiKey: string | null
} {
  const tts = settings().qwenTts
  return {
    baseUrl: tts?.baseUrl || QWEN_TTS_DEFAULTS.baseUrl,
    model: tts?.model || QWEN_TTS_DEFAULTS.model,
    voiceA: tts?.voiceA || QWEN_TTS_DEFAULTS.voiceA,
    voiceB: resolveQwenVoiceB(tts?.voiceA || QWEN_TTS_DEFAULTS.voiceA, tts?.voiceB),
    voiceEn: typeof tts?.voiceEn === 'string' ? tts.voiceEn : QWEN_TTS_DEFAULTS.voiceEn,
    pricePerK: Math.max(0, Number(tts?.pricePerK) || 0),
    // 和 english-penpal 一样：TTS Key 留空时复用阿里云百炼主 Key。
    apiKey: readStoredKey(tts?.key) ?? readKey('alibaba'),
  }
}

export function getQwenTtsVoices(): string[] {
  const tts = settings().qwenTts
  const defaults = [
    'longanhuan_v3.1',
    'xunanchuan_v3.1',
    'longanlingxin_v3.1',
    'longanfengyue_v3.1',
    'anmingyuan_v3.1',
    'yeqinghe_v3.1',
    'longcheng_v3.1',
    'Emily_v3.1',
    'Eric_v3.1',
  ]
  const values = [
    ...defaults,
    ...(tts?.voices ?? []),
    tts?.voiceA ?? '',
    tts?.voiceB ?? '',
    tts?.voiceEn ?? '',
  ]
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function getAppLockEnabled(): boolean {
  return Boolean(settings().lock?.salt && settings().lock?.hash)
}

export function verifyAppLockPasscode(passcode: string): boolean {
  return verifyAppLock(passcode, settings().lock)
}

export function setAppLockPasscode(passcode: string | null): boolean {
  if (passcode === null) {
    delete settings().lock
    persist()
    return false
  }
  if (!isUsablePasscode(passcode)) throw new Error('应用锁密码至少 4 个字符。')
  settings().lock = createAppLock(passcode.trim())
  persist()
  return true
}

export function getUiPreferences(): { autoNext: boolean; dailyGoal: number; configured: boolean } {
  const ui = settings().ui
  const dailyGoal = Math.floor(Number(ui?.dailyGoal) || 0)
  return {
    autoNext: ui?.autoNext === true,
    dailyGoal: dailyGoal > 0 ? Math.min(240, dailyGoal) : 0,
    configured: ui !== undefined,
  }
}

export function saveUiPreferences(patch: { autoNext?: boolean; dailyGoal?: number }): {
  autoNext: boolean
  dailyGoal: number
  configured: boolean
} {
  const current = settings()
  current.ui = {
    autoNext: patch.autoNext === undefined ? current.ui?.autoNext === true : patch.autoNext === true,
    dailyGoal:
      patch.dailyGoal === undefined
        ? Math.max(0, Math.min(240, Math.floor(Number(current.ui?.dailyGoal) || 0)))
        : Math.max(0, Math.min(240, Math.floor(Number(patch.dailyGoal) || 0))),
  }
  persist()
  return getUiPreferences()
}

function encodeKey(apiKey: string): StoredKey {
  const hint = apiKey.length <= 8 ? '****' : `••••${apiKey.slice(-4)}`
  if (safeStorage.isEncryptionAvailable()) {
    return { enc: safeStorage.encryptString(apiKey).toString('base64'), hint }
  }
  return { plain: apiKey, hint }
}

export function getSettingsView(): SettingsView {
  const current = settings()
  const stored = current.keys[current.provider]
  const demo = current.provider === 'demo'
  return {
    provider: current.provider,
    baseUrl: current.baseUrl,
    model: current.model,
    apiKeyConfigured: demo || readKey(current.provider) !== null,
    apiKeyHint: demo ? '演示模式' : (stored?.hint ?? ''),
    demo,
    generationMode: current.generationMode,
    notesLanguage: current.notesLanguage,
    visionMode: current.visionMode,
    notesModel: current.notesModel,
    composeModel: current.composeModel,
    labModel: current.labModel,
    aiPricing: getAiPricing(),
    aiBudgetEnabled: getAiBudget().enabled,
    aiBudgetMonthlyCny: getAiBudget().monthlyCny,
    syncFolder: current.syncFolder ?? '',
    readwiseConfigured: readStoredKey(current.readwise) !== null,
    keysNeedReentry: anyKeyNeedsReentry(),
    appLockEnabled: getAppLockEnabled(),
    qwenTtsConfigured: readStoredKey(current.qwenTts?.key) !== null || readKey('alibaba') !== null,
    qwenTtsBaseUrl: current.qwenTts?.baseUrl || QWEN_TTS_DEFAULTS.baseUrl,
    qwenTtsModel: current.qwenTts?.model || QWEN_TTS_DEFAULTS.model,
    qwenTtsVoiceA: current.qwenTts?.voiceA || QWEN_TTS_DEFAULTS.voiceA,
    qwenTtsVoiceB: resolveQwenVoiceB(
      current.qwenTts?.voiceA || QWEN_TTS_DEFAULTS.voiceA,
      current.qwenTts?.voiceB,
    ),
    qwenTtsVoiceEn: typeof current.qwenTts?.voiceEn === 'string' ? current.qwenTts.voiceEn : QWEN_TTS_DEFAULTS.voiceEn,
    qwenTtsPricePerK: Math.max(0, Number(current.qwenTts?.pricePerK) || 0),
    qwenTtsVoices: getQwenTtsVoices(),
  }
}

export function saveSettings(patch: SettingsPatch): SettingsView {
  const current = settings()
  const providerChanged = patch.provider !== current.provider

  if (providerChanged && patch.baseUrl === '' && patch.model === '') {
    const preset = PROVIDER_PRESETS.find((item) => item.id === patch.provider)
    patch = {
      ...patch,
      baseUrl: preset?.baseUrl ?? '',
      model: preset?.defaultModel ?? current.model,
    }
  }

  current.provider = patch.provider
  current.baseUrl = patch.baseUrl.trim()
  current.model = patch.model.trim()
  if (patch.generationMode) current.generationMode = normalizeMode(patch.generationMode)
  if (patch.notesLanguage) current.notesLanguage = normalizeNotesLanguage(patch.notesLanguage)
  if (patch.visionMode) current.visionMode = normalizeVisionMode(patch.visionMode)
  if (patch.notesModel !== undefined) current.notesModel = patch.notesModel.trim()
  if (patch.composeModel !== undefined) current.composeModel = patch.composeModel.trim()
  if (patch.labModel !== undefined) current.labModel = patch.labModel.trim()
  if (patch.aiPricing !== undefined) current.aiPricing = normalizeAiPricing(patch.aiPricing)
  if (patch.aiBudgetEnabled !== undefined || patch.aiBudgetMonthlyCny !== undefined) {
    const previous = normalizeAiBudget(current.aiBudget)
    current.aiBudget = normalizeAiBudget({
      enabled: patch.aiBudgetEnabled ?? previous.enabled,
      monthlyCny: patch.aiBudgetMonthlyCny ?? previous.monthlyCny,
    })
  }
  if (patch.readwiseToken && patch.readwiseToken.trim()) {
    current.readwise = encodeKey(patch.readwiseToken.trim())
  }
  if (
    patch.qwenTtsBaseUrl !== undefined ||
    patch.qwenTtsModel !== undefined ||
    patch.qwenTtsVoiceA !== undefined ||
    patch.qwenTtsVoiceB !== undefined ||
    patch.qwenTtsVoiceEn !== undefined ||
    patch.qwenTtsPricePerK !== undefined ||
    patch.qwenTtsVoices !== undefined ||
    patch.qwenTtsKey !== undefined
  ) {
    const voiceA = (patch.qwenTtsVoiceA ?? current.qwenTts?.voiceA ?? QWEN_TTS_DEFAULTS.voiceA).trim()
    const voiceB = (patch.qwenTtsVoiceB ?? current.qwenTts?.voiceB ?? QWEN_TTS_DEFAULTS.voiceB).trim()
    const voiceEn = (patch.qwenTtsVoiceEn ?? current.qwenTts?.voiceEn ?? QWEN_TTS_DEFAULTS.voiceEn).trim()
    const library = [
      ...(patch.qwenTtsVoices ?? current.qwenTts?.voices ?? []),
      voiceA,
      voiceB,
      voiceEn,
      QWEN_TTS_DEFAULTS.voiceA,
    ]
      .map((value) => value.trim())
      .filter(Boolean)
    current.qwenTts = {
      baseUrl: (patch.qwenTtsBaseUrl ?? current.qwenTts?.baseUrl ?? QWEN_TTS_DEFAULTS.baseUrl).trim(),
      model: (patch.qwenTtsModel ?? current.qwenTts?.model ?? QWEN_TTS_DEFAULTS.model).trim(),
      voiceA,
      voiceB,
      voiceEn,
      pricePerK: Math.max(
        0,
        Number(patch.qwenTtsPricePerK ?? current.qwenTts?.pricePerK ?? QWEN_TTS_DEFAULTS.pricePerK) || 0,
      ),
      voices: [...new Set(library)],
      key:
        patch.qwenTtsKey && patch.qwenTtsKey.trim()
          ? encodeKey(patch.qwenTtsKey.trim())
          : current.qwenTts?.key,
    }
  }
  if (patch.apiKey && patch.apiKey.trim()) {
    current.keys[patch.provider] = encodeKey(patch.apiKey.trim())
  }
  persist()
  return getSettingsView()
}

export function isDemoMode(): boolean {
  return settings().provider === 'demo'
}
