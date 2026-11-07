# 小红书内测推广素材

7 张 1080×1440 的图文，用于页边 ThinRead 的 macOS 内测推广。

## 预览

- `01.png` 封面
- `02.png` 读薄
- `03.png` 卡片与原文核对
- `04.png` 知识地图 / 人物关系图
- `05.png` 成书 / 分享卡 / 小红书
- `06.png` 本地数据
- `07.png` 内测 CTA

文案见 [`copy.md`](copy.md)。

## 重新生成

```bash
cd ~/Desktop/reading-notes
node marketing/xhs-beta/build.mjs
node marketing/xhs-beta/render.mjs
```

渲染使用本机 Google Chrome：

```text
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

如果你的 Chrome 不在这个路径，可以用 `CHROME=/path/to/chrome node marketing/xhs-beta/render.mjs`。

## 结构

- `build.mjs`：生成 7 个 HTML slide
- `style.css`：白底、黑灰、红色强调的极简版式
- `render.mjs`：用 Chrome headless 输出 1080×1440 PNG
- `assets/`：真实界面截图（书架、阅读器、分享卡、人物关系图、小红书图文）和应用图标
- `copy.md`：标题、正文、标签、置顶评论和发布备注

## 截图来源

- 书架、阅读器、分享卡、小红书图文：《认知觉醒：开启自我改变的原动力》
- 人物关系图：《恶意》
- 全部为真实产品界面，没有绘制假 UI、假数据或假评价。

## 发布注意

- 产品是 macOS 桌面端，不是手机 App。
- 内测帖不谈开源、不谈价格、不承诺 Windows 时间。
- 下载方式放在评论区或私信，正文不放外链。
- 封面用 `01.png`，其余按 `02` → `07` 顺序上传。
