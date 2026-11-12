import { useState, type JSX } from 'react'

import { t, useLocale } from '../lib/i18n.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'

interface OnboardingDialogProps {
  hasSample: boolean
  demo: boolean
  onImportSample(): Promise<string | null>
  onOpenSample(bookId?: string): void
  onOpenImport(): void
  onOpenSettings(): void
  onClose(): void
}

const SAMPLE_TEXT = [
  '## 第一章 注意力不是锁死，而是复位',
  '',
  '很多人把专注想象成一种状态：坐下来，注意力像一束光一样钉在任务上，直到完成。',
  '但真实的专注更像一次次的复位。你会在阅读时想到晚饭、在写作时想起一条没回的消息，',
  '关键不在于从不走神，而在于多快发现自己走神，并把注意力带回来。',
  '',
  '作者把这个过程叫作「觉察—复位」。觉察越早，复位越轻；如果等到刷了二十分钟手机才反应过来，',
  '复位就需要消耗更多情绪和意志。换句话说，意志力不是用来对抗分心的，而是用来完成复位的。',
  '',
  '一个常见的误解是：只要决心够强，就不会分心。作者不同意。决心只能决定你愿不愿意回来，',
  '不能决定你多快发现自己在往外走。真正可以训练的是觉察的速度。',
  '',
  '## 第二章 环境比决心可靠',
  '',
  '如果觉察需要消耗注意力，那么最划算的做法，是减少需要觉察的机会。',
  '把手机放到另一个房间，比在桌边反复对自己说「不要看」更可靠；',
  '把第二天要用的资料提前打开，比早上坐下来再找更可靠。',
  '',
  '这不是否认意志的作用，而是把意志用在设计环境上，而不是用在每一次抵抗诱惑上。',
  '作者举了一个例子：同样是想少刷短视频，卸载应用比每天限制自己只刷十分钟更容易坚持，',
  '因为前者只需要做一次决定，后者需要每天做很多次决定。',
  '',
  '环境设计也有边界。它不能替你决定要做什么，只能减少做正确的事的摩擦。',
  '方向仍然要由人自己选；选好之后，再让环境替你守住它。',
].join('\n')

export const SAMPLE_BOOK = {
  title: t('示例：把注意力带回来'),
  author: t('页边示例'),
  text: SAMPLE_TEXT,
}

const EXAMPLE_ORIGINAL =
  '专注不是把注意力锁死在一个点上，而是不断把走神的自己带回来。许多人以为自己缺乏意志力，其实缺的是回到任务上的动作。'

const EXAMPLE_DRAFT = [
  '专注不是一种持续紧绷的状态，而是一连串「发现走神—把注意力带回来」的动作。',
  '真正稀缺的不是意志力，而是觉察的速度：越早发现自己飘走，复位消耗的注意力越少。',
].join('')

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
      const bookId = await onImportSample()
      if (bookId) onOpenSample(bookId)
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
            <span className="manual-kicker">START HERE / 3 MINUTES</span>
            <h2>{t('先看看它能把一章变成什么。')}</h2>
            <p>{t('不用先配 Key。用一本两章的示例书走一遍，看到改写结果后再决定要不要用自己的书。')}</p>
            <p className="onboarding-privacy">
              {t('书和笔记保存在本机；使用真实模型时，相关正文和图片会发送给你选择的模型服务商。')}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        <div className="onboarding-example" aria-label={t('改写效果示例')}>
          <div>
            <span className="onboarding-example-label">{t('原文')}</span>
            <p>{t(EXAMPLE_ORIGINAL)}</p>
          </div>
          <div className="is-draft">
            <span className="onboarding-example-label">{t('改写后')}</span>
            <p>{t(EXAMPLE_DRAFT)}</p>
          </div>
        </div>

        <ol className="onboarding-steps">
          <li className={hasSample ? 'is-done' : 'is-active'}>
            <span className="onboarding-no">01</span>
            <div>
              <h3>{t('打开示例书')}</h3>
              <p>{t('两章、带小标题和例子，足够看出「读薄」和「卡片」到底长什么样。')}</p>
              <div className="onboarding-actions">
                {hasSample ? (
                  <button type="button" className="primary-button small" onClick={() => onOpenSample()}>
                    {t('打开示例书')}
                  </button>
                ) : (
                  <button type="button" className="primary-button small" onClick={() => void importSample()} disabled={busy}>
                    {busy ? t('正在导入…') : t('导入并打开示例书')}
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
              <h3>{t('点一次「改写成文章」')}</h3>
              <p>{t('打开示例书后，点右侧「✦ 改写成文章」。演示模式会给出固定样例，但流程和真实生成一致。')}</p>
              <div className="onboarding-actions">
                <button type="button" className="ghost-button small" onClick={() => onOpenSample()} disabled={!hasSample}>
                  {t('打开示例书')}
                </button>
              </div>
            </div>
          </li>

          <li>
            <span className="onboarding-no">03</span>
            <div>
              <h3>{t('配置真实模型（可选）')}</h3>
              <p>
                {demo
                  ? t('想用自己的书时再配置。选服务商、粘贴 API Key，点「测试连接」即可。')
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
          <span>
            {t('读薄 = 把一章改写成可发布文章；卡片 = 核心观点；成书 = 把整本读薄稿合成一篇长文。完整说明在顶栏「?」或设置 →「使用手册」里。')}
          </span>
          <button type="button" className="text-button" onClick={onClose}>
            {t('跳过，先自己看看')}
          </button>
        </div>
      </div>
    </div>
  )
}
