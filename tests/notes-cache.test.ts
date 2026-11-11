import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type { NoteReport } from '../shared/types.js'
import {
  condensePrompt,
  detectSourceLanguage,
  languageDirective,
  looksLikeList,
  notesCacheKey,
  readNotesCache,
  readNotesCheckpoint,
  writeNotesCache,
  writeNotesCheckpoint,
} from '../electron/ai/notes.js'
import { pruneNotesCache } from '../electron/ai/notes-cache.js'

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

    // 排版 HTML 和相关笔记变化不应让整章缓存失效。
    const reformatted = await readNotesCache(
      { ...source, chapterHtml: '<div class="formatted">新排版</div>' },
      new AbortController().signal,
    )
    assert.ok(reformatted)
    const relatedChanged = await readNotesCache(
      {
        ...source,
        lookupRelatedNotes: () => [
          { bookTitle: '另一本书', chapterTitle: '第二章', title: '相关笔记', content: '新的跨书关联' },
        ],
      },
      new AbortController().signal,
    )
    assert.ok(relatedChanged)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})


test('reuses successfully condensed chunks after a partial failure', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'notes-checkpoint-'))
  try {
    const source = args(dir)
    const chunks = new Map([
      ['chunk-a', { compressed: '第一块读薄稿', omitted: [] }],
      ['chunk-b', { compressed: '第二块读薄稿', omitted: [{ text: '删掉的铺垫', reason: '重复' }] }],
    ])
    await writeNotesCheckpoint(source, chunks)
    const restored = await readNotesCheckpoint(source)
    assert.equal(restored.get('chunk-a')?.compressed, '第一块读薄稿')
    assert.equal(restored.get('chunk-b')?.omitted[0]?.reason, '重复')

    const fresh = await readNotesCheckpoint({ ...source, fresh: true })
    assert.equal(fresh.size, 0)
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

test('detects foreign-language chapters and defaults notes to Chinese', () => {
  const english =
    'Attention is a limited resource. The author argues that every act of resistance consumes attention, and that environment design matters more than willpower. ' +
    'This is a long enough English passage to be recognised as a foreign-language chapter.'
  const chinese = '注意力是有限资源。作者认为每一次抵抗都会消耗注意力，所以环境设计比意志力更重要。'

  assert.equal(detectSourceLanguage(chinese).foreign, false)
  assert.equal(detectSourceLanguage(english).foreign, true)

  const source = args('/tmp/notes-language', english)
  assert.match(languageDirective(source), /简体中文/)
  assert.match(languageDirective({ ...source, notesLanguage: 'source' }), /跟随原文/)
})

test('language preference participates in the cache key', () => {
  const base = args('/tmp/notes-language')
  const chinese = notesCacheKey({ ...base, notesLanguage: 'zh' })
  const followSource = notesCacheKey({ ...base, notesLanguage: 'source' })
  assert.notEqual(chinese, followSource)
})

test('vision mode and image signature participate in the cache key', () => {
  const base = args('/tmp/notes-vision')
  assert.notEqual(
    notesCacheKey({ ...base, visionMode: 'off' }),
    notesCacheKey({ ...base, visionMode: 'auto' }),
  )
  assert.notEqual(
    notesCacheKey({ ...base, imageSignature: 'image-a' }),
    notesCacheKey({ ...base, imageSignature: 'image-b' }),
  )
})

test('condense prompt keeps fenced code blocks intact', () => {
  const source = args('/tmp/notes-code')
  const prompt = condensePrompt(source, {
    sectionIndex: 0,
    title: 'Code',
    text: '说明文字。\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n后面还有说明。',
    images: [],
  })
  assert.match(prompt, /\[§2\] ```ts\nconst a = 1\n\nconst b = 2\n```/)
  assert.match(prompt, /代码/)
})

test('condense prompt asks for flowing prose and flags list-like output', () => {
  const source = args('/tmp/notes-prose', 'What is attention? '.repeat(40))
  const prompt = condensePrompt(source, {
    sectionIndex: 0,
    title: 'Attention',
    text: 'Attention is limited. '.repeat(30),
    images: [],
  })
  assert.match(prompt, /连贯/)
  assert.match(prompt, /不要使用项目符号/)
  assert.doesNotMatch(prompt, /并列项改成列表/)

  assert.equal(looksLikeList('- 关键点一\n- 关键点二\n- 关键点三'), true)
  assert.equal(
    looksLikeList(
      '注意力是一种有限资源。作者先解释了为什么抵抗诱惑会消耗注意力，随后说明环境设计如何减少这种消耗。最后，他给出了这一判断的边界。',
    ),
    false,
  )
})

test('prunes expired notes cache and checkpoint files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'notes-cache-prune-'))
  try {
    const { mkdir, writeFile, utimes } = await import('node:fs/promises')
    const oldFile = path.join(dir, 'notes', 'old.json')
    const freshFile = path.join(dir, 'notes-checkpoint', 'fresh.json')
    await mkdir(path.dirname(oldFile), { recursive: true })
    await mkdir(path.dirname(freshFile), { recursive: true })
    await writeFile(oldFile, '{}', 'utf8')
    await writeFile(freshFile, '{}', 'utf8')
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    await utimes(oldFile, old, old)
    assert.equal(await pruneNotesCache(dir), 1)
    assert.equal(fs.existsSync(oldFile), false)
    assert.equal(fs.existsSync(freshFile), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
