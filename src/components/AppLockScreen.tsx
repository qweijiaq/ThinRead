import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'

import { bridge } from '../lib/bridge.js'
import { t, useLocale } from '../lib/i18n.js'

interface AppLockScreenProps {
  onUnlock(passcode: string): Promise<boolean>
}

const MAX_ATTEMPTS = 5
const COOLDOWN_SECONDS = 10

export function AppLockScreen({ onUnlock }: AppLockScreenProps): JSX.Element {
  useLocale()
  const inputRef = useRef<HTMLInputElement>(null)
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failures, setFailures] = useState(0)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!passcode.trim() || busy || cooldown > 0) return
    setBusy(true)
    setError(null)
    try {
      const ok = await onUnlock(passcode)
      if (!ok) {
        const next = failures + 1
        setFailures(next)
        setPasscode('')
        if (next >= MAX_ATTEMPTS) {
          setFailures(0)
          setCooldown(COOLDOWN_SECONDS)
          setError(`${t('尝试次数过多，请')} ${COOLDOWN_SECONDS} ${t('秒后再试。')}`)
        } else {
          setError(`${t('密码不对，请再试一次。')}${MAX_ATTEMPTS - next <= 2 ? ` ${t('还可以尝试')} ${MAX_ATTEMPTS - next} ${t('次尝试。')}` : ''}`)
        }
        inputRef.current?.focus()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-lock-screen">
      <form className="app-lock-card" onSubmit={(event) => void submit(event)}>
        <span className="manual-kicker">THINREAD LOCK</span>
        <h1>{t('页边已锁定')}</h1>
        <p>{t('输入应用锁密码继续。密码只保存在本机；忘记后可以打开数据目录，删除 settings.json 里的 lock 字段再重启。')}</p>
        <input
          ref={inputRef}
          type="password"
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          placeholder={cooldown > 0 ? `${t('请等待')} ${cooldown} ${t('秒')}` : t('应用锁密码')}
          autoFocus
          autoComplete="current-password"
          spellCheck={false}
          disabled={cooldown > 0}
        />
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        <button type="submit" className="primary-button" disabled={busy || cooldown > 0 || !passcode.trim()}>
          {busy ? t('解锁中…') : cooldown > 0 ? `${t('请等待')} ${cooldown}s` : t('解锁')}
        </button>
        <button type="button" className="text-button muted" onClick={() => void bridge.openDataDir()}>
          {t('打开数据目录')}
        </button>
      </form>
    </div>
  )
}
