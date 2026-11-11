import { bridge } from '../lib/bridge.js'
import { useEffect, useState, type JSX } from 'react'

import { AI_PRICING_REFERENCE_DATE, PROVIDER_PRESETS } from '../../shared/types.js'
import { BUILTIN_EXTENSIONS } from '../../shared/extensions.js'
import type {
  AppInfo,
  BackupInfo,
  GenerationMode,
  NotesLanguage,
  ProviderId,
  ReaderStyle,
  SettingsView,
  SyncStatus,
  TestResult,
  VisionMode,
} from '../../shared/types.js'
import { setLocale, t, useLocale } from '../lib/i18n.js'
import { getAutoNext, getDailyGoal, setAutoNext, setDailyGoal } from '../lib/preferences.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import { Checkbox } from './Checkbox.js'
import { confirmDialog } from './ConfirmDialog.js'
import { Select } from './Select.js'

interface SettingsDialogProps {
  open: boolean
  settings: SettingsView
  appInfo: AppInfo | null
  theme: ReaderStyle['theme']
  onClose(): void
  onSaved(settings: SettingsView, options?: { silent?: boolean }): void
  onTestResult?(result: TestResult): void
  onThemeChange(theme: ReaderStyle['theme']): void
  onOpenManual(): void
  onOpenOnboarding(): void
  coreMode: boolean
  onToggleCoreMode(value: boolean): void
}

const THEME_OPTIONS: Array<[ReaderStyle['theme'], string]> = [
  ['folio', t('墨蓝')],
  ['paper', t('纸色')],
  ['plain', t('纯白')],
  ['warm', t('暖色')],
]

const MODE_OPTIONS: Array<[GenerationMode, string]> = [
  ['fast', t('快速')],
  ['standard', t('标准')],
  ['deep', t('精读')],
]

const MODE_HINTS: Record<GenerationMode, string> = {
  fast: t('跳过断言回查和卡片延伸，最快、最省 token；适合先看结构。'),
  standard: t('读薄、回查、卡片延伸都保留，速度和质量的默认平衡。'),
  deep: t('额外做一轮全局回查，并保留全部延伸；适合重要章节。'),
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  if (value >= 1024) return `${Math.round(value / 1024)} KB`
  return `${value} B`
}

function formatBackupTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function SettingsDialog({
  open,
  settings,
  appInfo,
  theme,
  onClose,
  onSaved,
  onTestResult,
  onThemeChange,
  onOpenManual,
  onOpenOnboarding,
  coreMode,
  onToggleCoreMode,
}: SettingsDialogProps): JSX.Element | null {
  const [provider, setProvider] = useState<ProviderId>(settings.provider)
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [model, setModel] = useState(settings.model)
  const [apiKey, setApiKey] = useState('')
  const [generationMode, setGenerationMode] = useState<GenerationMode>(settings.generationMode)
  const [notesLanguage, setNotesLanguage] = useState<NotesLanguage>(settings.notesLanguage)
  const [visionMode, setVisionMode] = useState<VisionMode>(settings.visionMode)
  const [notesModel, setNotesModel] = useState(settings.notesModel)
  const [composeModel, setComposeModel] = useState(settings.composeModel)
  const [labModel, setLabModel] = useState(settings.labModel)
  const [aiPricing, setAiPricing] = useState<Record<string, { input: string; output: string }>>({})
  const [aiBudgetEnabled, setAiBudgetEnabled] = useState(settings.aiBudgetEnabled)
  const [aiBudgetMonthly, setAiBudgetMonthly] = useState(String(settings.aiBudgetMonthlyCny || ''))
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelListLoading, setModelListLoading] = useState(false)
  const [detectingLocal, setDetectingLocal] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [modelListError, setModelListError] = useState<string | null>(null)
  const [readwiseToken, setReadwiseToken] = useState('')
  const [readwiseTest, setReadwiseTest] = useState<TestResult | null>(null)
  const [qwenTtsBaseUrl, setQwenTtsBaseUrl] = useState(settings.qwenTtsBaseUrl)
  const [qwenTtsModel, setQwenTtsModel] = useState(settings.qwenTtsModel)
  const [qwenTtsVoiceA, setQwenTtsVoiceA] = useState(settings.qwenTtsVoiceA)
  const [qwenTtsVoiceB, setQwenTtsVoiceB] = useState(settings.qwenTtsVoiceB)
  const [qwenTtsVoiceEn, setQwenTtsVoiceEn] = useState(settings.qwenTtsVoiceEn)
  const [qwenTtsPricePerK, setQwenTtsPricePerK] = useState(String(settings.qwenTtsPricePerK || ''))
  const [qwenTtsVoices, setQwenTtsVoices] = useState<string[]>(settings.qwenTtsVoices)
  const [lockPasscode, setLockPasscode] = useState('')
  const [lockTest, setLockTest] = useState<TestResult | null>(null)
  const [newVoice, setNewVoice] = useState('')
  const [qwenTtsKey, setQwenTtsKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const locale = useLocale()
  const [dailyGoal, setDailyGoalState] = useState(getDailyGoal)
  const [autoNext, setAutoNextState] = useState(getAutoNext)
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose, 'input, select, textarea')
  const [backupBusy, setBackupBusy] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [backupNotice, setBackupNotice] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [syncBusy, setSyncBusy] = useState<string | null>(null)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const [syncPassphrase, setSyncPassphrase] = useState('')

  useEffect(() => {
    if (!open) return
    setProvider(settings.provider)
    setBaseUrl(settings.baseUrl)
    setModel(settings.model)
    setApiKey('')
    setGenerationMode(settings.generationMode)
    setNotesLanguage(settings.notesLanguage)
    setVisionMode(settings.visionMode)
    setNotesModel(settings.notesModel)
    setComposeModel(settings.composeModel)
    setLabModel(settings.labModel)
    setAvailableModels([])
    setModelListError(null)
    setAiPricing(
      Object.fromEntries(
        Object.entries(settings.aiPricing).map(([id, price]) => [
          id,
          {
            input: price.inputPerMTokens ? String(price.inputPerMTokens) : '',
            output: price.outputPerMTokens ? String(price.outputPerMTokens) : '',
          },
        ]),
      ),
    )
    setAiBudgetEnabled(settings.aiBudgetEnabled)
    setAiBudgetMonthly(String(settings.aiBudgetMonthlyCny || ''))
    setReadwiseToken('')
    setReadwiseTest(null)
    setQwenTtsBaseUrl(settings.qwenTtsBaseUrl)
    setQwenTtsModel(settings.qwenTtsModel)
    setQwenTtsVoiceA(settings.qwenTtsVoiceA)
    setQwenTtsVoiceB(settings.qwenTtsVoiceB)
    setQwenTtsVoiceEn(settings.qwenTtsVoiceEn)
    setQwenTtsPricePerK(String(settings.qwenTtsPricePerK || ''))
    setQwenTtsVoices(settings.qwenTtsVoices)
    setNewVoice('')
    setSyncNotice(null)
    void bridge.getSyncStatus().then(setSyncStatus).catch(() => setSyncStatus(null))
    setLockPasscode('')
    setLockTest(null)
    setQwenTtsKey('')
    setResult(null)
    setBackupError(null)
    setBackupNotice(null)
    setBackupBusy(null)
    void bridge
      .listBackups()
      .then(setBackups)
      .catch((error: unknown) => {
        setBackupError(error instanceof Error ? error.message : String(error))
      })
    // 只在打开设置时同步一次；保存/测试连接会更新 settings，不能因此重置正在编辑的表单和测试结果。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    if (provider === 'demo') {
      setAvailableModels([])
      setModelListError(null)
      return
    }
    const canQuery =
      settings.apiKeyConfigured ||
      provider === 'ollama' ||
      provider === 'lmstudio' ||
      provider === 'openrouter' ||
      provider === 'opencode' ||
      provider === 'opencode-go'
    if (canQuery) void refreshModels(false)
    // 只在打开设置或切换服务商时自动读取，避免输入 Base URL 时反复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider])

  if (!open) return null

  const preset = PROVIDER_PRESETS.find((item) => item.id === provider)
  const priceModels = [...new Set([model, notesModel, composeModel, labModel].map((value) => value.trim()).filter((value) => value && value !== 'demo'))]
  const modelOptions = [
    ...new Set(
      [
        ...availableModels,
        ...(preset?.suggestedModels ?? []),
        model,
        notesModel,
        composeModel,
        labModel,
      ]
        .map((value) => value.trim())
        .filter((value) => value && value !== 'demo'),
    ),
  ]

  async function refreshModels(manual = false): Promise<void> {
    if (provider === 'demo') {
      setAvailableModels([])
      setModelListError(null)
      return
    }
    setModelListLoading(true)
    if (manual) setModelListError(null)
    try {
      const result = await bridge.listAiModels({
        provider,
        baseUrl,
        apiKey: apiKey.trim() || undefined,
      })
      setAvailableModels(result.models)
      setModelListError(result.error ?? null)
      if (manual && result.models.length > 0) {
        setResult({ ok: true, message: `${t('已读取')} ${result.models.length} ${t('个可用模型。')}` })
      }
    } catch (error) {
      setModelListError(error instanceof Error ? error.message : String(error))
    } finally {
      setModelListLoading(false)
    }
  }

  async function detectLocalModels(): Promise<void> {
    setDetectingLocal(true)
    setResult(null)
    try {
      const found = await bridge.detectLocalModels()
      if (found.ollama.length > 0) {
        changeProvider('ollama')
        setBaseUrl('http://127.0.0.1:11434/v1')
        setModel(found.ollama[0]!)
        setAvailableModels(found.ollama)
        setResult({
          ok: true,
          message: `${t('检测到本机 Ollama，共')} ${found.ollama.length} ${t('个模型。')}`,
        })
      } else if (found.lmstudio.length > 0) {
        changeProvider('lmstudio')
        setBaseUrl('http://127.0.0.1:1234/v1')
        setModel(found.lmstudio[0]!)
        setAvailableModels(found.lmstudio)
        setResult({
          ok: true,
          message: `${t('检测到本机 LM Studio，共')} ${found.lmstudio.length} ${t('个模型。')}`,
        })
      } else {
        setResult({ ok: false, message: t('没有检测到本机 Ollama 或 LM Studio。') })
      }
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setDetectingLocal(false)
    }
  }

  function changeProvider(next: ProviderId): void {
    setProvider(next)
    const nextPreset = PROVIDER_PRESETS.find((item) => item.id === next)
    setBaseUrl(nextPreset?.baseUrl ?? '')
    setModel(nextPreset?.defaultModel ?? '')
    setApiKey('')
    setAvailableModels([])
    setModelListError(null)
    setResult(null)
  }

  function addVoice(): void {
    const value = newVoice.trim()
    if (!value) return
    setQwenTtsVoices((current) => [...new Set([...current, value])])
    setNewVoice('')
  }

  function removeVoice(voice: string): void {
    setQwenTtsVoices((current) => current.filter((item) => item !== voice))
  }

  async function refreshSync(): Promise<void> {
    try {
      setSyncStatus(await bridge.getSyncStatus())
    } catch {
      setSyncStatus(null)
    }
  }

  async function chooseSyncFolder(): Promise<void> {
    setSyncBusy('choose')
    setSyncNotice(null)
    try {
      setSyncStatus(await bridge.chooseSyncFolder())
    } catch (error) {
      setSyncNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setSyncBusy(null)
    }
  }

  async function pushSync(): Promise<void> {
    setSyncBusy('push')
    setSyncNotice(null)
    try {
      const snapshot = await bridge.pushSyncSnapshot()
      await refreshSync()
      setSyncNotice(`${t('已推送快照')} · ${formatBytes(snapshot.size)}`)
    } catch (error) {
      setSyncNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setSyncBusy(null)
    }
  }

  async function deleteSync(name: string): Promise<void> {
    const confirmed = await confirmDialog({
      title: t('删除同步快照'),
      message: t('删除这个同步快照？删除后无法恢复。'),
      confirmLabel: t('删除'),
      danger: true,
    })
    if (!confirmed) return
    setSyncBusy(name)
    setSyncNotice(null)
    try {
      setSyncStatus(await bridge.deleteSyncSnapshot(name))
    } catch (error) {
      setSyncNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setSyncBusy(null)
    }
  }

  async function mergeSync(name: string): Promise<void> {
    const confirmed = await confirmDialog({
      title: t('合并快照里的笔记'),
      message: t('会把快照里较新的笔记、PDF 标注和书签合并到当前库；不会删除本地内容。继续？'),
      confirmLabel: t('合并'),
    })
    if (!confirmed) return
    setSyncBusy(name)
    setSyncNotice(null)
    try {
      const result = await window.api.mergeSyncSnapshot(name, syncPassphrase.trim() || undefined)
      const skipped = result.skipped > 0 ? ` · ${t('跳过')} ${result.skipped}` : ''
      setSyncNotice(
        `${t('已合并')} · ${t('笔记')} ${result.notes} · ${t('标注')} ${result.annotations} · ${t('书签')} ${result.bookmarks} · ${t('位置')} ${result.positions} · ${t('统计')} ${result.stats}${skipped}。${t('正在重新加载…')}`,
      )
      window.setTimeout(() => window.location.reload(), 700)
    } catch (error) {
      setSyncNotice(error instanceof Error ? error.message : String(error))
      setSyncBusy(null)
    }
  }

  async function pullSync(name: string): Promise<void> {
    const snapshot = syncStatus?.snapshots.find((item) => item.name === name)
    const older = Boolean(snapshot && syncStatus?.lastPullAt && snapshot.createdAt < syncStatus.lastPullAt)
    const confirmed = await confirmDialog({
      title: t('从同步快照恢复'),
      message: older
        ? t('这个快照比你上次恢复的更旧，恢复会覆盖本地较新的内容。应用会先自动备份当前状态，继续？')
        : t('恢复会替换当前的书籍、笔记和设置，并先自动备份当前状态。继续？'),
      confirmLabel: t('恢复并重载'),
      danger: true,
    })
    if (!confirmed) return
    setSyncBusy(name)
    setSyncNotice(null)
    try {
      await bridge.pullSyncSnapshot(name)
      setSyncNotice(t('正在重新加载…'))
    } catch (error) {
      setSyncNotice(error instanceof Error ? error.message : String(error))
      setSyncBusy(null)
    }
  }

  async function persist(options: { silent?: boolean } = {}): Promise<SettingsView | null> {
    setSaving(true)
    try {
      const saved = await bridge.saveSettings({
        provider,
        baseUrl,
        model,
        generationMode,
        notesLanguage,
        visionMode,
        notesModel,
        composeModel,
        labModel,
        aiPricing: Object.fromEntries(
          Object.entries(aiPricing)
            .map(([id, price]) => [
              id,
              {
                inputPerMTokens: Math.max(0, Number(price.input) || 0),
                outputPerMTokens: Math.max(0, Number(price.output) || 0),
              },
            ] as const)
            .filter(([, price]) => price.inputPerMTokens > 0 || price.outputPerMTokens > 0),
        ),
        aiBudgetEnabled,
        aiBudgetMonthlyCny: Math.max(0, Number(aiBudgetMonthly) || 0),
        ...(readwiseToken.trim() ? { readwiseToken: readwiseToken.trim() } : {}),
        qwenTtsBaseUrl,
        qwenTtsModel,
        qwenTtsVoiceA,
        qwenTtsVoiceB,
        qwenTtsVoiceEn,
        qwenTtsPricePerK: Number(qwenTtsPricePerK) || 0,
        qwenTtsVoices,
        ...(qwenTtsKey.trim() ? { qwenTtsKey: qwenTtsKey.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      onSaved(saved, { silent: options.silent === true })
      return saved
    } catch (error) {
      const next = { ok: false, message: error instanceof Error ? error.message : String(error) }
      setResult(next)
      if (options.silent) onTestResult?.(next)
      return null
    } finally {
      setSaving(false)
    }
  }

  async function makeBackup(): Promise<void> {
    if (backupBusy) return
    setBackupBusy('create')
    setBackupError(null)
    setBackupNotice(null)
    try {
      const info = await bridge.createBackup()
      setBackups(await bridge.listBackups())
      setBackupNotice(`${t('已创建备份')} · ${formatBytes(info.bytes)}`)
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error))
    } finally {
      setBackupBusy(null)
    }
  }

  async function exportLatestBackup(): Promise<void> {
    const latest = backups[0]
    if (!latest || backupBusy) return
    setBackupBusy('export')
    setBackupError(null)
    setBackupNotice(null)
    try {
      const saved = await bridge.exportBackup(latest.id)
      if (saved.saved) setBackupNotice(`${t('备份已导出到')} ${saved.path}`)
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error))
    } finally {
      setBackupBusy(null)
    }
  }

  async function exportLibrary(): Promise<void> {
    if (backupBusy) return
    setBackupBusy('library-export')
    setBackupError(null)
    setBackupNotice(null)
    try {
      const saved = await bridge.exportLibrary()
      if (saved.saved) setBackupNotice(`${t('整库已导出到')} ${saved.path}`)
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error))
    } finally {
      setBackupBusy(null)
    }
  }

  async function importLibrary(): Promise<void> {
    if (backupBusy) return
    const confirmed = await confirmDialog({
      title: t('导入整库'),
      message: t('导入会替换当前书籍、笔记、生成内容、设置和阅读统计，并先自动备份当前状态。继续？'),
      confirmLabel: t('导入并重载'),
      danger: true,
    })
    if (!confirmed) return
    setBackupBusy('library-import')
    setBackupError(null)
    setBackupNotice(null)
    try {
      const saved = await bridge.importLibrary()
      if (saved.saved) setBackupNotice(t('整库已导入，正在重新加载…'))
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error))
    } finally {
      setBackupBusy(null)
    }
  }

  async function exportDiagnostics(): Promise<void> {
    if (backupBusy) return
    setBackupBusy('diagnostics')
    setBackupError(null)
    setBackupNotice(null)
    try {
      const saved = await bridge.exportDiagnostics()
      if (saved.saved) setBackupNotice(`${t('诊断包已导出到')} ${saved.path}`)
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error))
    } finally {
      setBackupBusy(null)
    }
  }

  async function testReadwiseToken(): Promise<void> {
    setReadwiseTest(null)
    try {
      setReadwiseTest(await bridge.testReadwise(readwiseToken.trim() || undefined))
    } catch (error) {
      setReadwiseTest({ ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  }

  async function saveAppLock(): Promise<void> {
    const passcode = lockPasscode.trim()
    if (passcode.length < 4) {
      setLockTest({ ok: false, message: t('应用锁密码至少 4 个字符。') })
      return
    }
    try {
      await bridge.setAppLock(passcode)
      setLockPasscode('')
      setLockTest({ ok: true, message: t('应用锁已开启；下次启动需要输入密码。') })
      onSaved(await bridge.getSettings())
    } catch (error) {
      setLockTest({ ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  }

  async function disableAppLock(): Promise<void> {
    const confirmed = await confirmDialog({
      title: t('关闭应用锁'),
      message: t('关闭后下次启动不再需要密码。继续？'),
      confirmLabel: t('关闭应用锁'),
      danger: true,
    })
    if (!confirmed) return
    try {
      await bridge.setAppLock(null)
      setLockPasscode('')
      setLockTest({ ok: true, message: t('应用锁已关闭。') })
      onSaved(await bridge.getSettings())
    } catch (error) {
      setLockTest({ ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  }

  async function restoreBackup(item: BackupInfo): Promise<void> {
    const confirmed = await confirmDialog({
      title: t('恢复这个备份'),
      message: `${t('将用')} ${formatBackupTime(item.createdAt)} ${t('的备份替换当前书籍、章节、笔记和设置，应用会重新加载。当前状态会先自动备份。继续？')}`,
      confirmLabel: t('恢复并重载'),
      danger: true,
    })
    if (!confirmed) return
    setBackupBusy(item.id)
    setBackupError(null)
    setBackupNotice(t('正在恢复备份…'))
    try {
      await bridge.restoreBackup(item.id)
    } catch (error) {
      setBackupBusy(null)
      setBackupError(error instanceof Error ? error.message : String(error))
    }
  }

  async function removeBackup(item: BackupInfo): Promise<void> {
    const confirmed = await confirmDialog({
      title: t('删除备份'),
      message: `${t('删除')} ${formatBackupTime(item.createdAt)} ${t('的备份？这不会影响当前书籍。')}`,
      confirmLabel: t('删除'),
      danger: true,
    })
    if (!confirmed) return
    setBackupError(null)
    try {
      await bridge.deleteBackup(item.id)
      setBackups(await bridge.listBackups())
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error))
    }
  }

  async function test(): Promise<void> {
    // 测试连接会先保存当前设置；这里不弹“已切换到…”的提示，只提示测试结果。
    const saved = await persist({ silent: true })
    if (!saved) return
    setTesting(true)
    setResult(null)
    try {
      const next = await bridge.testConnection()
      setResult(next)
      onTestResult?.(next)
    } catch (error) {
      const next = { ok: false, message: error instanceof Error ? error.message : String(error) }
      setResult(next)
      onTestResult?.(next)
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t('设置')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{t('设置')}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        <div className={`settings-body${showAdvanced ? ' show-advanced' : ''}`}>
        <div className="form-row">
          <label>{t('界面模式')}</label>
          <Checkbox
            checked={coreMode}
            onChange={onToggleCoreMode}
            label={t('精简模式：只显示阅读、读薄、卡片和成书')}
          />
          <p className="field-hint">
            {t('关闭后会显示 AI 内容库、知识地图、AI 工具和工作台等完整入口。')}
          </p>
        </div>

        {settings.keysNeedReentry ? (
          <div className="inline-notice" role="status">
            {t('这个备份来自另一台机器，部分 API Key 无法在当前系统解密；需要重新填写后才能继续使用。')}
          </div>
        ) : null}
        <div className="form-row settings-mode-toggle">
          <div>
            <strong>{t('显示高级设置')}</strong>
            <p className="field-hint">{t('TTS、Readwise、价格、备份和应用锁默认收起。')}</p>
          </div>
          <button type="button" className="ghost-button small" onClick={() => setShowAdvanced((value) => !value)}>
            {showAdvanced ? t('收起高级设置') : t('显示高级设置')}
          </button>
        </div>

        <div className="form-row">
          <label>{t('界面语言（Beta）')}</label>
          <div className="segmented theme-segmented">
            <button type="button" className={locale === 'zh' ? 'active' : ''} onClick={() => setLocale('zh')}>
              {t('中文')}
            </button>
            <button type="button" className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>
              English
            </button>
          </div>
          <p className="field-hint">{t('主要界面已支持英文，剩余界面仍在迁移。')}</p>
        </div>

        <div className="form-row settings-advanced">
          <label>{t('扩展能力')}</label>
          <p className="field-hint">
            {t('内置浏览器收录扩展只申请 browser:capture；扩展清单、权限边界和校验方式见使用手册。')}
          </p>
          <div className="extension-list">
            {BUILTIN_EXTENSIONS.map((extension) => (
              <div className="extension-row" key={extension.id}>
                <div>
                  <strong>{t(extension.name)}</strong>
                  <p>{t(extension.description)}</p>
                </div>
                <span className="extension-caps">
                  {extension.capabilities.map((capability) => t(capability)).join(' · ')}
                </span>
              </div>
            ))}
          </div>
          <button type="button" className="text-button" onClick={onOpenManual}>
            {t('查看扩展说明')}
          </button>
        </div>

        <div className="form-row">
          <label>{t('主题')}</label>
          <div className="segmented theme-segmented">
            {THEME_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={theme === value ? 'active' : ''}
                onClick={() => onThemeChange(value)}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <p className="field-hint">{t('主题应用到整个应用：顶栏、侧栏、书架、笔记和正文。')}</p>
        </div>

        <div className="form-row">
          <label>{t('生成档位')}</label>
          <div className="segmented theme-segmented">
            {MODE_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={generationMode === value ? 'active' : ''}
                onClick={() => setGenerationMode(value)}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <p className="field-hint">{t(MODE_HINTS[generationMode])}</p>
        </div>

        <div className="form-row">
          <label>{t('外文书籍读薄语言')}</label>
          <Select
            value={notesLanguage}
            onChange={(value) => setNotesLanguage(value as NotesLanguage)}
            ariaLabel={t('外文书籍读薄语言')}
            options={[
              { value: 'zh', label: t('简体中文（默认）') },
              { value: 'source', label: t('跟随原文') },
            ]}
          />
          <p className="field-hint">
            {t('外文书籍默认把读薄稿和知识点翻成中文；选「跟随原文」则保持原语言。引用证据始终保留原文。')}
          </p>
        </div>

        <div className="form-row">
          <label>{t('图片理解')}</label>
          <Select
            value={visionMode}
            onChange={(value) => setVisionMode(value as VisionMode)}
            ariaLabel={t('图片理解')}
            options={[
              { value: 'auto', label: t('自动（仅视觉模型）') },
              { value: 'always', label: t('总是发送图片') },
              { value: 'off', label: t('关闭') },
            ]}
          />
          <p className="field-hint">
            {t('读薄和卡片会把章节里的图表、流程图发送给你配置的模型服务商；自动模式只对已知支持视觉的模型发送。图注和 alt 始终作为文字参考。')}
          </p>
        </div>

        <div className="form-row">
          <label>{t('每日阅读目标')}</label>
          <div className="goal-input">
            <input
              type="number"
              min={0}
              max={240}
              step={5}
              value={dailyGoal || ''}
              placeholder={t('0 表示不设目标')}
              onChange={(event) => {
                const next = Math.max(0, Math.min(240, Number(event.target.value) || 0))
                setDailyGoalState(next)
                setDailyGoal(next)
              }}
            />
            <span>{t('分钟')}</span>
          </div>
          <p className="field-hint">{t('目标会显示在书架顶部，只在本机保存。')}</p>
        </div>

        <div className="form-row">
          <label>{t('自动续读')}</label>
          <Checkbox
            checked={autoNext}
            onChange={(checked) => {
              setAutoNextState(checked)
              setAutoNext(checked)
            }}
            label={t('读到底自动进入下一章')}
          />
          <p className="field-hint">{t('滚到章尾会出现 3 秒倒计时，可随时取消。')}</p>
        </div>

        <div className="settings-divider" />

        <div className="form-row">
          <label>{t('模型服务')}</label>
          <Select
            value={provider}
            onChange={(value) => changeProvider(value as ProviderId)}
            ariaLabel={t('模型服务')}
            options={PROVIDER_PRESETS.map((item) => ({ value: item.id, label: t(item.label) }))}
          />
          {preset?.hint ? <p className="field-hint">{t(preset.hint)}</p> : null}
        </div>

        {provider !== 'demo' ? (
          <>
            <div className="form-row">
              <label>Base URL</label>
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={preset?.baseUrl || 'https://…/v1'}
                spellCheck={false}
              />
            </div>

            <div className="form-row">
              <label>{t('模型')}</label>
              <div className="form-row-inline">
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={t('模型 ID')}
                  list="model-suggestions"
                  spellCheck={false}
                />
                <Select
                  className="filter-select"
                  value={model}
                  onChange={setModel}
                  ariaLabel={t('选择模型')}
                  placeholder={t('选择模型…')}
                  searchable
                  options={modelOptions.map((id) => ({ value: id, label: id }))}
                />
              </div>
              <datalist id="model-suggestions">
                {modelOptions.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
              <div className="model-list-tools">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void refreshModels(true)}
                  disabled={modelListLoading}
                >
                  {modelListLoading ? t('正在读取模型…') : t('从服务刷新模型列表')}
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void detectLocalModels()}
                  disabled={detectingLocal}
                >
                  {detectingLocal ? t('正在检测…') : t('检测本机模型')}
                </button>
                <span className="field-hint">
                  {modelListError
                    ? modelListError
                    : availableModels.length > 0
                      ? `${t('已读取')} ${availableModels.length} ${t('个模型；也可以直接输入任意模型 ID。')}`
                      : t('可以直接输入模型 ID；配置 Key 后可读取完整列表。')}
                </span>
              </div>
            </div>

            <div className="form-row">
              <label>API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={settings.apiKeyConfigured ? `${t('已保存')} ${settings.apiKeyHint}${t('，留空则不修改')}` : t('粘贴 API Key')}
                spellCheck={false}
              />
              <p className="field-hint">
                {t('保存在本机，使用系统钥匙串加密。')}{preset?.keyUrl ? `${t('获取地址')}：${preset.keyUrl}` : ''}
              </p>
            </div>
            <div className="form-row settings-advanced">
              <label>{t('任务模型覆盖')}</label>
              <div className="task-model-grid">
                <input value={notesModel} onChange={(event) => setNotesModel(event.target.value)} placeholder={t('读薄模型（留空用默认）')} list="model-suggestions" spellCheck={false} />
                <input value={composeModel} onChange={(event) => setComposeModel(event.target.value)} placeholder={t('成稿模型（留空用默认）')} list="model-suggestions" spellCheck={false} />
                <input value={labModel} onChange={(event) => setLabModel(event.target.value)} placeholder={t('工作台模型（留空用默认）')} list="model-suggestions" spellCheck={false} />
              </div>
              <p className="field-hint">{t('只覆盖模型 ID，Base URL 和 Key 继续使用上面的服务商。')}</p>
            </div>
            {priceModels.length > 0 ? (
              <div className="form-row settings-advanced">
                <label>{t('模型价格（只用于本地估算）')}</label>
                <div className="price-grid">
                  {priceModels.map((id) => (
                    <div className="price-row" key={id}>
                      <span className="price-model">{id}</span>
                      <input
                        value={aiPricing[id]?.input ?? ''}
                        onChange={(event) => {
                          const value = event.target.value
                          setAiPricing((current) => ({
                            ...current,
                            [id]: { input: value, output: current[id]?.output ?? '' },
                          }))
                        }}
                        inputMode="decimal"
                        placeholder={t('输入 ¥/百万 token')}
                        aria-label={`${id} ${t('输入价格')}`}
                      />
                      <input
                        value={aiPricing[id]?.output ?? ''}
                        onChange={(event) => {
                          const value = event.target.value
                          setAiPricing((current) => ({
                            ...current,
                            [id]: { input: current[id]?.input ?? '', output: value },
                          }))
                        }}
                        inputMode="decimal"
                        placeholder={t('输出 ¥/百万 token')}
                        aria-label={`${id} ${t('输出价格')}`}
                      />
                    </div>
                  ))}
                </div>
                <p className="field-hint">
                  {t('已内置参考价（更新于')} {AI_PRICING_REFERENCE_DATE}
                  {t('，美元按 1 USD ≈ 6.73 CNY 折算）；可直接改，最终以厂商账单为准。')}
                </p>
              </div>
            ) : null}
            <div className="form-row settings-advanced">
              <label>{t('月度 AI 预算')}</label>
              <div className="task-model-grid">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={aiBudgetEnabled}
                    onChange={(event) => setAiBudgetEnabled(event.target.checked)}
                  />
                  <span>{t('超出后停止调用模型')}</span>
                </label>
                <input
                  value={aiBudgetMonthly}
                  onChange={(event) => setAiBudgetMonthly(event.target.value)}
                  inputMode="decimal"
                  placeholder={t('每月上限（元）')}
                  aria-label={t('每月 AI 预算上限')}
                  disabled={!aiBudgetEnabled}
                />
              </div>
              <p className="field-hint">
                {t('按上面的模型价格估算；到上限后新的生成会被拒绝，已经生成的内容和本地功能不受影响。')}
              </p>
            </div>
          </>
        ) : (
          <div className="demo-note">
            <strong>{t('演示模式')}</strong>
            <p>
              {t('不需要 API Key，会生成固定的示例笔记来展示完整流程。正式使用时选择上面任意一个真实模型服务，填入 Key 后即可按章生成带原文引用的笔记。')}
            </p>
          </div>
        )}

        <div className="form-row">
          <label>Readwise API Token</label>
          <input
            type="password"
            value={readwiseToken}
            onChange={(event) => setReadwiseToken(event.target.value)}
            placeholder={settings.readwiseConfigured ? t('已保存，留空则不修改') : t('可选，用于同步 Readwise 划线')}
            spellCheck={false}
          />
          <p className="field-hint">{t('在 readwise.io/access_token 获取；Token 用系统钥匙串加密保存在本机。')}</p>
          <div className="backup-actions">
            <button type="button" className="ghost-button small" onClick={() => void testReadwiseToken()}>
              {t('测试 Readwise')}
            </button>
          </div>
          {readwiseTest ? (
            <div className={`test-result ${readwiseTest.ok ? 'ok' : 'fail'}`}>{readwiseTest.message}</div>
          ) : null}
        </div>

        <div className="form-row settings-advanced">
          <label>{t('千问 TTS（阿里云百炼）')}</label>
          <input
            value={qwenTtsBaseUrl}
            onChange={(event) => setQwenTtsBaseUrl(event.target.value)}
            placeholder="https://dashscope.aliyuncs.com/api/v1"
            spellCheck={false}
          />
          <div className="form-row-inline">
            <input
              value={qwenTtsModel}
              onChange={(event) => setQwenTtsModel(event.target.value)}
              placeholder="qwen-audio-3.1-tts-flash"
              spellCheck={false}
            />
            <input
              value={qwenTtsVoiceA}
              onChange={(event) => setQwenTtsVoiceA(event.target.value)}
              placeholder={t('A 音色，如 longanhuan_v3.1')}
              spellCheck={false}
            />
            <input
              value={qwenTtsVoiceB}
              onChange={(event) => setQwenTtsVoiceB(event.target.value)}
              placeholder={t('B 音色，可留空复用 A')}
              spellCheck={false}
            />
          </div>
          <input
            value={qwenTtsVoiceEn}
            onChange={(event) => setQwenTtsVoiceEn(event.target.value)}
            placeholder={t('英文音色（可选，留空复用 A）')}
            spellCheck={false}
          />
          <input
            type="number"
            min={0}
            step={0.001}
            value={qwenTtsPricePerK}
            onChange={(event) => setQwenTtsPricePerK(event.target.value)}
            placeholder={t('价格（元/千字符，可选）')}
            spellCheck={false}
          />
          <div className="voice-library">
            {qwenTtsVoices.map((voice) => (
              <span key={voice} className="voice-chip">
                <code>{voice}</code>
                <button type="button" onClick={() => setQwenTtsVoiceA(voice)}>{t('设为 A')}</button>
                <button type="button" onClick={() => setQwenTtsVoiceB(voice)}>{t('设为 B')}</button>
                <button type="button" onClick={() => setQwenTtsVoiceEn(voice)}>{t('设为英文')}</button>
                <button
                  type="button"
                  className="voice-chip-remove"
                  onClick={() => removeVoice(voice)}
                  aria-label={`${t('删除音色')} ${voice}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="backup-actions">
            <input
              value={newVoice}
              onChange={(event) => setNewVoice(event.target.value)}
              placeholder={t('输入音色 ID，例如 longanhuan_v3.1')}
              spellCheck={false}
            />
            <button type="button" className="ghost-button small" onClick={addVoice}>
              {t('加入音色库')}
            </button>
          </div>
          <p className="field-hint">{t('音色库只保存 ID，不会自动验证；建议先在百炼控制台确认音色可用。')}</p>
          <input
            type="password"
            value={qwenTtsKey}
            onChange={(event) => setQwenTtsKey(event.target.value)}
            placeholder={settings.qwenTtsConfigured ? t('已保存，留空则不修改') : t('可选，留空复用阿里云百炼主 Key')}
            spellCheck={false}
          />
          <p className="field-hint">
            {t('与 english-penpal 同款：千问语音合成，模型 qwen-audio-3.1-tts-flash，走阿里云百炼原生 SpeechSynthesizer 接口。Key 留空时复用「阿里云百炼」主模型的 Key；专属业务空间请把 Base URL 换成自己的域名。文本会发送到该服务，按字符计费。')}
          </p>
          <p className="field-hint">{t('英文段落会自动使用英文音色；留空时复用 A 音色。')}</p>
          <p className="field-hint">{t('填写价格后，整章导出会按字符数估算费用；不填只显示字符数。')}</p>
        </div>

        <div className="settings-divider" />

        <div className="form-row settings-advanced">
          <label>{t('应用锁')}</label>
          <input
            type="password"
            value={lockPasscode}
            onChange={(event) => setLockPasscode(event.target.value)}
            placeholder={settings.appLockEnabled ? t('输入新密码可修改应用锁') : t('设置 4 位以上密码')}
            autoComplete="new-password"
            spellCheck={false}
          />
          <div className="backup-actions">
            <button type="button" className="ghost-button small" onClick={() => void saveAppLock()}>
              {settings.appLockEnabled ? t('修改应用锁') : t('开启应用锁')}
            </button>
            {settings.appLockEnabled ? (
              <button type="button" className="ghost-button small" onClick={() => void disableAppLock()}>
                {t('关闭应用锁')}
              </button>
            ) : null}
          </div>
          <p className="field-hint">
            {t('下次启动需要输入密码。密码哈希保存在本机；忘记后只能手动删除 settings.json 里的 lock 字段。')}
          </p>
          {lockTest ? (
            <div className={`test-result ${lockTest.ok ? 'ok' : 'fail'}`}>{lockTest.message}</div>
          ) : null}
        </div>

        <div className="settings-divider" />

        <div className="form-row settings-advanced">
          <label>{t('数据备份')}</label>
          <div className="backup-actions">
            <button type="button" className="ghost-button small" onClick={() => void makeBackup()} disabled={backupBusy !== null}>
              {backupBusy === 'create' ? t('备份中…') : t('立即备份')}
            </button>
            <button
              type="button"
              className="ghost-button small"
              onClick={() => void exportLatestBackup()}
              disabled={backups.length === 0 || backupBusy !== null}
            >
              {backupBusy === 'export' ? t('导出中…') : t('导出最新备份')}
            </button>
            <button
              type="button"
              className="ghost-button small"
              onClick={() => void exportLibrary()}
              disabled={backupBusy !== null}
            >
              {backupBusy === 'library-export' ? t('导出中…') : t('导出整库')}
            </button>
            <button
              type="button"
              className="ghost-button small"
              onClick={() => void importLibrary()}
              disabled={backupBusy !== null}
            >
              {backupBusy === 'library-import' ? t('导入中…') : t('导入整库')}
            </button>
            <button type="button" className="text-button muted" onClick={() => void bridge.openBackupsDir()}>
              {t('打开备份目录')}
            </button>
            <button
              type="button"
              className="text-button muted"
              onClick={() => void exportDiagnostics()}
              disabled={backupBusy !== null}
              title={t('导出不含书籍正文、笔记内容和 API Key 的本地日志与运行信息')}
            >
              {backupBusy === 'diagnostics' ? t('打包中…') : t('导出诊断包')}
            </button>
          </div>
          <p className="field-hint">
            {t('备份包含数据库、设置和书文件引用；书文件按内容去重，多个备份只存一份。合并、拆分、重新解析或删除书籍前会自动备份；恢复后会重新加载应用。')}{' '}
            {t('诊断包用于排查问题：包含版本、日志和脱敏后的模型设置，不包含书籍正文、笔记内容或 API Key。')}
          </p>
          {backupError ? <div className="inline-error" role="alert">{backupError}</div> : null}
          {backupNotice ? <div className="inline-notice" role="status" aria-live="polite">{backupNotice}</div> : null}
          <div className="backup-list">
            {backups.length === 0 ? (
              <p className="backup-empty">{t('还没有备份。第一次合并、拆分或删除书籍时也会自动生成。')}</p>
            ) : (
              backups.slice(0, 10).map((item) => (
                <div key={item.id} className="backup-row">
                  <div className="backup-row-main">
                    <strong>{formatBackupTime(item.createdAt)}</strong>
                    <span>
                      {item.kind === 'auto' ? t('自动备份') : t('手动备份')}
                      {item.label ? ` · ${item.label === '每日自动备份' ? t('每日自动备份') : item.label === '恢复前自动备份' ? t('恢复前自动备份') : item.label}` : ''} · {formatBytes(item.bytes)}
                    </span>
                  </div>
                  <div className="backup-row-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void restoreBackup(item)}
                      disabled={backupBusy !== null}
                    >
                      {t('恢复')}
                    </button>
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() => void removeBackup(item)}
                      disabled={backupBusy !== null}
                    >
                      {t('删除')}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="form-row settings-advanced">
          <label>{t('同步文件夹')}</label>
          <div className="backup-actions">
            <button type="button" className="ghost-button small" onClick={() => void chooseSyncFolder()} disabled={syncBusy !== null}>
              {syncBusy === 'choose' ? t('选择中…') : t('选择文件夹')}
            </button>
            <button
              type="button"
              className="ghost-button small"
              onClick={() => void pushSync()}
              disabled={syncBusy !== null || !syncStatus?.folder}
            >
              {syncBusy === 'push' ? t('推送中…') : t('推送快照')}
            </button>
            <button type="button" className="text-button muted" onClick={() => void refreshSync()} disabled={syncBusy !== null}>
              {t('刷新')}
            </button>
            <button
              type="button"
              className="text-button muted"
              onClick={() => void bridge.openSyncFolder()}
              disabled={!syncStatus?.folder || syncBusy !== null}
            >
              {t('打开同步文件夹')}
            </button>
            <input
              type="password"
              value={syncPassphrase}
              onChange={(event) => setSyncPassphrase(event.target.value)}
              placeholder={t('加密口令（可选）')}
              aria-label={t('同步加密口令')}
              autoComplete="new-password"
            />
          </div>
          <p className="field-hint">
            {syncStatus?.folder
              ? `${t('同步目录')}：${syncStatus.folder}`
              : t('选择一个 iCloud Drive、Dropbox 或 NAS 文件夹；推送会生成一份整库快照，其他设备可以拉取恢复。')}
            {t('留空推送普通 zip；填了口令会加密成 .thinsync，拉取时需要同一口令。')}
          </p>
          <p className="field-hint">
            {syncStatus?.lastPushAt
              ? `${t('上次推送')}：${formatBackupTime(syncStatus.lastPushAt)}`
              : t('还没有推送过快照。')}
            {syncStatus?.lastPullAt ? ` · ${t('上次恢复')}：${formatBackupTime(syncStatus.lastPullAt)}` : ''}
            {syncStatus?.lastMergeAt ? ` · ${t('上次合并')}：${formatBackupTime(syncStatus.lastMergeAt)}` : ''}
          </p>
          {syncNotice ? <div className="inline-notice" role="status" aria-live="polite">{syncNotice}</div> : null}
          {syncStatus && syncStatus.snapshots.length > 0 ? (
            <div className="backup-list">
              {syncStatus.snapshots.map((item) => (
                <div key={item.name} className="backup-row">
                  <div className="backup-row-main">
                    <strong>{formatBackupTime(item.createdAt)}</strong>
                    <span>{formatBytes(item.size)}{item.encrypted ? ` · ${t('已加密')}` : ''}</span>
                  </div>
                  <div className="backup-row-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void mergeSync(item.name)}
                      disabled={syncBusy !== null}
                    >
                      {t('合并笔记')}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void pullSync(item.name)}
                      disabled={syncBusy !== null}
                    >
                      {syncBusy === item.name ? t('恢复中…') : t('恢复')}
                    </button>
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() => void deleteSync(item.name)}
                      disabled={syncBusy !== null}
                    >
                      {t('删除')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {result ? <div className={`test-result ${result.ok ? 'ok' : 'fail'}`}>{result.message}</div> : null}

        </div>

        <div className="modal-footer">
          <button type="button" className="text-button muted" onClick={() => void bridge.openDataDir()}>
            {t('打开数据目录')}
          </button>
          <button type="button" className="text-button" onClick={onOpenManual}>
            {t('使用手册')}
          </button>
          <button type="button" className="text-button" onClick={onOpenOnboarding}>
            {t('新手引导')}
          </button>
          <div className="modal-footer-actions">
            <button type="button" className="ghost-button" onClick={onClose}>
              {t('取消')}
            </button>
            <button type="button" className="ghost-button" onClick={() => void test()} disabled={testing || saving}>
              {testing ? t('测试中…') : t('测试连接')}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void persist().then((saved) => {
                  if (saved) onClose()
                })
              }}
              disabled={saving}
            >
              {saving ? t('保存中…') : t('保存')}
            </button>
          </div>
        </div>

        {appInfo ? <p className="modal-meta">{t('页边')} v{appInfo.version} · {t('数据目录')} {appInfo.dataDir}</p> : null}
      </div>
      </div>
    </>
  )
}
