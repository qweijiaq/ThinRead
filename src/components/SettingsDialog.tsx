import { useEffect, useState, type JSX } from 'react'

import { PROVIDER_PRESETS } from '../../shared/types.js'
import type {
  AppInfo,
  BackupInfo,
  GenerationMode,
  ProviderId,
  ReaderStyle,
  SettingsView,
  TestResult,
} from '../../shared/types.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import { confirmDialog } from './ConfirmDialog.js'
import { Select } from './Select.js'

interface SettingsDialogProps {
  open: boolean
  settings: SettingsView
  appInfo: AppInfo | null
  theme: ReaderStyle['theme']
  onClose(): void
  onSaved(settings: SettingsView): void
  onThemeChange(theme: ReaderStyle['theme']): void
}

const THEME_OPTIONS: Array<[ReaderStyle['theme'], string]> = [
  ['folio', '墨蓝'],
  ['paper', '纸色'],
  ['plain', '纯白'],
  ['warm', '暖色'],
]

const MODE_OPTIONS: Array<[GenerationMode, string]> = [
  ['fast', '快速'],
  ['standard', '标准'],
  ['deep', '精读'],
]

const MODE_HINTS: Record<GenerationMode, string> = {
  fast: '跳过断言回查和卡片延伸，最快、最省 token；适合先看结构。',
  standard: '读薄、回查、卡片延伸都保留，速度和质量的默认平衡。',
  deep: '额外做一轮全局回查，并保留全部延伸；适合重要章节。',
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
  onThemeChange,
}: SettingsDialogProps): JSX.Element | null {
  const [provider, setProvider] = useState<ProviderId>(settings.provider)
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [model, setModel] = useState(settings.model)
  const [apiKey, setApiKey] = useState('')
  const [generationMode, setGenerationMode] = useState<GenerationMode>(settings.generationMode)
  const [notesModel, setNotesModel] = useState(settings.notesModel)
  const [composeModel, setComposeModel] = useState(settings.composeModel)
  const [labModel, setLabModel] = useState(settings.labModel)
  const [readwiseToken, setReadwiseToken] = useState('')
  const [readwiseTest, setReadwiseTest] = useState<TestResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose, 'input, select, textarea')
  const [backupBusy, setBackupBusy] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [backupNotice, setBackupNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setProvider(settings.provider)
    setBaseUrl(settings.baseUrl)
    setModel(settings.model)
    setApiKey('')
    setGenerationMode(settings.generationMode)
    setNotesModel(settings.notesModel)
    setComposeModel(settings.composeModel)
    setLabModel(settings.labModel)
    setReadwiseToken('')
    setReadwiseTest(null)
    setResult(null)
    setBackupError(null)
    setBackupNotice(null)
    setBackupBusy(null)
    void window.api
      .listBackups()
      .then(setBackups)
      .catch((error: unknown) => {
        setBackupError(error instanceof Error ? error.message : String(error))
      })
  }, [open, settings])

  if (!open) return null

  const preset = PROVIDER_PRESETS.find((item) => item.id === provider)

  function changeProvider(next: ProviderId): void {
    setProvider(next)
    const nextPreset = PROVIDER_PRESETS.find((item) => item.id === next)
    setBaseUrl(nextPreset?.baseUrl ?? '')
    setModel(nextPreset?.defaultModel ?? '')
    setResult(null)
  }

  async function persist(): Promise<SettingsView | null> {
    setSaving(true)
    try {
      const saved = await window.api.saveSettings({
        provider,
        baseUrl,
        model,
        generationMode,
        notesModel,
        composeModel,
        labModel,
        ...(readwiseToken.trim() ? { readwiseToken: readwiseToken.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      onSaved(saved)
      return saved
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : String(error) })
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
      const info = await window.api.createBackup()
      setBackups(await window.api.listBackups())
      setBackupNotice(`已创建备份 · ${formatBytes(info.bytes)}`)
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
      const saved = await window.api.exportBackup(latest.id)
      if (saved.saved) setBackupNotice(`备份已导出到 ${saved.path}`)
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error))
    } finally {
      setBackupBusy(null)
    }
  }

  async function testReadwiseToken(): Promise<void> {
    setReadwiseTest(null)
    try {
      setReadwiseTest(await window.api.testReadwise(readwiseToken.trim() || undefined))
    } catch (error) {
      setReadwiseTest({ ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  }

  async function restoreBackup(item: BackupInfo): Promise<void> {
    const confirmed = await confirmDialog({
      title: '恢复这个备份',
      message: `将用 ${formatBackupTime(item.createdAt)} 的备份替换当前书籍、章节、笔记和设置，应用会重新加载。当前状态会先自动备份。继续？`,
      confirmLabel: '恢复并重载',
      danger: true,
    })
    if (!confirmed) return
    setBackupBusy(item.id)
    setBackupError(null)
    setBackupNotice('正在恢复备份…')
    try {
      await window.api.restoreBackup(item.id)
    } catch (error) {
      setBackupBusy(null)
      setBackupError(error instanceof Error ? error.message : String(error))
    }
  }

  async function removeBackup(item: BackupInfo): Promise<void> {
    const confirmed = await confirmDialog({
      title: '删除备份',
      message: `删除 ${formatBackupTime(item.createdAt)} 的备份？这不会影响当前书籍。`,
      confirmLabel: '删除',
      danger: true,
    })
    if (!confirmed) return
    setBackupError(null)
    try {
      await window.api.deleteBackup(item.id)
      setBackups(await window.api.listBackups())
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error))
    }
  }

  async function test(): Promise<void> {
    const saved = await persist()
    if (!saved) return
    setTesting(true)
    setResult(null)
    try {
      setResult(await window.api.testConnection())
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2>设置</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="form-row">
          <label>主题</label>
          <div className="segmented theme-segmented">
            {THEME_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={theme === value ? 'active' : ''}
                onClick={() => onThemeChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="field-hint">主题应用到整个应用：顶栏、侧栏、书架、笔记和正文。</p>
        </div>

        <div className="form-row">
          <label>生成档位</label>
          <div className="segmented theme-segmented">
            {MODE_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={generationMode === value ? 'active' : ''}
                onClick={() => setGenerationMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="field-hint">{MODE_HINTS[generationMode]}</p>
        </div>

        <div className="settings-divider" />

        <div className="form-row">
          <label>模型服务</label>
          <Select
            value={provider}
            onChange={(value) => changeProvider(value as ProviderId)}
            ariaLabel="模型服务"
            options={PROVIDER_PRESETS.map((item) => ({ value: item.id, label: item.label }))}
          />
          {preset?.hint ? <p className="field-hint">{preset.hint}</p> : null}
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
              <label>模型</label>
              <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="模型 ID" spellCheck={false} />
            </div>

            <div className="form-row">
              <label>API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={settings.apiKeyConfigured ? `已保存 ${settings.apiKeyHint}，留空则不修改` : '粘贴 API Key'}
                spellCheck={false}
              />
              <p className="field-hint">
                保存在本机，使用系统钥匙串加密。{preset?.keyUrl ? `获取地址：${preset.keyUrl}` : ''}
              </p>
            </div>
            <div className="form-row">
              <label>任务模型覆盖</label>
              <div className="task-model-grid">
                <input value={notesModel} onChange={(event) => setNotesModel(event.target.value)} placeholder="读薄模型（留空用默认）" spellCheck={false} />
                <input value={composeModel} onChange={(event) => setComposeModel(event.target.value)} placeholder="成稿模型（留空用默认）" spellCheck={false} />
                <input value={labModel} onChange={(event) => setLabModel(event.target.value)} placeholder="工作台模型（留空用默认）" spellCheck={false} />
              </div>
              <p className="field-hint">只覆盖模型 ID，Base URL 和 Key 继续使用上面的服务商。</p>
            </div>
            <div className="form-row">
              <label>Readwise API Token</label>
              <input
                type="password"
                value={readwiseToken}
                onChange={(event) => setReadwiseToken(event.target.value)}
                placeholder={settings.readwiseConfigured ? '已保存，留空则不修改' : '可选，用于同步 Readwise 划线'}
                spellCheck={false}
              />
              <p className="field-hint">在 readwise.io/access_token 获取；Token 用系统钥匙串加密保存在本机。</p>
              <div className="backup-actions">
                <button type="button" className="ghost-button small" onClick={() => void testReadwiseToken()}>
                  测试 Readwise
                </button>
              </div>
              {readwiseTest ? (
                <div className={`test-result ${readwiseTest.ok ? 'ok' : 'fail'}`}>{readwiseTest.message}</div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="demo-note">
            <strong>演示模式</strong>
            <p>
              不需要 API Key，会生成固定的示例笔记来展示完整流程。正式使用时选择上面任意一个真实模型服务，
              填入 Key 后即可按章生成带原文引用的笔记。
            </p>
          </div>
        )}

        <div className="settings-divider" />

        <div className="form-row">
          <label>数据备份</label>
          <div className="backup-actions">
            <button type="button" className="ghost-button small" onClick={() => void makeBackup()} disabled={backupBusy !== null}>
              {backupBusy === 'create' ? '备份中…' : '立即备份'}
            </button>
            <button
              type="button"
              className="ghost-button small"
              onClick={() => void exportLatestBackup()}
              disabled={backups.length === 0 || backupBusy !== null}
            >
              {backupBusy === 'export' ? '导出中…' : '导出最新备份'}
            </button>
            <button type="button" className="text-button muted" onClick={() => void window.api.openBackupsDir()}>
              打开备份目录
            </button>
          </div>
          <p className="field-hint">
            备份包含数据库、书籍文件和设置。合并、拆分、重新解析或删除书籍前会自动备份；恢复后会重新加载应用。
          </p>
          {backupError ? <div className="inline-error">{backupError}</div> : null}
          {backupNotice ? <div className="inline-notice">{backupNotice}</div> : null}
          <div className="backup-list">
            {backups.length === 0 ? (
              <p className="backup-empty">还没有备份。第一次合并、拆分或删除书籍时也会自动生成。</p>
            ) : (
              backups.slice(0, 10).map((item) => (
                <div key={item.id} className="backup-row">
                  <div className="backup-row-main">
                    <strong>{formatBackupTime(item.createdAt)}</strong>
                    <span>
                      {item.kind === 'auto' ? '自动备份' : '手动备份'}
                      {item.label ? ` · ${item.label}` : ''} · {formatBytes(item.bytes)}
                    </span>
                  </div>
                  <div className="backup-row-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void restoreBackup(item)}
                      disabled={backupBusy !== null}
                    >
                      恢复
                    </button>
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() => void removeBackup(item)}
                      disabled={backupBusy !== null}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {result ? <div className={`test-result ${result.ok ? 'ok' : 'fail'}`}>{result.message}</div> : null}

        <div className="modal-footer">
          <button type="button" className="text-button muted" onClick={() => void window.api.openDataDir()}>
            打开数据目录
          </button>
          <div className="modal-footer-actions">
            <button type="button" className="ghost-button" onClick={onClose}>
              取消
            </button>
            <button type="button" className="ghost-button" onClick={() => void test()} disabled={testing || saving}>
              {testing ? '测试中…' : '测试连接'}
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
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>

        {appInfo ? <p className="modal-meta">页边 v{appInfo.version} · 数据目录 {appInfo.dataDir}</p> : null}
      </div>
    </div>
  )
}
