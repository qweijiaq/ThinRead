import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  closeDatabase,
  initDatabase,
  listBackgroundTasks,
  markInterruptedBackgroundTasksPaused,
  pruneBackgroundTasks,
  updateBackgroundTask,
  upsertBackgroundTask,
} from '../electron/db.js'

test('marks interrupted tasks paused and keeps their remaining targets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-tasks-'))
  try {
    initDatabase(dir)
    upsertBackgroundTask({
      id: 'notes:b1',
      kind: 'notes',
      bookId: 'b1',
      targets: [
        { id: 'c1', title: '第一章' },
        { id: 'c2', title: '第二章' },
      ],
      status: 'running',
      done: 1,
    })
    markInterruptedBackgroundTasksPaused()
    const task = listBackgroundTasks()[0]!
    assert.equal(task.status, 'paused')
    assert.equal(task.done, 1)
    assert.deepEqual(task.targets.map((target) => target.id), ['c1', 'c2'])

    updateBackgroundTask('notes:b1', { status: 'done', done: 2 })
    assert.equal(listBackgroundTasks()[0]!.status, 'done')

    const db = new DatabaseSync(path.join(dir, 'reading-notes.db'))
    db.prepare("UPDATE background_tasks SET updated_at = '2020-01-01T00:00:00.000Z'").run()
    db.close()
    pruneBackgroundTasks()
    assert.equal(listBackgroundTasks().length, 0)
  } finally {
    closeDatabase()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
