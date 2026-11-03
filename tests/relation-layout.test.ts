import assert from 'node:assert/strict'
import test from 'node:test'

import { countCrossings, countOverlaps, relationLabelWidth, segmentsCross } from '../src/lib/relation-layout.js'

test('detects crossing segments but ignores shared endpoints', () => {
  assert.equal(
    segmentsCross({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }),
    true,
  )
  assert.equal(
    segmentsCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }),
    true,
  )
  const points = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 10, y: 10 }],
    ['c', { x: 0, y: 10 }],
    ['d', { x: 10, y: 0 }],
  ])
  assert.equal(countCrossings(points, [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }]), 1)
})

test('keeps long labels fully sized and counts overlapping node boxes', () => {
  assert.ok(relationLabelWidth('一个非常长的人物头衔或地点名称', 56) > 56)
  assert.equal(relationLabelWidth('短名', 56), 56)
  assert.equal(
    countOverlaps([
      { x: 0, y: 0, width: 50, height: 50 },
      { x: 25, y: 25, width: 50, height: 50 },
      { x: 200, y: 200, width: 50, height: 50 },
    ]),
    1,
  )
})
