# 官网

页边 ThinRead 的静态官网：项目介绍、功能、下载、路线图、迭代时间线、点赞和 GitHub 留言。

## 本地预览

```bash
cd website
python3 -m http.server 4173
```

打开 <http://localhost:4173>。

## 部署到 GitHub Pages

仓库已包含 `.github/workflows/pages.yml`。首次部署前需要在 GitHub 仓库设置里：

1. Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**；
2. 推送到 `main`，或在 Actions 里手动运行 **Deploy website**；
3. 部署完成后访问 `https://qweijiaq.github.io/ThinRead/`。

## 点赞与留言

- 点赞：Abacus 公共计数器 `thinread/website-likes`，不需要登录；浏览器本地记录已点赞状态。
- 留言：表单会打开 GitHub 新建 issue 页面，发布后通过 GitHub API 显示在「最近留言」里；需要 GitHub 账号。
- GitHub API 未登录时有速率限制，读取失败会显示直接跳转 GitHub 的链接。

## 文件

- `index.html`：页面结构
- `styles.css`：设计系统与响应式
- `app.js`：路线图、版本下载、点赞、留言、GitHub 数据
- `assets/`：界面截图和图标
