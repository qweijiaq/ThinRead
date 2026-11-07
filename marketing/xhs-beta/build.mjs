import fs from 'node:fs'
import path from 'node:path'

const root = path.dirname(new URL(import.meta.url).pathname)

function bullets(items) {
  return `<div class="bullets">${items
    .map(
      ([title, body], index) => `<div class="bullet">
        <span class="bullet-no">${String(index + 1).padStart(2, '0')}</span>
        <div><p class="bullet-title">${title}</p><p class="bullet-body">${body}</p></div>
      </div>`,
    )
    .join('')}</div>`
}

function pills(items) {
  return `<div class="pills">${items.map((item) => `<span class="pill">${item}</span>`).join('')}</div>`
}

function windowCard(image, caption, narrow = false) {
  return `<div class="visual">
    <div class="window${narrow ? ' narrow' : ''}"><img src="assets/${image}" alt="" /></div>
    <div class="caption">${caption}</div>
  </div>`
}

function localGrid(items) {
  return `<div class="visual">
    <div class="local-grid">${items
      .map(
        ([no, title, body]) => `<div class="local-card">
          <span class="local-no">${no}</span>
          <h3>${title}</h3>
          <p>${body}</p>
        </div>`,
      )
      .join('')}</div>
  </div>`
}

function ctaPanel() {
  return `<div class="visual">
    <div class="cta-panel">
      <img src="assets/icon.png" alt="" />
      <div class="cta-copy"><strong>页边 ThinRead</strong><span>LOCAL-FIRST AI READING · macOS BETA</span></div>
      <div class="cta-action">评论区留言「想试试」</div>
    </div>
    <p class="cta-note">未签名内测包 · Windows 仍在评估 · 模型 Key 自带</p>
  </div>`
}

const slides = [
  {
    no: '01',
    kicker: 'A LOCAL-FIRST READING APP / 01',
    eyebrow: 'READING NOTES, NOT HIGHLIGHTS',
    title: '读完了，<br />却什么都<br /><em>写不出来。</em>',
    lede: '把一本书读成能发布的稿子，而不是再堆一堆划线。',
    body: pills(['本地优先', 'macOS 内测', '自带 API Key']),
    visual: windowCard('library.png', 'REAL UI / 书架 · 认知觉醒'),
  },
  {
    no: '02',
    kicker: 'WHAT IT IS / 02',
    eyebrow: 'A READING WORKBENCH',
    title: '不是摘要，<br />是<em>读薄</em>。',
    lede: '摘要把书压短；读薄把作者的主张留下来，再变成能继续写的东西。',
    body: bullets([
      ['读薄', '按断言重写整章，删铺垫，不删观点。'],
      ['卡片', '5–25 张，写清作用与原文依据。'],
      ['成书', '把章节合成一篇有结构的文章。'],
    ]),
    visual: windowCard('reader.png', 'REAL UI / 认知觉醒 · 第三章', true),
  },
  {
    no: '03',
    kicker: 'CARDS / 03',
    eyebrow: 'EVIDENCE, NOT VIBES',
    title: '每张卡，<br />都要能<br /><em>回到原文。</em>',
    lede: '卡片不是金句。它要写清在文中的作用；原文依据必须能逐字找到，找不到就不打「已核对」。',
    body: bullets([
      ['5–25 张核心卡片', '不是越多越好，只留下真正影响理解的点。'],
      ['依据逐字匹配', '引用必须能在本章原文里找到。'],
      ['找不到就不标已核对', '待核对、无引用和人工修改分开看。'],
    ]),
    visual: windowCard('share.png', 'REAL UI / 分享卡导出', true),
  },
  {
    no: '04',
    kicker: 'CONNECT / 04',
    eyebrow: 'KNOWLEDGE MAP + CHARACTER MAP',
    title: '一本书，<br />应该连回<br /><em>其他书。</em>',
    lede: '知识地图把概念连成网；人物关系图把小说里的角色、阵营和动机连起来。',
    body: bullets([
      ['知识地图', '书、标签和跨书概念，未归类笔记也不会消失。'],
      ['人物关系图', '《恶意》实测：39 个节点、108 条关系。'],
      ['导出', 'PNG、Mermaid、Markdown，都可以带走。'],
    ]),
    visual: windowCard('relation.png', 'REAL UI / 《恶意》人物关系图'),
  },
  {
    no: '05',
    kicker: 'OUTPUT / 05',
    eyebrow: 'FROM CHAPTER TO PUBLISHED',
    title: '从一章，<br />到一本<br /><em>能发的书。</em>',
    lede: '合并章节、补过渡、精炼或完整；最后导出 Markdown、HTML、PDF、发布包，或者一张分享卡。',
    body: bullets([
      ['整本成书', '精炼/完整、克制/读者视角/有判断。'],
      ['分享卡 / 小红书', '6 种版式、3 套主题，重点句高亮。'],
      ['双人播客', 'A/B 对谈稿，可播放，也能导出 MP3。'],
    ]),
    visual: windowCard('xhs.png', 'REAL UI / 小红书图文', true),
  },
  {
    no: '06',
    kicker: 'LOCAL / 06',
    eyebrow: 'YOUR DATA STAYS YOURS',
    title: '数据留在<br /><em>本机</em>。',
    lede: '书、笔记、生成内容都在本机 SQLite；模型 Key 存系统钥匙串；每天自动备份。',
    body: '<p class="local-quote">它不替你读书，<br />只把读过的部分留下来。</p>',
    visual: localGrid([
      ['01 / SQLITE', '书、笔记、生成内容', '不经过云端正文；换机可以用整库导出/导入。'],
      ['02 / BACKUP', '每日自动备份', '保留 8 份；恢复前还会再做一份安全备份。'],
      ['03 / KEYCHAIN', 'Key 不进代码', 'API Key / Readwise Token 存系统钥匙串。'],
      ['04 / NO ACCOUNT', '没有账号', '没有云端正文、没有订阅；书和笔记先属于你。'],
    ]),
  },
  {
    no: '07',
    kicker: 'BETA / 07',
    eyebrow: 'MACOS BETA',
    title: 'macOS<br /><em>内测中。</em>',
    lede: '想试试的，评论区留言「想试试」。我发你下载方式。',
    body: '<p class="cta-quote">不是更多划线，<br />而是一篇能发的稿、几张能回看的卡、<br />一张能连起来的网。</p>',
    visual: ctaPanel(),
    cta: true,
  },
]

for (const slide of slides) {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<link rel="stylesheet" href="style.css" />
<title>页边 ${slide.no}</title>
</head>
<body>
<div class="slide${slide.cta ? ' is-cta' : ''}">
  <div class="topline">
    <span class="kicker">${slide.kicker}</span>
    <span class="kicker">THINREAD / BETA NOTES</span>
  </div>
  <div class="copy">
    <div class="eyebrow">${slide.eyebrow}</div>
    <h1>${slide.title}</h1>
    <p class="lede">${slide.lede}</p>
    ${slide.body}
  </div>
  ${slide.visual}
  <div class="footer"><span><strong>页边 THINREAD</strong> · 本地优先的 AI 读书笔记</span><span>${slide.no} / 07</span></div>
</div>
</body>
</html>
`
  fs.writeFileSync(path.join(root, `slide-${slide.no}.html`), html)
}

console.log(`wrote ${slides.length} slides`)
