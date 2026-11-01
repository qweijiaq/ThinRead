import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { generateChapterNotes } from '../electron/ai/notes.js'
import { initAiTrace } from '../electron/ai/trace.js'
import type { ModelConfig } from '../electron/ai/provider.js'

const demoConfig: ModelConfig = { provider: 'demo', baseUrl: '', model: 'demo', apiKey: null }

const fixtures = [
  {
    title: '分节论证',
    text: '注意力不是无限的。每一次切换任务都会留下认知残留。\n把手机移出视线，可以减少一次选择。\n环境设计不能代替目标选择，但能降低摩擦。',
    html: '<h2>注意力的限制</h2><p>注意力不是无限的。每一次切换任务都会留下认知残留。</p><h2>环境设计</h2><p>把手机移出视线，可以减少一次选择。</p><p>环境设计不能代替目标选择，但能降低摩擦。</p>',
  },
  {
    title: '连续叙述',
    text: '阅读不是收集结论。读者需要在原文里反复确认作者的前提。只有当证据和主张对得上，卡片才值得保存。',
    html: '<p>阅读不是收集结论。读者需要在原文里反复确认作者的前提。</p><p>只有当证据和主张对得上，卡片才值得保存。</p>',
  },
]

for (const fixture of fixtures) {
  test(`demo pipeline keeps note invariants: ${fixture.title}`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-notes-eval-'))
    try {
      initAiTrace(dir)
      const result = await generateChapterNotes(
        {
          bookTitle: '评测书',
          chapterTitle: fixture.title,
          chapterText: fixture.text,
          chapterHtml: fixture.html,
          config: demoConfig,
          demo: true,
        },
        () => undefined,
        new AbortController().signal,
      )

      assert.ok(result.notes.length >= 1)
      assert.equal(result.notes[0]!.kind, 'condensed')
      assert.equal(result.report.cards, result.notes.filter((note) => note.kind === 'point').length)
      assert.ok(result.report.originalChars > 0)
      assert.ok(result.report.condensedChars > 0)
      assert.ok(result.report.ratio >= 1)
      for (const note of result.notes) {
        assert.ok(note.title.trim().length > 0)
        assert.ok(note.content.trim().length > 0)
        assert.ok(note.tags.every((tag) => typeof tag === 'string'))
        assert.ok((note.divergences ?? []).every((item) => item.text.trim().length > 0))
      }

      const traceDir = path.join(dir, 'ai-traces')
      const files = fs.readdirSync(traceDir).filter((name) => name.endsWith('.jsonl'))
      assert.equal(files.length, 1)
      const entries = fs
        .readFileSync(path.join(traceDir, files[0]!), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { step: string; ok: boolean; model: string; scope: string })
      const entry = entries.find((item) => item.step === 'chapter-notes')
      assert.ok(entry)
      assert.equal(entry!.ok, true)
      assert.equal(entry!.model, 'demo')
      assert.match(entry!.scope, /评测书/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
}
