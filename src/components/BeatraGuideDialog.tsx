import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'

import { t, useLocale } from '../lib/i18n.js'
import { useDialogFocus } from '../lib/useDialogFocus.js'

interface BeatraGuideDialogProps {
  open: boolean
  onClose(): void
}

const AUTH_COMMAND =
  'python3 ~/.claude/skills/@beatra-ai/ai-podcast-voiceover/scripts/authorize.py'

export function BeatraGuideDialog({ open, onClose }: BeatraGuideDialogProps): JSX.Element | null {
  useLocale()
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose, 'button')
  const [copied, setCopied] = useState(false)
  if (!open) return null

  async function copyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(AUTH_COMMAND)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // 复制失败时用户仍可手动选中命令。
    }
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal beatra-guide-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('Beatra 使用教程')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{t('Beatra 使用教程')}</h2>
            <p className="modal-subtitle">{t('可选的付费 AI 配音。不配置也不影响阅读，Edge 在线音色可以免费用。')}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            ×
          </button>
        </div>

        <div className="beatra-guide-body">
          <section>
            <h3>{t('1. 先确认你要不要用')}</h3>
            <p>{t('Beatra 按字符计费，适合短章节和重点段落。整本长书建议用免费的 Edge 在线音色；没有 Beatra 账号也不影响其他功能。')}</p>
          </section>

          <section>
            <h3>{t('2. 获取 Device Token')}</h3>
            <p>{t('ThinRead 使用 Beatra 的 Device Token，不是普通 API Key。先安装 Beatra Skill（如果你已经在 Claude Code 里使用 Beatra，可以跳过安装），然后在终端运行授权脚本。需要 Python 3.10+。')}</p>
            <div className="beatra-command">
              <code>{AUTH_COMMAND}</code>
              <button type="button" className="text-button" onClick={() => void copyCommand()}>
                {copied ? t('已复制') : t('复制命令')}
              </button>
            </div>
            <p>
              {t('脚本会打开 Beatra 授权页。登录或注册后点')} <strong>Allow</strong>
              {t('，等终端显示')} <code>Beatra is ready</code>
              {t('。Token 只保存在本机')} <code>~/.beatra/credentials.json</code>
              {t('，不要发给别人。')}
            </p>
          </section>

          <section>
            <h3>{t('3. 在 ThinRead 里导入')}</h3>
            <ol>
              <li>{t('打开右上角「设置」。')}</li>
              <li>{t('找到「Beatra AI 配音」，点「导入本机授权」。')}</li>
              <li>{t('点「测试 Beatra」，确认能看到音色列表。')}</li>
              <li>{t('打开听读面板，音色引擎切到「Beatra 付费」，选择 A/B 中文音色。')}</li>
              <li>{t('第一次播放会再次确认计费。')}</li>
            </ol>
          </section>

          <section>
            <h3>{t('4. 计费和播放方式')}</h3>
            <p>{t('Beatra 按字符计费，应用按句子逐段请求；同一句在本次面板内会缓存，重播不会重复计费。听读面板对带 A/B 标记的对白会分别请求音色再顺序播放，不做音频混音。')}</p>
            <p>{t('音色列表里同时有中英文。中文稿请选「念念」「晨风」等中文音色，否则会听起来像外国口音。')}</p>
          </section>

          <section>
            <h3>{t('常见问题')}</h3>
            <dl>
              <dt>{t('设置一直显示「未配置」')}</dt>
              <dd>{t('确认本机有')} <code>~/.beatra/credentials.json</code>{t('，再点一次「导入本机授权」。')}</dd>
              <dt>{t('提示授权失效或 HTTP 401')}</dt>
              <dd>{t('重新运行上面的授权命令，完成 Allow 后再导入一次。')}</dd>
              <dt>{t('提示音频下载失败')}</dt>
              <dd>{t('通常是网络、代理或 CDN 短时不可用；先切回 Edge 在线音色，稍后重试。')}</dd>
              <dt>{t('提示余额不足')}</dt>
              <dd>{t('到 Beatra Console 充值，再点一次「测试 Beatra」。')}</dd>
            </dl>
          </section>

          <p className="beatra-guide-note">{t('如果这些步骤对你来说太麻烦，直接用 Edge 在线音色就好。Beatra 只是给想要更高自然度的用户准备的。')}</p>
        </div>

        <div className="modal-footer">
          <span className="modal-meta">{t('Token 用系统钥匙串加密保存在本机')}</span>
          <div className="modal-footer-actions">
            <button type="button" className="primary-button" onClick={onClose}>
              {t('知道了')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
