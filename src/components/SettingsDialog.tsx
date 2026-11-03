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
import { setLocale, t, useLocale } from '../lib/i18n.js'
import { getAutoNext, getDailyGoal, setAutoNext, setDailyGoal } from '../lib/preferences.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'
import { BeatraGuideDialog } from './BeatraGuideDialog.js'
import { Checkbox } from './Checkbox.js'
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
  onOpenManual(): void
  onOpenOnboarding(): void
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
  onOpenManual,
  onOpenOnboarding,
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
  const [beatraToken, setBeatraToken] = useState('')
  const [beatraTest, setBeatraTest] = useState<TestResult | null>(null)
  const [openaiTtsBaseUrl, setOpenaiTtsBaseUrl] = useState(settings.openaiTtsBaseUrl)
  const [openaiTtsModel, setOpenaiTtsModel] = useState(settings.openaiTtsModel)
  const [openaiTtsVoiceA, setOpenaiTtsVoiceA] = useState(settings.openaiTtsVoiceA)
  const [openaiTtsVoiceB, setOpenaiTtsVoiceB] = useState(settings.openaiTtsVoiceB)
  const [openaiTtsKey, setOpenaiTtsKey] = useState('')
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
  const [guideOpen, setGuideOpen] = useState(false)

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
    setBeatraToken('')
    setBeatraTest(null)
    setOpenaiTtsBaseUrl(settings.openaiTtsBaseUrl)
    setOpenaiTtsModel(settings.openaiTtsModel)
    setOpenaiTtsVoiceA(settings.openaiTtsVoiceA)
    setOpenaiTtsVoiceB(settings.openaiTtsVoiceB)
    setOpenaiTtsKey('')
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
        ...(beatraToken.trim() ? { beatraToken: beatraToken.trim() } : {}),
        openaiTtsBaseUrl,
        openaiTtsModel,
        openaiTtsVoiceA,
        openaiTtsVoiceB,
        ...(openaiTtsKey.trim() ? { openaiTtsKey: openaiTtsKey.trim() } : {}),
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
      const saved = await window.api.exportBackup(latest.id)
      if (saved.saved) setBackupNotice(`${t('备份已导出到')} ${saved.path}`)
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
      const saved = await window.api.exportDiagnostics()
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
      setReadwiseTest(await window.api.testReadwise(readwiseToken.trim() || undefined))
    } catch (error) {
      setReadwiseTest({ ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  }

  async function testBeatraToken(): Promise<void> {
    setBeatraTest(null)
    try {
      setBeatraTest(await window.api.testBeatra(beatraToken.trim() || undefined))
    } catch (error) {
      setBeatraTest({ ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  }

  async function importBeatraCredential(): Promise<void> {
    setBeatraTest(null)
    try {
      const imported = await window.api.importBeatraCredential()
      setBeatraTest(imported)
      if (imported.ok) onSaved(await window.api.getSettings())
    } catch (error) {
      setBeatraTest({ ok: false, message: error instanceof Error ? error.message : String(error) })
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
      await window.api.restoreBackup(item.id)
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
    <>
      <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal"
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

        <div className="form-row">
          <label>{t('界面语言（Beta）')}</label>
          <div className="segmented theme-segmented">
            <button type="button" className={locale === 'zh' ? 'active' : ''} onClick={() => setLocale('zh')}>
              中文
            </button>
            <button type="button" className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>
              English
            </button>
          </div>
          <p className="field-hint">{t('主要界面已支持英文，剩余界面仍在迁移。')}</p>
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
              <input value={model} onChange={(event) => setModel(event.target.value)} placeholder={t('模型 ID')} spellCheck={false} />
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
            <div className="form-row">
              <label>{t('任务模型覆盖')}</label>
              <div className="task-model-grid">
                <input value={notesModel} onChange={(event) => setNotesModel(event.target.value)} placeholder={t('读薄模型（留空用默认）')} spellCheck={false} />
                <input value={composeModel} onChange={(event) => setComposeModel(event.target.value)} placeholder={t('成稿模型（留空用默认）')} spellCheck={false} />
                <input value={labModel} onChange={(event) => setLabModel(event.target.value)} placeholder={t('工作台模型（留空用默认）')} spellCheck={false} />
              </div>
              <p className="field-hint">{t('只覆盖模型 ID，Base URL 和 Key 继续使用上面的服务商。')}</p>
            </div>
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
          <label>{t('Beatra AI 配音')}</label>
          <input
            type="password"
            value={beatraToken}
            onChange={(event) => setBeatraToken(event.target.value)}
            placeholder={settings.beatraConfigured ? t('已保存，留空则不修改') : t('可选，填写 Beatra Device Token')}
            spellCheck={false}
          />
          <p className="field-hint">
            {t('用于付费 AI 配音。已安装 Beatra Skill 的话，先运行它的 authorize.py，再点「导入本机授权」；也可以手动填写 Device Token。Token 用系统钥匙串加密保存在本机，Beatra 按字符计费。')}
          </p>
          <div className="backup-actions">
            <button type="button" className="ghost-button small" onClick={() => void testBeatraToken()}>
              {t('测试 Beatra')}
            </button>
            <button type="button" className="ghost-button small" onClick={() => void importBeatraCredential()}>
              {t('导入本机授权')}
            </button>
            <button type="button" className="ghost-button small" onClick={() => setGuideOpen(true)}>
              {t('查看教程')}
            </button>
          </div>
          {beatraTest ? (
            <div className={`test-result ${beatraTest.ok ? 'ok' : 'fail'}`}>{beatraTest.message}</div>
          ) : null}
          <details className="beatra-guide">
            <summary>{t('Beatra 怎么配置？')}</summary>
            <ol>
              <li>{t('确认 Beatra 账户有额度，并安装 Beatra Skill。')}</li>
              <li>
                在终端运行 <code>python3 ~/.claude/skills/@beatra-ai/ai-podcast-voiceover/scripts/authorize.py</code>
                {t('，登录后点 Allow，直到终端显示 Beatra is ready。')}
              </li>
              <li>{t('回到这里点「导入本机授权」，再点「测试 Beatra」。')}</li>
              <li>{t('在听读面板选择「Beatra 付费」，选 A/B 中文音色。首次播放会确认计费。')}</li>
            </ol>
            <p>{t('需要 Python 3.10+；没有 Beatra 的话，可以继续使用免费的 Edge 在线音色。')}</p>
          </details>
        </div>

        <div className="form-row">
          <label>{t('OpenAI 兼容 TTS')}</label>
          <input
            value={openaiTtsBaseUrl}
            onChange={(event) => setOpenaiTtsBaseUrl(event.target.value)}
            placeholder="https://api.openai.com/v1"
            spellCheck={false}
          />
          <div className="form-row-inline">
            <input
              value={openaiTtsModel}
              onChange={(event) => setOpenaiTtsModel(event.target.value)}
              placeholder="gpt-4o-mini-tts"
              spellCheck={false}
            />
            <input
              value={openaiTtsVoiceA}
              onChange={(event) => setOpenaiTtsVoiceA(event.target.value)}
              placeholder={t('A 音色，如 alloy')}
            />
            <input
              value={openaiTtsVoiceB}
              onChange={(event) => setOpenaiTtsVoiceB(event.target.value)}
              placeholder={t('B 音色，如 verse')}
            />
          </div>
          <input
            type="password"
            value={openaiTtsKey}
            onChange={(event) => setOpenaiTtsKey(event.target.value)}
            placeholder={settings.openaiTtsConfigured ? t('已保存，留空则不修改') : t('可选，填写 TTS API Key')}
            spellCheck={false}
          />
          <p className="field-hint">
            {t('任何兼容 /audio/speech 的服务都可以，例如 OpenAI gpt-4o-mini-tts、SiliconFlow 或自建网关。按字符计费，文本会发到你配置的服务；Key 用系统钥匙串加密保存在本机。')}
          </p>
        </div>

        <div className="settings-divider" />

        <div className="form-row">
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
            <button type="button" className="text-button muted" onClick={() => void window.api.openBackupsDir()}>
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

        {result ? <div className={`test-result ${result.ok ? 'ok' : 'fail'}`}>{result.message}</div> : null}

        <div className="modal-footer">
          <button type="button" className="text-button muted" onClick={() => void window.api.openDataDir()}>
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
      <BeatraGuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} />
    </>
  )
}
