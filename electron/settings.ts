import fs from 'node:fs'
import path from 'node:path'

import { safeStorage } from 'electron'

import { PROVIDER_PRESETS } from '../shared/types.js'
import type { GenerationMode, ProviderId, SettingsPatch, SettingsView } from '../shared/types.js'

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
  keys: Partial<Record<ProviderId, StoredKey>>
}

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

export function getReadwiseToken(): string | null {
  return readStoredKey(settings().readwise)
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
  if (patch.apiKey && patch.apiKey.trim()) {
    current.keys[patch.provider] = encodeKey(patch.apiKey.trim())
  }
  persist()
  return getSettingsView()
}

export function isDemoMode(): boolean {
  return settings().provider === 'demo'
}
