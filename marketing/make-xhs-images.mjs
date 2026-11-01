import fs from 'node:fs/promises'
import path from 'node:path'

import { GlobalFonts, createCanvas, loadImage } from '@napi-rs/canvas'

GlobalFonts.registerFromPath('/System/Library/Fonts/Supplemental/Songti.ttc', 'XHS Serif')
GlobalFonts.registerFromPath('/System/Library/Fonts/Hiragino Sans GB.ttc', 'XHS Sans')

const W = 1080
const H = 1440
const PAPER = '#f2efe6'
const PAPER_2 = '#fbfaf5'
const INK = '#1e1e1a'
const INK_SOFT = '#56554d'
const MUTED = '#7a776c'
const LINE = '#d7d4c9'
const BLUE = '#2f4f9e'
const BLUE_DARK = '#223d80'
const SAGE = '#3f6b57'
const RED = '#a84a2b'
const SERIF = '"XHS Serif", "Songti SC", serif'
const SANS = '"XHS Sans", "Hiragino Sans GB", sans-serif'
const OUT = path.join('marketing', 'xhs')

function background(ctx, color = PAPER) {
  ctx.fillStyle = color
  ctx.fillRect(0, 0, W, H)
  let seed = 23
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  for (let index = 0; index < 900; index++) {
    ctx.fillStyle = `rgba(30,30,26,${0.012 + random() * 0.02})`
    ctx.fillRect(random() * W, random() * H, 1 + random() * 1.2, 1 + random() * 1.2)
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function spaced(ctx, text, x, y, spacing, color, font) {
  ctx.fillStyle = color
  ctx.font = font
  let cursor = x
  for (const char of text) {
    ctx.fillText(char, cursor, y)
    cursor += ctx.measureText(char).width + spacing
  }
  return cursor
}

function kicker(ctx, text, x, y, color = MUTED) {
  spaced(ctx, text, x, y, 3.2, color, `600 18px ${SANS}`)
}

function rule(ctx, x, y, width, color = LINE, height = 1) {
  ctx.fillStyle = color
  ctx.fillRect(x, y, width, height)
}

function pageNumber(ctx, n, total = 7, color = MUTED) {
  ctx.fillStyle = color
  ctx.font = `500 17px ${SANS}`
  ctx.textAlign = 'right'
  ctx.fillText(`${String(n).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, W - 76, 62)
  ctx.textAlign = 'left'
}

function footer(ctx, text = '页边 THINREAD · 本地优先的 AI 读书笔记') {
  rule(ctx, 76, H - 72, W - 152, LINE)
  ctx.fillStyle = MUTED
  ctx.font = `400 16px ${SANS}`
  ctx.fillText(text, 76, H - 42)
  ctx.textAlign = 'right'
  ctx.fillText('DESKTOP APP', W - 76, H - 42)
  ctx.textAlign = 'left'
}

function windowCard(ctx, image, x, y, width, height, caption) {
  ctx.save()
  ctx.shadowColor = 'rgba(30, 30, 26, 0.16)'
  ctx.shadowBlur = 36
  ctx.shadowOffsetY = 18
  ctx.fillStyle = PAPER_2
  roundRect(ctx, x, y, width, height, 18)
  ctx.fill()
  ctx.restore()

  ctx.save()
  roundRect(ctx, x, y, width, height, 18)
  ctx.clip()
  ctx.fillStyle = '#e9e6dc'
  ctx.fillRect(x, y, width, 42)
  const dots = ['#c67862', '#c7a45d', '#759578']
  dots.forEach((color, index) => {
    ctx.beginPath()
    ctx.fillStyle = color
    ctx.arc(x + 23 + index * 18, y + 21, 5, 0, Math.PI * 2)
    ctx.fill()
  })
  const innerY = y + 42
  const innerH = height - 42
  const imageRatio = image.width / image.height
  const boxRatio = width / innerH
  let dx = x
  let dy = innerY
  let dw = width
  let dh = innerH
  if (imageRatio > boxRatio) {
    dh = innerH
    dw = dh * imageRatio
    dx = x - (dw - width) / 2
  } else {
    dw = width
    dh = dw / imageRatio
    dy = innerY - (dh - innerH) / 2
  }
  ctx.drawImage(image, dx, dy, dw, dh)
  ctx.restore()

  ctx.strokeStyle = 'rgba(30,30,26,0.12)'
  ctx.lineWidth = 1
  roundRect(ctx, x + 0.5, y + 0.5, width - 1, height - 1, 18)
  ctx.stroke()

  if (caption) {
    ctx.fillStyle = MUTED
    ctx.font = `400 17px ${SANS}`
    ctx.fillText(caption, x + 4, y + height + 34)
  }
}

function save(canvas, name) {
  return fs.writeFile(path.join(OUT, name), canvas.toBuffer('image/png'))
}

async function cover() {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  background(ctx)
  ctx.fillStyle = BLUE
  ctx.fillRect(0, 0, 16, H)
  pageNumber(ctx, 1, 7)

  kicker(ctx, 'A LOCAL-FIRST READING APP', 76, 111, BLUE)
  ctx.fillStyle = INK
  ctx.font = `700 26px ${SERIF}`
  ctx.fillText('页边  ThinRead', 76, 158)

  ctx.fillStyle = INK
  ctx.font = `700 105px ${SERIF}`
  ctx.fillText('书摘散了', 76, 318)
  ctx.fillStyle = BLUE
  ctx.fillText('四个 App', 76, 438)
  ctx.fillStyle = INK
  ctx.font = `700 66px ${SERIF}`
  ctx.fillText('我把它们收进', 76, 536)
  ctx.fillText('一个本地软件', 76, 614)

  ctx.fillStyle = INK_SOFT
  ctx.font = `400 25px ${SANS}`
  ctx.fillText('不是又一个云端笔记。', 78, 690)
  ctx.fillText('书、笔记、生成记录，都留在自己的电脑里。', 78, 728)

  const sources = [
    ['微信读书', '划线与想法'],
    ['PDF 标注', '论文与电子书'],
    ['Kindle', '剪贴与书摘'],
    ['备忘录', '零散笔记'],
  ]
  const startY = 820
  sources.forEach(([name, note], index) => {
    const y = startY + index * 92
    ctx.fillStyle = PAPER_2
    roundRect(ctx, 76, y, 360, 72, 10)
    ctx.fill()
    ctx.strokeStyle = LINE
    ctx.stroke()
    ctx.fillStyle = index === 3 ? RED : INK
    ctx.font = `600 23px ${SANS}`
    ctx.fillText(name, 102, y + 32)
    ctx.fillStyle = MUTED
    ctx.font = `400 16px ${SANS}`
    ctx.fillText(note, 102, y + 56)
    ctx.strokeStyle = index === 3 ? RED : BLUE
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(460, y + 36)
    ctx.lineTo(508, y + 36)
    ctx.stroke()
  })

  ctx.strokeStyle = BLUE
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(508, 856)
  ctx.lineTo(545, 856)
  ctx.lineTo(545, 1026)
  ctx.lineTo(580, 1026)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(566, 1018)
  ctx.lineTo(580, 1026)
  ctx.lineTo(566, 1034)
  ctx.stroke()

  ctx.save()
  ctx.shadowColor = 'rgba(47, 79, 158, 0.28)'
  ctx.shadowBlur = 30
  ctx.shadowOffsetY = 14
  ctx.fillStyle = BLUE
  roundRect(ctx, 600, 790, 380, 470, 18)
  ctx.fill()
  ctx.restore()
  ctx.fillStyle = '#f7f3e9'
  ctx.font = `700 54px ${SERIF}`
  ctx.fillText('页边', 636, 886)
  ctx.font = `400 18px ${SANS}`
  ctx.fillStyle = 'rgba(247,243,233,0.72)'
  ctx.fillText('一本书读完以后，', 636, 948)
  ctx.fillText('还会再打开的地方。', 636, 978)
  ctx.fillStyle = '#f7f3e9'
  ctx.font = `500 20px ${SANS}`
  ctx.fillText('导入  →  读薄  →  串联  →  输出', 636, 1082)
  ctx.fillStyle = 'rgba(247,243,233,0.65)'
  ctx.font = `400 16px ${SANS}`
  ctx.fillText('LOCAL  /  PRIVATE  /  YOURS', 636, 1128)

  rule(ctx, 76, 1306, W - 152, LINE)
  ctx.fillStyle = INK
  ctx.font = `600 20px ${SANS}`
  ctx.fillText('免费 · 本地优先 · 桌面端', 76, 1350)
  ctx.fillStyle = MUTED
  ctx.font = `400 16px ${SANS}`
  ctx.fillText('后面会开源，可以期待一下。', 76, 1380)

  await save(canvas, '01-cover.png')
}

async function reading() {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  background(ctx)
  pageNumber(ctx, 2, 7)
  kicker(ctx, 'HOW IT WORKS / 01', 76, 111, BLUE)
  ctx.fillStyle = INK
  ctx.font = `700 76px ${SERIF}`
  ctx.fillText('不是再总结一遍', 76, 240)
  ctx.fillStyle = BLUE
  ctx.font = `700 62px ${SERIF}`
  ctx.fillText('是把书变成自己的', 76, 322)
  ctx.fillStyle = INK_SOFT
  ctx.font = `400 24px ${SANS}`
  ctx.fillText('先按章读薄，再从读薄稿里提炼卡片。', 78, 378)
  ctx.fillText('观点、原文引用和你的想法，留在同一处。', 78, 416)

  const steps = [
    ['01', '导入', 'EPUB / PDF / MOBI\n网页 / 文本'],
    ['02', '读薄', '保留全部观点\n不做通用摘要'],
    ['03', '提炼', '核心卡片\n尽量回到原文'],
  ]
  steps.forEach(([n, title, detail], index) => {
    const x = 76 + index * 302
    ctx.fillStyle = BLUE
    ctx.font = `500 18px ${SANS}`
    ctx.fillText(n, x, 512)
    ctx.fillStyle = INK
    ctx.font = `700 34px ${SERIF}`
    ctx.fillText(title, x, 558)
    ctx.fillStyle = MUTED
    ctx.font = `400 16px ${SANS}`
    detail.split('\n').forEach((line, i) => ctx.fillText(line, x, 590 + i * 24))
    if (index < 2) {
      rule(ctx, x + 238, 544, 34, LINE)
    }
  })

  const image = await loadImage('docs/screenshot.png')
  windowCard(ctx, image, 76, 702, W - 152, 500, '阅读器 · 左侧目录与正文排版')
  ctx.fillStyle = SAGE
  ctx.font = `600 17px ${SANS}`
  ctx.fillText('AI 只在你按下按钮时工作，导入本身不调用模型。', 80, 1280)
  footer(ctx)
  await save(canvas, '02-reading.png')
}

async function notes() {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  background(ctx)
  pageNumber(ctx, 3, 7)
  kicker(ctx, 'CONNECT / 02', 76, 111, BLUE)
  ctx.fillStyle = INK
  ctx.font = `700 82px ${SERIF}`
  ctx.fillText('笔记不是孤岛', 76, 248)
  ctx.fillStyle = INK_SOFT
  ctx.font = `400 24px ${SANS}`
  ctx.fillText('同一本书里的想法可以互链，', 78, 304)
  ctx.fillText('不同书里的相近观点，也可以重新遇见。', 78, 342)

  const bullets = [
    ['[[ 笔记互链 ]]', '用标题把笔记接起来，自动显示反向链接。'],
    ['本地语义回声', 'BGE-small-zh 在电脑里计算相近笔记，不把笔记发出去。'],
    ['知识地图', '书、标签和概念连成图，跨书的连接会单独标出。'],
  ]
  bullets.forEach(([title, detail], index) => {
    const y = 420 + index * 74
    ctx.fillStyle = index === 1 ? BLUE : INK
    ctx.font = `600 22px ${SANS}`
    ctx.fillText(title, 78, y)
    ctx.fillStyle = MUTED
    ctx.font = `400 17px ${SANS}`
    ctx.fillText(detail, 300, y)
  })

  const image = await loadImage('docs/knowledge-map.png')
  windowCard(ctx, image, 76, 690, W - 152, 500, '知识地图 · 书、标签与概念的关系')
  footer(ctx)
  await save(canvas, '03-notes.png')
}

async function relation() {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  background(ctx)
  pageNumber(ctx, 4, 7)
  kicker(ctx, 'CHARACTERS / 03', 76, 111, RED)
  ctx.fillStyle = INK
  ctx.font = `700 82px ${SERIF}`
  ctx.fillText('人物关系，', 76, 248)
  ctx.fillText('一张图看懂', 76, 336)
  ctx.fillStyle = INK_SOFT
  ctx.font = `400 24px ${SANS}`
  ctx.fillText('侦探小说最怕名字太多，历史小说最怕阵营太乱。', 78, 398)
  ctx.fillText('把散在章节里的名字，连成一张能点开的关系图。', 78, 436)

  const tags = [
    ['侦探', '凶手 / 受害者 / 嫌疑人 / 动机'],
    ['历史', '人物 / 官阶 / 阵营 / 亲缘'],
    ['阅读', '点节点看关系，回到原文'],
  ]
  tags.forEach(([title, detail], index) => {
    const y = 508 + index * 58
    ctx.fillStyle = index === 0 ? RED : index === 1 ? BLUE : SAGE
    ctx.font = `600 20px ${SANS}`
    ctx.fillText(title, 78, y)
    ctx.fillStyle = MUTED
    ctx.font = `400 17px ${SANS}`
    ctx.fillText(detail, 190, y)
  })

  const image = await loadImage('marketing/assets/relation-graph.png')
  windowCard(ctx, image, 76, 722, W - 152, 468, '人物关系图 · 节点代表人物，线代表关系与阵营')
  ctx.fillStyle = RED
  ctx.font = `600 17px ${SANS}`
  ctx.fillText('读复杂叙事时，先看清谁和谁站在同一边。', 80, 1254)
  footer(ctx)
  await save(canvas, '04-relation.png')
}

async function listen() {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  background(ctx)
  pageNumber(ctx, 5, 7)
  kicker(ctx, 'LISTEN / 04', 76, 111, BLUE)
  ctx.fillStyle = INK
  ctx.font = `700 82px ${SERIF}`
  ctx.fillText('读累了，就听', 76, 248)
  ctx.fillStyle = INK_SOFT
  ctx.font = `400 24px ${SANS}`
  ctx.fillText('系统语音、Edge 在线音色、本地 Kokoro 都能选。', 78, 304)
  ctx.fillText('双人播客不是念稿，是 A/B 两个角色把一章聊明白。', 78, 342)

  const tags = ['双人播客', 'A / B 分角色', 'Edge 在线', 'Kokoro 本地']
  tags.forEach((tag, index) => {
    const x = 76 + index * (index === 0 ? 162 : 182)
    ctx.fillStyle = index === 3 ? SAGE : BLUE
    ctx.font = `500 16px ${SANS}`
    ctx.fillText(`0${index + 1}  ${tag}`, x, 410)
  })

  const image = await loadImage('docs/listen.png')
  windowCard(ctx, image, 76, 500, W - 152, 560, '听读面板 · 逐句高亮，可暂停、跳句、调速')
  ctx.fillStyle = MUTED
  ctx.font = `400 17px ${SANS}`
  ctx.fillText('听读不改原文；生成的音频只在本机播放。', 80, 1110)
  footer(ctx)
  await save(canvas, '05-listen.png')
}

async function output() {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  background(ctx)
  pageNumber(ctx, 6, 7)
  kicker(ctx, 'OUTPUT / 05', 76, 111, BLUE)
  ctx.fillStyle = INK
  ctx.font = `700 82px ${SERIF}`
  ctx.fillText('读完，要能带走', 76, 248)
  ctx.fillStyle = INK_SOFT
  ctx.font = `400 24px ${SANS}`
  ctx.fillText('不是把笔记锁在应用里。', 78, 304)
  ctx.fillText('分享卡、成书、HTML 和发布包，都可以导出。', 78, 342)

  const items = [
    ['分享卡', '金句、出处、二维码'],
    ['整本成书', '把读薄稿合成一篇长文'],
    ['HTML / 发布包', '自包含分享页，直接丢到静态托管'],
  ]
  items.forEach(([title, detail], index) => {
    const y = 420 + index * 80
    ctx.fillStyle = index === 1 ? RED : INK
    ctx.font = `600 22px ${SANS}`
    ctx.fillText(title, 78, y)
    ctx.fillStyle = MUTED
    ctx.font = `400 17px ${SANS}`
    ctx.fillText(detail, 300, y)
  })

  const image = await loadImage('docs/content-library.png')
  windowCard(ctx, image, 76, 720, W - 152, 470, '内容库 · 生成结果按版本保留，可回看和应用')
  footer(ctx)
  await save(canvas, '06-output.png')
}

async function closing() {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = BLUE_DARK
  ctx.fillRect(0, 0, W, H)
  let seed = 91
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  for (let index = 0; index < 900; index++) {
    ctx.fillStyle = `rgba(247,243,233,${0.02 + random() * 0.025})`
    ctx.fillRect(random() * W, random() * H, 1 + random() * 1.4, 1 + random() * 1.4)
  }
  pageNumber(ctx, 7, 7, 'rgba(247,243,233,0.62)')
  kicker(ctx, 'STILL BUILDING / 06', 76, 111, 'rgba(247,243,233,0.62)')
  ctx.fillStyle = '#f7f3e9'
  ctx.font = `700 92px ${SERIF}`
  ctx.fillText('后面会开源', 76, 300)
  ctx.fillText('可以期待一下', 76, 400)
  ctx.fillStyle = 'rgba(247,243,233,0.78)'
  ctx.font = `400 27px ${SANS}`
  ctx.fillText('项目还在打磨。想先看看界面，', 78, 500)
  ctx.fillText('或者蹲后续开源，评论区留「页边」。', 78, 542)

  ctx.strokeStyle = 'rgba(247,243,233,0.28)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(76, 720)
  ctx.lineTo(W - 76, 720)
  ctx.stroke()

  ctx.fillStyle = '#f7f3e9'
  ctx.font = `700 48px ${SERIF}`
  ctx.fillText('页边 ThinRead', 76, 800)
  ctx.fillStyle = 'rgba(247,243,233,0.7)'
  ctx.font = `400 18px ${SANS}`
  ctx.fillText('写字，读书，把一本书读成自己的。', 78, 840)

  const chips = ['本地优先', '桌面端', 'AI 读薄', '双人播客']
  chips.forEach((chip, index) => {
    const x = 76 + index * 220
    ctx.strokeStyle = 'rgba(247,243,233,0.26)'
    ctx.strokeRect(x, 930, 190, 48)
    ctx.fillStyle = 'rgba(247,243,233,0.82)'
    ctx.font = `400 17px ${SANS}`
    ctx.fillText(chip, x + 18, 960)
  })

  ctx.fillStyle = 'rgba(247,243,233,0.45)'
  ctx.font = `400 15px ${SANS}`
  ctx.fillText('MADE FOR PEOPLE WHO KEEP THEIR NOTES', 76, 1310)
  await save(canvas, '07-closing.png')
}

await fs.mkdir(OUT, { recursive: true })
await cover()
await reading()
await notes()
await relation()
await listen()
await output()
await closing()
console.log('XHS images written to', OUT)
