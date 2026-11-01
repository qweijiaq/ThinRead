import assert from 'node:assert/strict'
import test from 'node:test'

import { parseWechatReadingNotes, stripHtmlToText } from '../electron/parsers/wechat-reading.js'

const PLAIN = `《置身事内：中国政府与经济发展》
作者：兰小欢

◆ 第一章 地方政府的权力与事务

中国的地方政府掌握着大量资源。
想法：这解释了土地财政的起点。

原文：地方政府的权力边界并不清晰。
笔记：需要结合财政制度理解。

第二章 土地制度

土地是城市化的关键要素。
`

const HTML = `<!doctype html>
<html>
<head><title>微信读书笔记</title><style>.x { color: red; }</style></head>
<body>
  <div class="book">《思考，快与慢》</div>
  <p>作者：丹尼尔·卡尼曼</p>
  <h2>第一部分 系统 1 与系统 2</h2>
  <p>我们的大脑有两套思考系统。</p>
  <p>想法：直觉回答常常出错。</p>
  <p>原文：慢思考需要注意力。</p>
  <p>笔记：刻意练习慢思考。</p>
</body>
</html>`

test('parses plain text WeChat Reading notes', () => {
  const entries = parseWechatReadingNotes(PLAIN)
  assert.equal(entries.length, 3)
  assert.equal(entries[0]!.title, '置身事内：中国政府与经济发展')
  assert.equal(entries[0]!.author, '兰小欢')
  assert.equal(entries[0]!.location, '第一章 地方政府的权力与事务')
  assert.equal(entries[0]!.text, '中国的地方政府掌握着大量资源。')
  assert.equal(entries[0]!.note, '这解释了土地财政的起点。')
  assert.equal(entries[1]!.text, '地方政府的权力边界并不清晰。')
  assert.equal(entries[1]!.note, '需要结合财政制度理解。')
  assert.equal(entries[2]!.location, '第二章 土地制度')
  assert.equal(entries[2]!.text, '土地是城市化的关键要素。')
})

test('parses HTML exports by stripping tags and keeping block boundaries', () => {
  const entries = parseWechatReadingNotes(HTML)
  assert.equal(entries.length, 2)
  assert.equal(entries[0]!.title, '思考，快与慢')
  assert.equal(entries[0]!.author, '丹尼尔·卡尼曼')
  assert.equal(entries[0]!.location, '第一部分 系统 1 与系统 2')
  assert.equal(entries[0]!.text, '我们的大脑有两套思考系统。')
  assert.equal(entries[0]!.note, '直觉回答常常出错。')
  assert.equal(entries[1]!.text, '慢思考需要注意力。')
  assert.equal(entries[1]!.note, '刻意练习慢思考。')
})

test('keeps consecutive HTML highlight blocks separate', () => {
  const entries = parseWechatReadingNotes(
    '<p>《书》</p><p>作者：某人</p><h2>第一章</h2><p>第一条划线</p><p>第二条划线</p>',
  )
  assert.equal(entries.length, 2)
  assert.equal(entries[0]!.text, '第一条划线')
  assert.equal(entries[1]!.text, '第二条划线')
})

test('treats HTML heading tags as sections', () => {
  const entries = parseWechatReadingNotes('<p>《书》</p><h4>系统 1 与系统 2</h4><p>划线内容</p>')
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.location, '系统 1 与系统 2')
  assert.equal(entries[0]!.text, '划线内容')
})

test('supports explicit title and English author fields', () => {
  const entries = parseWechatReadingNotes(`书名：《原则》
Author: Ray Dalio

前言

原则是应对现实的方式。
`)
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.title, '原则')
  assert.equal(entries[0]!.author, 'Ray Dalio')
  assert.equal(entries[0]!.location, '前言')
  assert.equal(entries[0]!.text, '原则是应对现实的方式。')
})

test('strips HTML entities and decodes numeric references', () => {
  const text = stripHtmlToText('<p>A&amp;B&nbsp;&#20013;&#x6587;</p><p>second</p>')
  assert.equal(text.trim(), 'A&B 中文\n\nsecond')
})
