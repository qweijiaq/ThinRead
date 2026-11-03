import { useState, type JSX } from 'react'

import { t, useLocale } from '../lib/i18n.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'

interface OnboardingDialogProps {
  hasSample: boolean
  demo: boolean
  onImportSample(): Promise<void>
  onOpenSample(): void
  onOpenImport(): void
  onOpenSettings(): void
  onClose(): void
}

const SAMPLE_TEXT = [
  '专注不是把注意力锁死在一个点上，而是不断把走神的自己带回来。',
  '许多人以为自己缺乏意志力，其实缺的是回到任务上的动作。',
  '作者提出，真正可靠的方法不是禁止分心，而是缩短发现自己分心的时间。',
  '当你能更早觉察，就更容易在注意力漂走之前把它拉回来。',
  '环境设计比反复下决心更有效：把诱人的选项移出视线，减少一次选择需要消耗的注意力。',
  '这并不是否认意志的作用，而是把意志用在设计环境上，而不是用在每一次抵抗诱惑上。',
  '把手机放到另一个房间，比在桌边反复对自己说“不要看”更可靠。',
  '每一次觉察都是一次微小的复位，复位越多，越不需要靠情绪推动自己。',
].join('')

export const SAMPLE_BOOK = {
  title: '示例：专注的练习',
  author: '页边示例',
  text: SAMPLE_TEXT,
}

export function OnboardingDialog({
  hasSample,
  demo,
  onImportSample,
  onOpenSample,
  onOpenImport,
  onOpenSettings,
  onClose,
}: OnboardingDialogProps): JSX.Element {
  useLocale()
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose, 'button')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function importSample(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await onImportSample()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop onboarding-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="onboarding-card"
        role="dialog"
        aria-modal="true"
        aria-label={t('首次使用引导')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="onboarding-head">
          <div>
            <span className="manual-kicker">FIRST RUN / 3 STEPS</span>
            <h2>{t('先把一本书跑通。')}</h2>
            <p>{t('不用先配 Key。用演示模式走完一遍；看到结果后，再决定用哪家模型。')}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        <ol className="onboarding-steps">
          <li className={hasSample ? 'is-done' : 'is-active'}>
            <span className="onboarding-no">01</span>
            <div>
              <h3>{t('导入一本示例书')}</h3>
              <p>{t('一两个章节、足够短，适合确认导入和生成流程。')}</p>
              <div className="onboarding-actions">
                {hasSample ? (
                  <span className="onboarding-done">{t('示例书已就绪')}</span>
                ) : (
                  <button type="button" className="primary-button small" onClick={() => void importSample()} disabled={busy}>
                    {busy ? t('正在导入…') : t('导入示例书')}
                  </button>
                )}
                <button type="button" className="text-button" onClick={onOpenImport}>
                  {t('导入我自己的书')}
                </button>
              </div>
            </div>
          </li>

          <li className={hasSample ? 'is-active' : ''}>
            <span className="onboarding-no">02</span>
            <div>
              <h3>{t('看一次演示生成')}</h3>
              <p>{t('打开示例书，点右侧「✦ 读薄并提炼」。演示模式会生成固定样例，引用不可校验，但能看到完整流程。')}</p>
              <div className="onboarding-actions">
                <button type="button" className="ghost-button small" onClick={onOpenSample} disabled={!hasSample}>
                  {t('打开示例书')}
                </button>
              </div>
            </div>
          </li>

          <li>
            <span className="onboarding-no">03</span>
            <div>
              <h3>{t('配置真实模型')}</h3>
              <p>
                {demo
                  ? t('当前仍是演示模式。看明白流程后，去设置选择服务商、粘贴 API Key，再点「测试连接」。')
                  : t('当前已经配置了真实模型。建议先跑一章快速档，确认质量和费用，再跑整本。')}
              </p>
              <div className="onboarding-actions">
                <button type="button" className="ghost-button small" onClick={onOpenSettings}>
                  {t('打开模型设置')}
                </button>
              </div>
            </div>
          </li>
        </ol>

        {error ? <div className="inline-error" role="alert">{error}</div> : null}

        <div className="onboarding-foot">
          <span>{t('完整说明在顶栏「?」或设置 →「使用手册」里。')}</span>
          <button type="button" className="text-button" onClick={onClose}>
            {t('跳过，先自己看看')}
          </button>
        </div>
      </div>
    </div>
  )
}
