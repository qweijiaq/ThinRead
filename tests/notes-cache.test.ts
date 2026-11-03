import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type { NoteReport } from '../shared/types.js'
import { notesCacheKey, readNotesCache, writeNotesCache } from '../electron/ai/notes.js'

function args(cacheDir: string, text = '这一章讲注意力有限。') {
  return {
    bookTitle: '认知之书',
    chapterTitle: '第一章 注意力',
    chapterText: text,
    chapterHtml: `<p>${text}</p>`,
    config: { provider: 'ollama' as const, baseUrl: 'http://127.0.0.1:9', model: 'demo', apiKey: null },
    demo: false,
    mode: 'fast' as const,
    cacheDir,
    lookupRelatedNotes: () => [],
  }
}

const report: NoteReport = {
  originalChars: 12,
  condensedChars: 6,
  ratio: 2,
  sections: 1,
  cards: 1,
  divergences: 0,
  fidelityMissing: 0,
  omitted: 0,
  durationMs: 8,
  mode: 'fast',
  usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
  promptVersion: 'notes-v6',
  model: 'demo',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const note = {
  kind: 'point' as const,
  title: '注意力有限',
  content: '注意力是有限资源。',
  quote: null,
  quoteVerified: false,
  tags: ['注意力'],
  divergences: [],
}

test('content-hash cache round-trips without calling the model', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'notes-cache-'))
  try {
    const source = args(dir)
    await writeNotesCache(source, { notes: [note], report }, [])
    const cached = await readNotesCache(source, new AbortController().signal)
    assert.ok(cached)
    assert.equal(cached.notes.length, 1)
    assert.equal(cached.report.cached, true)
    assert.equal(cached.report.cachedTokens, 150)
    assert.equal(cached.report.usage?.totalTokens, 0)

    const changed = await readNotesCache(args(dir, '这一章换了内容。'), new AbortController().signal)
    assert.equal(changed, null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})


test('ignores a corrupted cache file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'notes-cache-bad-'))
  try {
    const source = args(dir)
    const file = path.join(dir, 'notes', `${notesCacheKey(source)}.json`)
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, '{"version":1,"notes":', 'utf8')
    assert.equal(await readNotesCache(source, new AbortController().signal), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
