# 官网

页边 ThinRead 的开源项目官网：项目介绍、功能、下载、路线图、迭代时间线、点赞和留言。

## 本地预览

```bash
cd website
python3 -m http.server 4173
```

打开 <http://localhost:4173>。

## 内容口径

- 官网截图来自真实书库与隔离演示库：《认知觉醒：开启自我改变的原动力》用于书架、阅读器、分享卡和小红书，《恶意》用于人物关系图；导入、设置、搜索和夜间阅读使用演示数据。
- 页面有 18 张可筛选、可放大的界面截图，按阅读 / 笔记 / 连接 / 创作 / 数据分组；大图用原生 `dialog` 灯箱，支持键盘左右方向键和 Esc。
- 路线图根据 `docs/feature-audit.md` 的开发记录和已知限制整理；已完成项写落地日期，未完成项不写虚构排期。
- 下载按钮直连最新 DMG，不跳转仓库页面。当前只提供 macOS arm64，Windows 仍在评估。
- 官网保留产品信息、下载、用户手册和 GitHub 入口，不加入许可证销售或社区运营内容。
- 官网默认跟随系统深浅色，右上角月亮/太阳按钮可手动切换；设计使用近白纸面、墨色正文和单一靛蓝强调，宋体只用于大标题，颜色变量在 `styles.css` 的 `:root` 和 `:root[data-theme="dark"]` 里。
- 官网主题只影响网页，不是应用内的五套阅读主题。

## 点赞与留言

- 点赞：Abacus 公共计数器 `thinread/website-likes`，不需要登录；浏览器本地记录已点赞状态。
- 留言与路线图：连接本机留言台 [`../feedback-desk`](../feedback-desk)。启动方式：

  ```bash
  cd ../feedback-desk
  npm start
  ```

  或在 Finder 里双击 `feedback-desk/start.command`。

- 官网在 `website/app.js` 里通过 `FEEDBACK_API` 和 `FEEDBACK_PROJECT` 连接留言台，默认是 `http://127.0.0.1:8787` + `thinread`。
- 如果留言台项目启用了 submitKey，把后台生成的 key 填到 `FEEDBACK_KEY`。
- 路线图文案以站点内置的整理结果为准；留言台只补充用户建议、公开留言和同感，避免服务端旧文案覆盖当前说明。
- 官网的留言区有「最近公开 / 我的留言」两个视图：公开留言可以同感、看官方回复；我的留言用查询码看处理进度，不需要账号。
- 留言表单支持一张 2MB 以内的截图；路线图支持「已上线」状态和版本号；用户建议被处理后会显示「来自用户建议」。
- 标题输入框会搜索已有路线图和公开留言，提示相似建议，减少重复提交。
- 留言台离线时，官网自动回退到内置路线图和浏览器本机留言，不会白屏或丢内容。
- 如果项目开启了审核，官网会提示「审核通过后才会公开」。
- 部署到公网时，把 `FEEDBACK_API` 改成留言台的公网地址。
- 在手机上预览时，把 `FEEDBACK_API` 改成 Mac 的局域网地址，并用 `HOST=0.0.0.0 npm start` 启动留言台。
- 后台：<http://127.0.0.1:8787/admin>，管理员令牌在 `feedback-desk/data/admin-token.txt`。
- 公开项目页：<http://127.0.0.1:8787/p/thinread>。
- 完整接入文档：`feedback-desk/docs/INTEGRATION.md`；OpenAPI：`feedback-desk/public/openapi.yaml`。

## 部署

`website/` 是纯静态站点，可以直接部署到任意静态托管。部署时保留 `assets/`（含 `assets/shots/`）和 `.nojekyll`；用户手册链接指向 GitHub 上的 `docs/user-manual.pdf`，不依赖站点目录外的文件。

## 文件

- `index.html`：页面结构
- `styles.css`：设计系统与响应式
- `app.js`：路线图、下载、点赞、留言台连接
- `assets/`：产品横幅、图标
- `assets/shots/`：18 张界面截图
- `../feedback-desk/`：独立留言与路线图服务，可给其他项目复用
