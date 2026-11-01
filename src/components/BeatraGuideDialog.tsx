import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'

import { useDialogFocus } from '../lib/useDialogFocus.js'

interface BeatraGuideDialogProps {
  open: boolean
  onClose(): void
}

const AUTH_COMMAND =
  'python3 ~/.claude/skills/@beatra-ai/ai-podcast-voiceover/scripts/authorize.py'

export function BeatraGuideDialog({ open, onClose }: BeatraGuideDialogProps): JSX.Element | null {
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
        aria-label="Beatra 使用教程"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>Beatra 使用教程</h2>
            <p className="modal-subtitle">可选的付费 AI 配音。不配置也不影响阅读，Edge 和 Kokoro 可以免费用。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="beatra-guide-body">
          <section>
            <h3>1. 先确认你要不要用</h3>
            <p>
              Beatra 按字符计费，适合短章节、播客片段和重点段落。整本长书建议用免费的 Edge 在线音色或内置
              Kokoro；没有 Beatra 账号也不影响其他功能。
            </p>
          </section>

          <section>
            <h3>2. 获取 Device Token</h3>
            <p>
              ThinRead 使用 Beatra 的 Device Token，不是普通 API Key。先安装 Beatra Skill（如果你已经在 Claude Code
              里使用 Beatra，可以跳过安装），然后在终端运行授权脚本。需要 Python 3.10+。
            </p>
            <div className="beatra-command">
              <code>{AUTH_COMMAND}</code>
              <button type="button" className="text-button" onClick={() => void copyCommand()}>
                {copied ? '已复制' : '复制命令'}
              </button>
            </div>
            <p>
              脚本会打开 Beatra 授权页。登录或注册后点 <strong>Allow</strong>，等终端显示
              <code>Beatra is ready</code>。Token 只保存在本机{' '}
              <code>~/.beatra/credentials.json</code>，不要发给别人。
            </p>
          </section>

          <section>
            <h3>3. 在 ThinRead 里导入</h3>
            <ol>
              <li>打开右上角「设置」。</li>
              <li>找到「Beatra AI 配音」，点「导入本机授权」。</li>
              <li>点「测试 Beatra」，确认能看到音色列表。</li>
              <li>打开听读面板，音色引擎切到「Beatra 付费」，选择 A/B 中文音色。</li>
              <li>第一次播放会再次确认计费。</li>
            </ol>
          </section>

          <section>
            <h3>4. 计费和播放方式</h3>
            <p>
              Beatra 按字符计费，应用按句子逐段请求；同一句在本次面板内会缓存，重播不会重复计费。双人播客会分别请求
              A/B 音色再顺序播放，不做音频混音。
            </p>
            <p>
              音色列表里同时有中英文。中文稿请选「念念」「晨风」等中文音色，否则会听起来像外国口音。
            </p>
          </section>

          <section>
            <h3>常见问题</h3>
            <dl>
              <dt>设置一直显示「未配置」</dt>
              <dd>确认本机有 <code>~/.beatra/credentials.json</code>，再点一次「导入本机授权」。</dd>
              <dt>提示授权失效或 HTTP 401</dt>
              <dd>重新运行上面的授权命令，完成 Allow 后再导入一次。</dd>
              <dt>提示音频下载失败</dt>
              <dd>通常是网络、代理或 CDN 短时不可用；先切回 Edge/Kokoro，稍后重试。</dd>
              <dt>提示余额不足</dt>
              <dd>到 Beatra Console 充值，再点一次「测试 Beatra」。</dd>
            </dl>
          </section>

          <p className="beatra-guide-note">
            如果这些步骤对你来说太麻烦，直接用 Edge 或 Kokoro 就好。Beatra 只是给想要更高自然度的用户准备的。
          </p>
        </div>

        <div className="modal-footer">
          <span className="modal-meta">Token 用系统钥匙串加密保存在本机</span>
          <div className="modal-footer-actions">
            <button type="button" className="primary-button" onClick={onClose}>
              知道了
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
