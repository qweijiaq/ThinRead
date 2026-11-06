# 官网

页边 ThinRead 的内测官网：项目介绍、功能、下载、路线图、迭代时间线、点赞和留言。

## 本地预览

```bash
cd website
python3 -m http.server 4173
```

打开 <http://localhost:4173>。

## 内容口径

- 官网截图来自真实书库：《认知觉醒：开启自我改变的原动力》用于书架、阅读器、分享卡和小红书，《恶意》用于人物关系图。
- 路线图根据 `docs/feature-audit.md` 的开发记录和已知限制整理；已完成项写落地日期，未完成项不写虚构排期。
- 下载按钮直连内测 DMG，不跳转仓库页面。当前只提供 macOS arm64，Windows 仍在评估。
- 内测期只保留产品信息和下载入口，不加入许可证、代码托管或社区入口。

## 点赞与留言

- 点赞：Abacus 公共计数器 `thinread/website-likes`，不需要登录；浏览器本地记录已点赞状态。
- 留言与路线图：连接本机留言台 [`../feedback-desk`](../feedback-desk)。启动方式：

  ```bash
  cd ../feedback-desk
  npm start
  ```

  或在 Finder 里双击 `feedback-desk/start.command`。

- 官网在 `website/app.js` 里通过 `FEEDBACK_API` 和 `FEEDBACK_PROJECT` 连接留言台，默认是 `http://127.0.0.1:8787` + `thinread`。
- 留言台在线时，公开路线图和公开留言都从留言台读取；提交留言会直接送达后台。
- 留言台离线时，官网自动回退到内置路线图和浏览器本机留言，不会白屏或丢内容。
- 部署到公网时，把 `FEEDBACK_API` 改成留言台的公网地址。
- 后台：<http://127.0.0.1:8787/admin>，管理员令牌在 `feedback-desk/data/admin-token.txt`。

## 部署

`website/` 是纯静态站点，可以直接部署到任意静态托管。部署时保留 `assets/` 目录和 `.nojekyll`。

## 文件

- `index.html`：页面结构
- `styles.css`：设计系统与响应式
- `app.js`：路线图、下载、点赞、留言台连接
- `assets/`：界面截图和图标
- `../feedback-desk/`：独立留言与路线图服务，可给其他项目复用
