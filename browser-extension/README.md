# ThinRead 网页收录扩展

一个最小 Chrome / Edge 扩展：把当前网页收录成 ThinRead 里的一本书；如果页面上有选中文字，会同时存成一条高亮笔记。

## 安装

1. 先安装或运行 ThinRead（开发版也可以）。
2. 打开 `chrome://extensions`，开启右上角「开发者模式」。
3. 点「加载已解压的扩展程序」，选择本目录 `browser-extension/`。
4. 打开任意网页，点工具栏里的 ThinRead 图标。

## 使用

- **收录整页**：把当前 URL 导入 ThinRead，按网页正文生成章节。
- **收录选中段落**：先选中文字，再点按钮；导入后会把选中文字存成高亮。
- 如果系统询问是否打开 ThinRead，选择允许。
- 如果直接打开失败，点「复制收录链接」，把 `thinread://capture?...` 粘贴到地址栏。

## 能力声明

`manifest.json` 里的 `thinread.capabilities` 声明了扩展需要的能力：

- `browser:capture`：读取当前标签页 URL、标题和选区，并发送收录深链。

扩展不读取浏览历史、不注入第三方脚本、不上传页面内容。
