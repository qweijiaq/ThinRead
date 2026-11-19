import { useEffect, useState, type JSX } from 'react'

import type { SyncSnapshot, WebDavConfigView, WebDavInspection } from '../../shared/types.js'
import { bridge } from '../lib/bridge.js'
import { t } from '../lib/i18n.js'
import { confirmDialog } from './ConfirmDialog.js'

function formatTime(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

/** WebDAV 快照同步：和本地文件夹同步一样是手动快照，不实时改动远端。 */
export function WebDavPanel(): JSX.Element {
  const [config, setConfig] = useState<WebDavConfigView | null>(null)
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remotePath, setRemotePath] = useState('ThinRead')
  const [passphrase, setPassphrase] = useState('')
  const [notesOnly, setNotesOnly] = useState(false)
  const [autoPushDaily, setAutoPushDaily] = useState(false)
  const [checkOnStartup, setCheckOnStartup] = useState(true)
  const [snapshots, setSnapshots] = useState<SyncSnapshot[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [remoteNew, setRemoteNew] = useState(false)
  const [inspection, setInspection] = useState<WebDavInspection | null>(null)

  useEffect(() => {
    void bridge
      .getWebDavConfig()
      .then((next) => {
        setConfig(next)
        setUrl(next.url)
        setUsername(next.username)
        setRemotePath(next.remotePath)
        setAutoPushDaily(next.autoPushDaily)
        setCheckOnStartup(next.checkOnStartup)
        if (next.url) {
          void bridge.listWebDavSnapshots().then((items) => {
            setSnapshots(items)
            const latest = items[0]?.createdAt ?? ''
            setRemoteNew(Boolean(latest && latest > (next.lastPullAt || next.lastPushAt || '')))
          }).catch(() => undefined)
        }
      })
      .catch(() => undefined)
  }, [])

  async function saveAndTest(): Promise<void> {
    setBusy('test')
    setNotice(null)
    try {
      const next = await bridge.saveWebDavConfig({ url, username, password, remotePath, autoPushDaily, checkOnStartup })
      setConfig(next)
      setPassword('')
      const result = await bridge.testWebDav()
      setNotice(result.message)
      if (result.ok) {
        const items = await bridge.listWebDavSnapshots()
        setSnapshots(items)
        setRemoteNew(Boolean(items[0]?.createdAt && items[0].createdAt > (next.lastPullAt || next.lastPushAt || '')))
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  async function push(): Promise<void> {
    setBusy('push')
    setNotice(null)
    try {
      const snapshot = notesOnly
        ? await bridge.pushWebDavNotesSnapshot(passphrase)
        : await bridge.pushWebDavSnapshot(passphrase)
      setSnapshots(await bridge.listWebDavSnapshots())
      setRemoteNew(false)
      setNotice(`${t('已推送到 WebDAV')}：${snapshot.name}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  async function inspect(name: string): Promise<void> {
    setBusy(name)
    setNotice(null)
    try {
      setInspection(await bridge.inspectWebDavSnapshot(name, passphrase))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  async function merge(name: string): Promise<void> {
    setBusy(name)
    setNotice(null)
    try {
      const result = await bridge.mergeWebDavSnapshot(name, passphrase)
      setNotice(
        `${t('已合并')} · ${t('书')} ${result.books} · ${t('章节')} ${result.chapters} · ${t('笔记')} ${result.notes} · ${t('标注')} ${result.annotations} · ${t('书签')} ${result.bookmarks}`,
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  async function pull(name: string): Promise<void> {
    if (busy) return
    const confirmed = await confirmDialog({
      title: t('从 WebDAV 恢复整库'),
      message: t('恢复会用远端快照覆盖当前的书、笔记和设置。应用会先自动备份当前状态，但本地较新的内容不会自动合并。继续？'),
      confirmLabel: t('恢复并重载'),
      danger: true,
    })
    if (!confirmed) return
    setBusy(name)
    setNotice(null)
    try {
      await bridge.pullWebDavSnapshot(name, passphrase)
      setNotice(t('已从 WebDAV 恢复；应用会重新加载。'))
      window.setTimeout(() => window.location.reload(), 800)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  async function remove(name: string): Promise<void> {
    if (busy) return
    const confirmed = await confirmDialog({
      title: t('删除远端同步快照'),
      message: t('会从 WebDAV 删除这份快照，删除后无法恢复。继续？'),
      confirmLabel: t('删除'),
      danger: true,
    })
    if (!confirmed) return
    setBusy(name)
    try {
      await bridge.deleteWebDavSnapshot(name)
      setSnapshots(await bridge.listWebDavSnapshots())
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="form-row settings-advanced">
      <label>{t('WebDAV 同步')}</label>
      <div className="webdav-fields">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://dav.example.com/remote.php/dav/files/me"
          aria-label={t('WebDAV 地址')}
        />
        <input
          value={remotePath}
          onChange={(event) => setRemotePath(event.target.value)}
          placeholder="ThinRead"
          aria-label={t('WebDAV 目录')}
        />
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder={t('用户名')}
          aria-label={t('WebDAV 用户名')}
          autoComplete="username"
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={config?.hasPassword ? t('已保存密码，留空不修改') : t('密码 / 应用专用密码')}
          aria-label={t('WebDAV 密码')}
          autoComplete="current-password"
        />
      </div>
      <div className="backup-actions">
        <button type="button" className="ghost-button small" onClick={() => void saveAndTest()} disabled={busy !== null}>
          {busy === 'test' ? t('连接中…') : t('保存并测试')}
        </button>
        <button type="button" className="ghost-button small" onClick={() => void push()} disabled={busy !== null || !config?.url}>
          {busy === 'push' ? t('推送中…') : t('推送到 WebDAV')}
        </button>
        <input
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          placeholder={t('快照加密口令（可选）')}
          aria-label={t('WebDAV 快照口令')}
          autoComplete="new-password"
        />
      </div>
      <div className="backup-actions">
        <label className="checkbox-label">
          <input type="checkbox" checked={notesOnly} onChange={(event) => setNotesOnly(event.target.checked)} />
          {t('只传笔记库（不含书文件）')}
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={autoPushDaily} onChange={(event) => setAutoPushDaily(event.target.checked)} />
          {t('每天自动推送一次笔记库')}
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={checkOnStartup} onChange={(event) => setCheckOnStartup(event.target.checked)} />
          {t('启动时检查远端更新')}
        </label>
      </div>
      <p className="field-hint">
        {t('WebDAV 适合 Nextcloud、坚果云、群晖等；推送会把整库打包成一份快照，不会实时同步。恢复前会自动做本地安全备份。')}
      </p>
      {config?.lastPushAt ? (
        <p className="field-hint">{`${t('上次推送')}：${formatTime(config.lastPushAt)}${config.lastPullAt ? ` · ${t('上次恢复')}：${formatTime(config.lastPullAt)}` : ''}`}</p>
      ) : null}
      {remoteNew ? (
        <div className="inline-notice" role="status" aria-live="polite">
          {t('远端有新的同步快照。建议先点「合并笔记」，确认没问题再整库恢复。')}
        </div>
      ) : null}
      {inspection ? (
        <div className="inline-notice" role="status">
          <div>{t('本地')}：{t('笔记')} {inspection.local.notes} · {t('标注')} {inspection.local.annotations} · {t('书签')} {inspection.local.bookmarks} · {t('位置')} {inspection.local.positions}</div>
          <div>{t('远端')}：{t('笔记')} {inspection.remote.notes} · {t('标注')} {inspection.remote.annotations} · {t('书签')} {inspection.remote.bookmarks} · {t('位置')} {inspection.remote.positions}</div>
        </div>
      ) : null}
      {notice ? <div className="inline-notice" role="status" aria-live="polite">{notice}</div> : null}
      {snapshots.length > 0 ? (
        <div className="backup-list">
          {snapshots.map((item) => (
            <div key={item.name} className="backup-row">
              <div className="backup-row-main">
                <strong>{formatTime(item.createdAt)}</strong>
                <span>
                  {item.notesOnly ? t('笔记库 · 只可合并') : t('整库')}
                  {' · '}
                  {item.encrypted ? t('已加密') : t('未加密')}
                </span>
              </div>
              <div className="backup-row-actions">
                <button type="button" className="text-button" onClick={() => void inspect(item.name)} disabled={busy !== null}>
                  {t('比较')}
                </button>
                <button type="button" className="text-button" onClick={() => void merge(item.name)} disabled={busy !== null}>
                  {t('合并笔记')}
                </button>
                {item.notesOnly ? null : (
                  <button type="button" className="text-button" onClick={() => void pull(item.name)} disabled={busy !== null}>
                    {busy === item.name ? t('恢复中…') : t('恢复')}
                  </button>
                )}
                <button type="button" className="text-button danger" onClick={() => void remove(item.name)} disabled={busy !== null}>
                  {t('删除')}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
