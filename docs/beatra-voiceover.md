# Beatra AI 配音使用教程

Beatra 是 ThinRead 的可选付费配音服务。它不是使用 ThinRead 的必需品：不配置 Beatra 时，系统语音、Edge 在线音色和内置 Kokoro 仍然可用。

## 适合谁

- 想要比系统语音更自然的中文音色；
- 已经在使用 Beatra，或愿意注册 Beatra 并充值；
- 主要听短章节、播客或样音，而不是一次生成一整本长书。

Beatra 按字符计费。ThinRead 会按句子逐段请求，因此长章节会产生多次付费请求；使用前请先在设置里确认费用。

## 获取 Device Token

ThinRead 使用 Beatra 的 Device Token，不是普通 API Key。推荐用 Beatra Skill 完成授权：

1. 安装 Beatra Skill（如果你已经在 Claude Code 里使用 Beatra，可以跳过这一步）。
2. 在终端运行授权脚本。需要 Python 3.10 或更新版本：

   ```bash
   python3 ~/.claude/skills/@beatra-ai/ai-podcast-voiceover/scripts/authorize.py
   ```

   如果 `python3` 还是旧版本，可以指定新版本：

   ```bash
   /opt/homebrew/bin/python3.12 ~/.claude/skills/@beatra-ai/ai-podcast-voiceover/scripts/authorize.py
   ```

3. 脚本会打开 Beatra 授权页。登录或注册 Beatra，然后点 **Allow**。
4. 终端出现下面的文字，说明授权成功：

   ```text
   Beatra is ready
   ```

   Token 会保存到本机：

   ```text
   ~/.beatra/credentials.json
   ```

不要把 Token 发到聊天、日志或截图里。

## 在 ThinRead 里配置

1. 打开右上角 **设置**。
2. 找到 **Beatra AI 配音**。
3. 点 **导入本机授权**。ThinRead 会读取上面的凭证文件，并用系统钥匙串加密保存。
4. 点 **测试 Beatra**，确认能看到可用音色。
5. 打开任意章节的 **听读** 或双人播客的 **听**。
6. 将「音色引擎」切换到 **Beatra 付费**，选择 A/B 音色，点击播放。

第一次播放会弹出计费确认。确认后，ThinRead 才会向 Beatra 发起付费合成。

## 计费和声音

- Beatra 按字符计费，账户需要额度；额度不足时会返回错误。
- ThinRead 先按句子合成，再顺序播放；同一句在本次面板内会缓存，重播不会重复计费。
- 双人播客会分别请求 A/B 音色再顺序播放，不做音频混音。
- Beatra 同时提供中英文音色。默认优先选择中文音色；如果听不到中文，检查 A/B 是否选成了英文音色。
- 长书或长章节建议使用 Edge 在线或 Kokoro 本地；Beatra 更适合短样音、播客片段或重点章节。

## 常见问题

### 设置里一直显示「未配置」

授权文件没有被导入。先确认 `~/.beatra/credentials.json` 存在，再到设置里点「导入本机授权」。

### 提示授权失效或 HTTP 401

重新运行授权脚本，完成 Allow 后再导入一次：

```bash
/opt/homebrew/bin/python3.12 ~/.claude/skills/@beatra-ai/ai-podcast-voiceover/scripts/authorize.py
```

### 提示音频下载失败

ThinRead 会分别尝试 Electron 网络栈、无 Authorization 的公共 CDN 地址和 Node fetch。如果仍然失败，通常是网络、代理或 CDN 短时不可用；稍后重试，或先切回 Edge/Kokoro。

### 提示余额不足

到 Beatra Console 充值。充值后回到设置点一次「测试 Beatra」，再重新播放。

### 声音是英文或有口音

在听读面板把 A/B 音色切到中文音色（如「念念」「晨风」）。Beatra 的音色列表同时包含英文音色。

## 安全说明

- Token 只保存在本机，ThinRead 使用系统钥匙串加密。
- 只有你主动播放 Beatra 时，朗读文本才会发送到 Beatra。
- Beatra 的音频从官方 CDN 下载；ThinRead 不会把音频上传到其他服务。
