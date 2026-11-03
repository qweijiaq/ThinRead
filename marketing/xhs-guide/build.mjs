import fs from 'node:fs'
import path from 'node:path'

const root = path.dirname(new URL(import.meta.url).pathname)

function phone(image, label, contain = false, caption = 'REAL UI · DESKTOP CROP') {
  return `<div class="device">
      <div class="phone">
        <div class="screen${contain ? ' contain' : ''}">
          <img src="assets/${image}" alt="" />
        </div>
      </div>
      <div class="device-caption">${caption}</div>
    </div>`
}

function slide({ no, kicker, eyebrow, title, lede, body, image, label, reverse = false, contain = false, caption, footer = '页边 · 把一本书读成自己的' }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<link rel="stylesheet" href="style.css" />
<title>页边 ${no}</title>
</head>
<body>
<div class="slide">
  <div class="topline">
    <span class="kicker">${kicker}</span>
    <span class="kicker">THINREAD / PRODUCT NOTES</span>
  </div>
  <div class="layout${reverse ? ' reverse' : ''}">
    <div class="copy">
      <div class="eyebrow">${eyebrow}</div>
      <h1>${title}</h1>
      <p class="lede">${lede}</p>
      ${body}
    </div>
    ${phone(image, label, contain, caption)}
  </div>
  <div class="footer"><span><strong>${footer}</strong></span><span>${no} / 08</span></div>
</div>
</body>
</html>
`
}

const slides = [
  {
    no: '01',
    kicker: 'LOCAL-FIRST AI READING / 01',
    eyebrow: 'READING NOTES, NOT HIGHLIGHTS',
    title: '读完了，<br />却什么都<br /><em>写不出来。</em>',
    lede: '把一本书读成能发布的稿子，而不是再堆一堆划线。',
    body: `<div class="pills"><span class="pill">本地优先</span><span class="pill">自带 API Key</span><span class="pill">macOS 桌面端</span></div>`,
    image: 'screen-01.png',
    label: 'READER / NOTES',
  },
  {
    no: '02',
    kicker: 'WHAT IT IS / 02',
    eyebrow: 'A READING WORKBENCH',
    title: '不是摘要，<br />是<em>读薄</em>。',
    lede: '摘要把书压短；读薄把作者的主张留下来，再变成能继续写的东西。',
    body: `<div class="stack">
      <div class="stack-item"><span class="stack-no">01</span><div><p class="stack-title">读薄</p><p class="stack-body">按断言重写整章，删铺垫，不删观点。</p></div></div>
      <div class="stack-item"><span class="stack-no">02</span><div><p class="stack-title">卡片</p><p class="stack-body">5–25 张，写清作用与原文依据。</p></div></div>
      <div class="stack-item"><span class="stack-no">03</span><div><p class="stack-title">成书</p><p class="stack-body">把章节合成一篇有结构的文章。</p></div></div>
    </div>`,
    image: 'screen-02.png',
    label: 'LIBRARY',
    reverse: true,
  },
  {
    no: '03',
    kicker: 'READING FLOW / 03',
    eyebrow: 'ONE CHAPTER AT A TIME',
    title: '先读薄，<br />再谈<em>记住</em>。',
    lede: '打开一章，点「读薄并提炼」。原文先变成可发布的读薄稿，再从稿子里提炼卡片。',
    body: `<div class="abc">
      <div class="abc-item"><span class="abc-label">A</span><span class="abc-text"><strong>原文</strong>：断言、论证链、边界都留下。</span></div>
      <div class="abc-item"><span class="abc-label">B</span><span class="abc-text"><strong>读薄</strong>：并列改列表，删重复，不删观点。</span></div>
      <div class="abc-item"><span class="abc-label">C</span><span class="abc-text"><strong>卡片</strong>：用「不知道它是否影响理解」筛选。</span></div>
    </div>`,
    image: 'screen-03.png',
    label: 'SHARE CARD',
    contain: true,
    caption: 'EXPORTED SHARE CARD / 1080×1440',
  },
  {
    no: '04',
    kicker: 'CARDS / 04',
    eyebrow: 'EVIDENCE, NOT VIBES',
    title: '每张卡，<br />都要能<br /><em>回到原文。</em>',
    lede: '卡片不是金句。它要写清在文中的作用；原文依据必须能逐字找到，找不到就不打「已核对」。',
    body: `<div class="figures">
      <div class="figure"><strong>5–25</strong><span>张核心卡片</span></div>
      <div class="figure"><strong>1/1</strong><span>依据核查</span></div>
      <div class="figure"><strong>≤3</strong><span>条有限延伸</span></div>
    </div>`,
    image: 'screen-04.png',
    label: 'NOTE LIBRARY',
    reverse: true,
  },
  {
    no: '05',
    kicker: 'CHARACTER MAP / 05',
    eyebrow: 'WHO IS CONNECTED',
    title: '一张图，<br />看清人物<br /><em>怎么连</em>。',
    lede: '人物、组织、地点和事件从原文里被抽出来，连成一张可点击的图。谁在隐瞒，谁在保护谁，一眼能看明白。',
    body: `<div class="stack">
      <div class="stack-item"><span class="stack-no">01</span><div><p class="stack-title">39 个节点 · 108 条关系</p><p class="stack-body">《恶意》实测：人物、组织、地点、事件都进图。</p></div></div>
      <div class="stack-item"><span class="stack-no">02</span><div><p class="stack-title">点开一个人</p><p class="stack-body">右侧看他和谁有关、关系是什么、出处在哪。</p></div></div>
      <div class="stack-item"><span class="stack-no">03</span><div><p class="stack-title">导出</p><p class="stack-body">PNG、Mermaid、Markdown，都可以带走。</p></div></div>
    </div>`,
    image: 'screen-05-relation.png',
    label: 'CHARACTER MAP',
    caption: 'CHARACTER MAP / REAL UI',
  },
  {
    no: '06',
    kicker: 'WORKBENCH / 06',
    eyebrow: 'ONE LOCAL LIBRARY',
    title: '一本书，<br />应该连回<br /><em>其他书</em>。',
    lede: '读薄、卡片、知识地图、成书、分享和播客，共用同一份本地数据。',
    body: `<div class="stack">
      <div class="stack-item"><span class="stack-no">01</span><div><p class="stack-title">知识地图</p><p class="stack-body">概念从卡片里长出来，可以只看跨书概念。</p></div></div>
      <div class="stack-item"><span class="stack-no">02</span><div><p class="stack-title">人物关系</p><p class="stack-body">小说里的角色、阵营和动机连成一张图。</p></div></div>
      <div class="stack-item"><span class="stack-no">03</span><div><p class="stack-title">双人播客</p><p class="stack-body">把一章变成 A/B 对谈稿，生成后可直接播放。</p></div></div>
    </div>`,
    image: 'screen-05.png',
    label: 'LAB / PODCAST',
    caption: 'KNOWLEDGE MAP / REAL UI',
    reverse: true,
  },
  {
    no: '07',
    kicker: 'BOUNDARY / 07',
    eyebrow: 'LOCAL BY DEFAULT',
    title: '数据留在<br /><em>本机</em>。',
    lede: '书、笔记、向量索引和备份都在本地；模型与音色由你自带 Key。',
    body: `<div class="stack">
      <div class="stack-item"><span class="stack-no">01</span><div><p class="stack-title">本地</p><p class="stack-body">SQLite、书文件、备份都在本机；恢复前还会再做一份安全备份。</p></div></div>
      <div class="stack-item"><span class="stack-no">02</span><div><p class="stack-title">模型</p><p class="stack-body">DeepSeek、Claude、OpenAI 等，按任务分别指定；Key 用系统钥匙串加密。</p></div></div>
      <div class="stack-item"><span class="stack-no">03</span><div><p class="stack-title">边界</p><p class="stack-body">macOS 未签名；Windows / Linux 未发布；在线音色与播客需要联网或付费服务。</p></div></div>
    </div>`,
    image: 'screen-06.png',
    label: 'SETTINGS / KEY',
    caption: 'SETTINGS / REAL UI',
    contain: true,
  },
  {
    no: '08',
    kicker: 'AFTER READING / 08',
    eyebrow: 'THE PART THAT STAYS',
    title: '读完一本书，<br />应该留下<br /><em>能用的东西</em>。',
    lede: '不是更多划线，而是一篇能发的稿、几张能回看的卡、一张能连起来的网。',
    body: `<p class="quote">它不替你读书，<br />只把读过的部分<em>留下来</em>。</p>
    <div class="cta">小范围内测中 · 敬请期待</div>`,
    image: 'screen-07.png',
    label: 'COMPOSE',
    reverse: true,
  },
]

for (const data of slides) {
  fs.writeFileSync(path.join(root, `slide-${data.no}.html`), slide(data))
}
console.log(`wrote ${slides.length} slides`)
