import assert from 'node:assert/strict'
import test from 'node:test'

import { stripReferenceSectionsFromHtml, stripReferenceSectionsFromText } from '../electron/references.js'

test('removes a reference heading and its following list from chapter html', () => {
  const html = [
    '<p>正文最后一段。</p>',
    '<h3>参考文献</h3>',
    '<div><hr><ol><li><p>Richard T. Kouzes. Data-Intensive Computing.</p></li></ol></div>',
  ].join('')
  const result = stripReferenceSectionsFromHtml(html)
  assert.match(result.html, /正文最后一段/)
  assert.doesNotMatch(result.html, /参考文献|Kouzes/)
  assert.ok(result.removed.length >= 2)
})

test('keeps the next chapter heading after a reference section in html', () => {
  const html = [
    '<section><h2>第一章</h2><p>第一章正文。</p><h3>参考文献</h3><div><p>引用一</p></div></section>',
    '<section><h2>第二章</h2><p>第二章正文。</p></section>',
  ].join('')
  const result = stripReferenceSectionsFromHtml(html)
  assert.match(result.html, /第一章正文/)
  assert.match(result.html, /第二章/)
  assert.doesNotMatch(result.html, /参考文献|引用一/)
})

test('removes a references section from plain text', () => {
  const text = ['本章正文。', '参考文献', '引用一', '引用二'].join('\n')
  const result = stripReferenceSectionsFromText(text)
  assert.equal(result.text, '本章正文。')
  assert.match(result.removed[0]?.text ?? '', /参考文献/)
})
