# 参与贡献

感谢你愿意一起把页边 ThinRead 做得更好。这个项目是本地优先的桌面应用，改动会直接接触用户的书籍、笔记和 API Key，所以提交前请尽量保守、可验证。

## 开发环境

- Node.js >= 22
- pnpm 10+
- macOS（阅读器 UI 冒烟和视觉基线目前只在 macOS 上验证）

```bash
pnpm install
pnpm dev
```

第一次启动是空书架。可以导入 `samples/sample.epub`，保持在演示模式，不需要 API Key。

## 提交前检查

```bash
pnpm typecheck
pnpm test
pnpm build
```

涉及界面、阅读器、分享卡、小红书、听读或设置页时，再运行：

```bash
pnpm test:ui
```

只改 UI 时，建议同时跑 Storybook：

```bash
pnpm storybook
pnpm build-storybook
```

## 视觉基线

分享卡和小红书的视觉基线依赖 macOS 系统字体，非 macOS 环境会自动跳过哈希校验。

确认视觉改动符合预期后，在 macOS 上更新基线：

```bash
UPDATE_VISUAL=1 pnpm test
```

提交时请一并附上改动前后的 Storybook 截图，方便 review。

## 代码约定

- TypeScript，尽量不引入新依赖；需要新依赖时先在 issue 里说明用途和替代方案。
- 界面文案优先走 `t()`，中文是默认语言，英文可以逐步补齐。
- 不提交真实 API Key、Token、用户书籍、笔记、数据库或备份文件。
- 数据库迁移要可重复执行，不要假设用户从空库开始。
- 涉及删除、覆盖、恢复、导入导出的改动，优先补单测和失败路径。
- 提交信息尽量使用 `feat:`、`fix:`、`docs:`、`chore:`、`refactor:` 前缀。

## 数据与隐私

- 书籍正文、笔记、统计和设置默认保存在本机。
- 调用在线模型或千问 TTS 时，对应文本会发送给服务商；不要提交包含真实书籍内容的测试夹具。
- `settings.json` 里的 Key 使用系统钥匙串加密，但数据库本身目前是明文。
- 应用锁是本地界面隐私层，不是数据库加密。

## 提问与讨论

- Bug：使用 Bug report issue 模板，附上系统版本、复现步骤和日志。
- 功能建议：先描述使用场景和现有替代方案，再讨论实现。
- 安全问题：不要公开贴 exploit，按 [SECURITY.md](SECURITY.md) 私下报告。
