# 扩展能力声明

ThinRead 目前不提供公开插件市场。先定义一份能力清单，未来接入手写插件、浏览器扩展或第三方工具时，安装时必须显式展示并授权。

## 能力清单

| 能力 | 允许做什么 | 默认 |
| --- | --- | --- |
| `browser:capture` | 读取当前标签页的 URL、标题和选中文字，并发送收录深链 | 浏览器扩展 |
| `reader:quote` | 读取当前章节的划线/引用文本 | 关闭 |
| `notes:write` | 创建或修改笔记 | 关闭 |
| `model:call` | 代表用户调用已配置的模型服务 | 关闭 |
| `network:fetch` | 访问声明的外部 HTTP 端点 | 关闭 |
| `ui:panel` | 在阅读器或工作台增加面板 | 关闭 |

## 约定

- 扩展在 `manifest.json` 里通过 `thinread.capabilities` 声明能力，例如：

```json
{
  "thinread": {
    "capabilities": ["browser:capture"]
  }
}
```

- 声明的能力必须和实际权限一致；浏览器扩展不能声明 `browser:capture` 却申请浏览历史或 `<all_urls>`。
- 不执行远程代码，不使用 `eval`，不上传书籍正文或笔记内容。
- 能力清单是破坏性变更边界：新增能力属于兼容变更；删除、改名或改变语义属于破坏性变更，需要提升扩展的主版本。
- `pnpm check:extensions` 会校验内置扩展的 manifest、能力名和明显超范围权限。

## 当前扩展

- `browser-extension/`：声明 `browser:capture`，只使用 `activeTab` 和 `scripting`。
