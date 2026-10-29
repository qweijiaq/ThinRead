import { useEffect, useState, type JSX } from 'react'

import { PROVIDER_PRESETS } from '../../shared/types.js'
import type { AppInfo, ProviderId, ReaderStyle, SettingsView, TestResult } from '../../shared/types.js'

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
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  useEffect(() => {
    if (!open) return
    setProvider(settings.provider)
    setBaseUrl(settings.baseUrl)
    setModel(settings.model)
    setApiKey('')
    setResult(null)
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
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
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

        <div className="settings-divider" />

        <div className="form-row">
          <label>模型服务</label>
          <select value={provider} onChange={(event) => changeProvider(event.target.value as ProviderId)}>
            {PROVIDER_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
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
