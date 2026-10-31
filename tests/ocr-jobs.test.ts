import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { closeDatabase, createOcrJob, getOcrJob, initDatabase, listOcrJobs, markRunningOcrJobsInterrupted, updateOcrJob } from '../electron/db.js'

test('persists OCR jobs and marks interrupted runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-ocr-jobs-'))
  try {
    initDatabase(dir)
    const job = createOcrJob({ fileName: 'scan.pdf', filePath: '/tmp/scan.pdf', startPage: 3, endPage: 9 })
    assert.equal(job.status, 'running')
    updateOcrJob(job.id, { current: 4, total: 7 })
    assert.equal(getOcrJob(job.id)?.current, 4)
    markRunningOcrJobsInterrupted()
    assert.equal(getOcrJob(job.id)?.status, 'interrupted')
    assert.equal(listOcrJobs()[0]?.id, job.id)
    updateOcrJob(job.id, { status: 'done' })
    assert.equal(getOcrJob(job.id)?.status, 'done')
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
