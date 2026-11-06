import fs from 'node:fs'
import path from 'node:path'

import { safeStorage } from 'electron'

import { PROVIDER_PRESETS } from '../shared/types.js'
import type { GenerationMode, ProviderId, SettingsPatch, SettingsView } from '../shared/types.js'
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
  notesModel: string
  composeModel: string
  labModel: string
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
  notesModel: '',
  composeModel: '',
  labModel: '',
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

function readFile(): StoredSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<StoredSettings>
    return {
      version: 1,
      provider: (raw.provider ?? DEFAULT_SETTINGS.provider) as ProviderId,
      baseUrl: raw.baseUrl ?? '',
      model: raw.model ?? DEFAULT_SETTINGS.model,
      generationMode: normalizeMode(raw.generationMode),
      notesModel: typeof raw.notesModel === 'string' ? raw.notesModel : '',
      composeModel: typeof raw.composeModel === 'string' ? raw.composeModel : '',
      labModel: typeof raw.labModel === 'string' ? raw.labModel : '',
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
    notesModel: current.notesModel,
    composeModel: current.composeModel,
    labModel: current.labModel,
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
  if (patch.notesModel !== undefined) current.notesModel = patch.notesModel.trim()
  if (patch.composeModel !== undefined) current.composeModel = patch.composeModel.trim()
  if (patch.labModel !== undefined) current.labModel = patch.labModel.trim()
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
