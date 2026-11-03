import fs from 'node:fs'
import path from 'node:path'

import type { BookGenre } from '../shared/types.js'
import { generateChapterNotes } from './ai/notes.js'
import { getChapter, getChapters, listBooks } from './db.js'
import { getActiveSettings } from './settings.js'

interface EvalFixture {
  name: string
  title: string
  text: string
  html: string
  genre?: BookGenre
}

const FIXTURES: EvalFixture[] = [
  {
    name: 'argument',
    title: '注意力的限制',
    genre: 'nonfiction',
    text: [
      '注意力不是无限的。每一次切换任务都会留下认知残留。',
      '许多人以为问题在意志力，其实是没有及时发现自己已经走神。',
      '把手机移出视线可以减少一次选择，但不能代替决定要做什么。',
      '真正可靠的方法不是禁止分心，而是缩短发现自己分心的时间。',
    ].join(''),
    html: '<h2>注意力的限制</h2><p>注意力不是无限的。每一次切换任务都会留下认知残留。</p><h2>环境设计</h2><p>把手机移出视线可以减少一次选择，但不能代替决定要做什么。</p><p>真正可靠的方法不是禁止分心，而是缩短发现自己分心的时间。</p>',
  },
  {
    name: 'narrative',
    title: '旧船厂',
    genre: 'detective',
    text: [
      '雾港的雨下了三天。林默在旧船厂的账本里发现一行被划掉的日期。',
      '周岚说那天没有船出海，但码头记录显示一艘小艇在凌晨离港。',
      '林默没有立刻拆穿她，而是去问守夜人。守夜人只记得那晚有人提着一盏坏掉的灯。',
    ].join(''),
    html: '<p>雾港的雨下了三天。林默在旧船厂的账本里发现一行被划掉的日期。</p><p>周岚说那天没有船出海，但码头记录显示一艘小艇在凌晨离港。</p><p>林默没有立刻拆穿她，而是去问守夜人。守夜人只记得那晚有人提着一盏坏掉的灯。</p>',
  },
  {
    name: 'short',
    title: '短章',
    text: '阅读不是收集结论。读者需要在原文里反复确认作者的前提，证据和主张对得上，卡片才值得保存。',
    html: '<p>阅读不是收集结论。读者需要在原文里反复确认作者的前提，证据和主张对得上，卡片才值得保存。</p>',
  },
]

/** 真实模型固定样例评测；需要用户在设置里配置 API Key，会消耗 token。 */
export async function runRealEval(dataDir: string): Promise<void> {
  const settings = getActiveSettings('notes')
  if (settings.provider === 'demo' || (!settings.apiKey && settings.provider !== 'ollama')) {
    throw new Error('SETUP REQUIRED：请先在设置里配置真实模型和 API Key。')
  }
  const results: Array<Record<string, unknown>> = []
  for (const fixture of FIXTURES) {
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    const startedAt = Date.now()
    const result = await generateChapterNotes(
      {
        bookTitle: '固定评测',
        chapterTitle: fixture.title,
        chapterText: fixture.text,
        chapterHtml: fixture.html,
        genre: fixture.genre,
        config: {
          provider: settings.provider,
          baseUrl: settings.baseUrl,
          model: settings.model,
          apiKey: settings.apiKey,
        },
        demo: false,
        mode: 'fast',
        usage,
      },
      () => undefined,
      AbortSignal.timeout(180_000),
    )
    const condensed = result.notes.find((note) => note.kind === 'condensed')
    if (!condensed?.content.trim()) throw new Error(`${fixture.name}：没有生成读薄稿。`)
    const withQuote = result.notes.filter((note) => note.quote?.trim())
    const verified = withQuote.filter((note) => note.quoteVerified)
    results.push({
      fixture: fixture.name,
      durationMs: Date.now() - startedAt,
      notes: result.notes.length,
      cards: result.report.cards,
      quotes: withQuote.length,
      verifiedQuotes: verified.length,
      usage,
      promptVersion: result.report.promptVersion,
      model: result.report.model,
    })
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(dataDir, `eval-real-${stamp}.json`)
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`, 'utf8')
  console.log(`[eval-real] ${JSON.stringify({ file, fixtures: results.length, results })}`)
}


/** 用真实书稿跑 N 章标准档，输出质量/成本基线；只读数据库，不写笔记。 */
export async function runRealBookEval(limit = 5, chapterFilter?: string): Promise<void> {
  const settings = getActiveSettings('notes')
  if (settings.provider === 'demo' || (!settings.apiKey && settings.provider !== 'ollama')) {
    throw new Error('SETUP REQUIRED：请先在设置里配置真实模型和 API Key。')
  }
  const book =
    listBooks().find((item) => item.chapterCount >= 5 && item.noteCount > 0) ??
    listBooks().find((item) => item.chapterCount >= 5)
  if (!book) throw new Error('书架里没有至少 5 章的书。')
  const chapters = getChapters(book.id)
    .filter((chapter) => !chapter.hidden && chapter.chars >= 4_000 && chapter.chars <= 16_000)
    .filter((chapter) => !chapterFilter || chapter.title.includes(chapterFilter))
    .sort((a, b) => a.idx - b.idx)
    .slice(0, Math.max(1, limit))
  if (chapters.length === 0) throw new Error('没有合适长度的可见章节。')

  const config = {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
  }
  const results: Array<Record<string, unknown>> = []
  let failures = 0
  for (const meta of chapters) {
    const chapter = getChapter(meta.id)
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    const startedAt = Date.now()
    try {
    const result = await generateChapterNotes(
      {
        bookTitle: book.title,
        chapterTitle: chapter.title,
        chapterText: chapter.text,
        chapterHtml: chapter.formattedHtml ?? chapter.html ?? '',
        genre: book.genre,
        config,
        demo: false,
        mode: 'standard',
        usage,
        debugRaw: (step, text) => {
          fs.writeFileSync(path.join(process.cwd(), 'docs', `raw-${step}.txt`), text, 'utf8')
        },
      },
      () => undefined,
      AbortSignal.timeout(900_000),
    )
    const condensed = result.notes.find((note) => note.kind === 'condensed')
    if (!condensed?.content.trim()) throw new Error(`${chapter.title}：没有生成读薄稿。`)
    const cards = result.notes.filter((note) => note.kind === 'point' || note.kind === 'claim')
    const withQuote = cards.filter((note) => note.quote?.trim())
    const normalized = cards.map((note) => note.content.replace(/\s|[，。！？；：、,.!?;:]/g, ''))
    const duplicateCards = normalized.length - new Set(normalized).size
    results.push({
      chapter: chapter.title,
      inputChars: chapter.text.length,
      durationMs: Date.now() - startedAt,
      tokens: usage,
      condensedChars: result.report.condensedChars,
      ratio: Number(result.report.ratio.toFixed(2)),
      cards: cards.length,
      withQuotes: withQuote.length,
      verifiedQuotes: withQuote.filter((note) => note.quoteVerified).length,
      duplicateCards,
      divergences: result.report.divergences,
      fidelityMissing: result.report.fidelityMissing,
      degraded: result.report.degraded?.length ?? 0,
      condensedPreview: condensed.content.slice(0, 240),
      cardPreviews: cards.slice(0, 5).map((note) => note.content.slice(0, 100)),
    })
    console.log(`[eval-book] ${chapter.title} done: ${cards.length} cards, ${usage.totalTokens} tokens`)
    } catch (error) {
      failures++
      results.push({
        chapter: chapter.title,
        inputChars: chapter.text.length,
        durationMs: Date.now() - startedAt,
        tokens: usage,
        error: error instanceof Error ? error.message : String(error),
      })
      console.log(`[eval-book] ${chapter.title} FAILED: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const totalTokens = results.reduce((sum, item) => sum + ((item.tokens as { totalTokens?: number }).totalTokens ?? 0), 0)
  const totalMs = results.reduce((sum, item) => sum + Number(item.durationMs), 0)
  const output = {
    at: new Date().toISOString(),
    provider: settings.provider,
    model: settings.model,
    mode: 'standard',
    book: { title: book.title, author: book.author },
    chapters: results.length,
    failures,
    totalTokens,
    totalMs,
    results,
  }
  const suffix = chapterFilter ? `-${chapterFilter.replace(/[^\w\u4e00-\u9fa5]/g, '')}` : ''
  const file = path.join(process.cwd(), 'docs', `real-book-eval${chapterFilter ? `-recheck${suffix}` : ''}.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(`[eval-book] ${JSON.stringify({ file, book: book.title, chapters: results.length, totalTokens, totalMs })}`)
}
