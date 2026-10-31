import assert from 'node:assert/strict'
import test from 'node:test'

import { judgeChapter } from '../electron/ai/classify.js'

test('classifies ads but keeps a preface that mentions promotion', () => {
  assert.equal(
    judgeChapter({ title: '广告', text: '灵语网络英语培训班招生，报名从速，微信咨询，课程优惠。' }).kind,
    'ad',
  )
  assert.equal(
    judgeChapter({ title: '总序', text: '我的作品在中国——新版文集总序。这是一段图书推广活动之后的作者自述。' }).kind,
    'content',
  )
  assert.equal(judgeChapter({ title: '版权', text: '图书在版编目（CIP）数据 ISBN 978-7-5327-0000-0' }).kind, 'copyright')
})
