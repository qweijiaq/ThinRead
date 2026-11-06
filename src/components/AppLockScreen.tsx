import { useRef, useState, type FormEvent, type JSX } from 'react'

import { t, useLocale } from '../lib/i18n.js'

interface AppLockScreenProps {
  onUnlock(passcode: string): Promise<boolean>
}

export function AppLockScreen({ onUnlock }: AppLockScreenProps): JSX.Element {
  useLocale()
  const inputRef = useRef<HTMLInputElement>(null)
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!passcode.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const ok = await onUnlock(passcode)
      if (!ok) {
        setError(t('密码不对，请再试一次。'))
        setPasscode('')
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
        <p>{t('输入应用锁密码继续。密码只保存在本机，忘记后需要手动删除 settings.json 里的 lock 字段。')}</p>
        <input
          ref={inputRef}
          type="password"
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          placeholder={t('应用锁密码')}
          autoFocus
          autoComplete="current-password"
          spellCheck={false}
        />
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        <button type="submit" className="primary-button" disabled={busy || !passcode.trim()}>
          {busy ? t('解锁中…') : t('解锁')}
        </button>
      </form>
    </div>
  )
}
