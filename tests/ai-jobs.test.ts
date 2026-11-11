import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { closeDatabase, initDatabase, listBackgroundTasks } from '../electron/db.js'
import { dismissAiJob, listAiJobs, patchAiJob, publishAiJob } from '../electron/ai/jobs.js'

test('AI job snapshots mirror into durable tasks and can be dismissed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-ai-jobs-'))
  try {
    initDatabase(dir)
    publishAiJob(null, {
      id: 'ai-notes:c1',
      kind: 'notes',
      chapterId: 'c1',
      bookId: 'b1',
      title: '第一章',
      status: 'running',
      detail: '准备中',
      done: 0,
      total: 0,
      updatedAt: new Date().toISOString(),
    })
    assert.equal(listAiJobs().length, 1)
    const running = listBackgroundTasks().find((task) => task.id === 'ai-notes:c1')
    assert.equal(running?.status, 'running')
    assert.equal(running?.targets[0]?.id, 'c1')

    patchAiJob(null, 'ai-notes:c1', { status: 'done', detail: '完成', done: 1, total: 1 })
    const done = listBackgroundTasks().find((task) => task.id === 'ai-notes:c1')
    assert.equal(done?.status, 'done')

    assert.equal(dismissAiJob('ai-notes:c1'), true)
    assert.equal(listAiJobs().length, 0)

    publishAiJob(null, {
      id: 'ai-format:c2',
      kind: 'format',
      chapterId: 'c2',
      bookId: 'b1',
      title: '第二章',
      status: 'running',
      detail: '正在排版',
      done: 0,
      total: 1,
      formatOptions: { skipReferences: true },
      updatedAt: new Date().toISOString(),
    })
    assert.equal(dismissAiJob('ai-format:c2'), false)
    const format = listBackgroundTasks().find((task) => task.id === 'ai-format:c2')
    assert.deepEqual(format?.meta?.formatOptions, { skipReferences: true })
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
