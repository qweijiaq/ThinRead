import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { composeBook } from './ai/book-compose.js'
import { formatChapter } from './ai/format.js'
import { runLab } from './ai/lab.js'
import { generateChapterNotes } from './ai/notes.js'
import { getChapters, insertBook } from './db.js'
import { getActiveSettings } from './settings.js'
import { DEFAULT_READER_STYLE } from '../shared/types.js'

const CHAPTER_TEXT = [
  '专注不是把注意力锁死在一个点上，而是不断把走神的自己带回来。',
  '许多人以为自己缺乏意志力，其实缺的是回到任务上的动作。',
  '作者提出，真正可靠的方法不是禁止分心，而是缩短发现自己分心的时间。',
  '当你能更早觉察，就更容易在注意力漂走之前把它拉回来。',
  '环境设计比反复下决心更有效：把诱人的选项移出视线，减少一次选择需要消耗的注意力。',
  '这并不是否认意志的作用，而是把意志用在设计环境上，而不是用在每一次抵抗诱惑上。',
].join('')

/** 需要真实 API Key 的端到端检查；由 --e2e-real 触发，不写用户数据库。 */
export async function runRealE2e(): Promise<void> {
  const notesSettings = getActiveSettings('notes')
  if (notesSettings.provider === 'demo' || (!notesSettings.apiKey && notesSettings.provider !== 'ollama')) {
    throw new Error('SETUP REQUIRED：请先在设置里配置一个真实模型和 API Key。')
  }
  const notesConfig = {
    provider: notesSettings.provider,
    baseUrl: notesSettings.baseUrl,
    model: notesSettings.model,
    apiKey: notesSettings.apiKey,
  }
  const noteUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  const notes = await generateChapterNotes(
    {
      bookTitle: '真实模型 E2E',
      chapterTitle: '专注与环境',
      chapterText: CHAPTER_TEXT,
      chapterHtml: '',
      config: notesConfig,
      demo: false,
      mode: 'fast',
      usage: noteUsage,
    },
    () => undefined,
    AbortSignal.timeout(180_000),
  )
  if (notes.notes.length === 0) throw new Error('真实模型没有返回任何笔记。')

  const composeSettings = getActiveSettings('compose')
  const composeConfig = {
    provider: composeSettings.provider,
    baseUrl: composeSettings.baseUrl,
    model: composeSettings.model,
    apiKey: composeSettings.apiKey,
  }
  const composeUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  const condensed = notes.notes.filter((note) => note.kind === 'condensed').map((note) => note.content).join('\n')
  const source = condensed || notes.notes.map((note) => note.content).join('\n')
  const article = await composeBook({
    bookTitle: '真实模型 E2E',
    author: '',
    sources: [{ title: '专注与环境', content: source, cards: notes.notes.filter((note) => note.kind === 'point').map((note) => note.content) }],
    options: { length: 'tight', voice: 'calm' },
    mode: 'fast',
    usage: composeUsage,
    config: composeConfig,
    demo: false,
    signal: AbortSignal.timeout(180_000),
    onProgress: () => undefined,
  })
  if (!article.markdown.trim()) throw new Error('真实模型成稿为空。')

  const labSettings = getActiveSettings('lab')
  const book = insertBook(
    { title: '真实模型 E2E', author: '', format: 'text', filePath: '/tmp/e2e-real.txt' },
    [{ title: '专注与环境', text: CHAPTER_TEXT, html: null }],
  )
  const chapter = getChapters(book.id)[0]!
  const podcast = await runLab({
    config: {
      provider: labSettings.provider,
      baseUrl: labSettings.baseUrl,
      model: labSettings.model,
      apiKey: labSettings.apiKey,
    },
    demo: false,
    request: { tool: 'podcast', bookIds: [book.id], chapterId: chapter.id },
  })
  const aTurns = (podcast.markdown.match(/^A\s*[：:]/gm) ?? []).length
  const bTurns = (podcast.markdown.match(/^B\s*[：:]/gm) ?? []).length
  if (aTurns < 2 || bTurns < 2) throw new Error('真实模型播客脚本没有形成 A/B 对话。')

  const baseSettings = getActiveSettings()
  const formatted = await formatChapter({
    chapterTitle: '专注与环境',
    html: `<p>${CHAPTER_TEXT}</p>`,
    originalText: CHAPTER_TEXT,
    currentHtml: null,
    currentRemoved: [],
    style: DEFAULT_READER_STYLE,
    config: {
      provider: baseSettings.provider,
      baseUrl: baseSettings.baseUrl,
      model: baseSettings.model,
      apiKey: baseSettings.apiKey,
    },
    signal: AbortSignal.timeout(180_000),
  })
  if (!formatted.html.trim()) throw new Error('真实模型排版结果为空。')

  console.log(
    JSON.stringify(
      {
        provider: notesSettings.provider,
        notesModel: notesSettings.model,
        notes: notes.notes.length,
        noteTokens: noteUsage.totalTokens,
        composeModel: composeSettings.model,
        articleChars: article.markdown.length,
        composeTokens: composeUsage.totalTokens,
        podcastChars: podcast.markdown.length,
        podcastTurnsA: aTurns,
        podcastTurnsB: bTurns,
        formatChars: formatted.html.length,
        formatNote: formatted.note.slice(0, 80),
      },
      null,
      2,
    ),
  )
}


/** 只跑「标准档 + 缓存」的真实模型检查；不写成稿/播客，成本最低。 */
export async function runRealNotesE2e(): Promise<void> {
  const settings = getActiveSettings('notes')
  if (settings.provider === 'demo' || (!settings.apiKey && settings.provider !== 'ollama')) {
    throw new Error('SETUP REQUIRED：请先在设置里配置真实模型和 API Key。')
  }
  const chapterText = [
    '专注不是把注意力锁死在一个点上，而是不断把走神的自己带回来。',
    '许多人以为自己缺乏意志力，其实缺的是回到任务上的动作。',
    '作者提出，真正可靠的方法不是禁止分心，而是缩短发现自己分心的时间。',
    '当你能更早觉察，就更容易在注意力漂走之前把它拉回来。',
    '环境设计比反复下决心更有效：把诱人的选项移出视线，减少一次选择需要消耗的注意力。',
    '这并不是否认意志的作用，而是把意志用在设计环境上，而不是用在每一次抵抗诱惑上。',
    '注意力像一束窄光，照到哪里，哪里才会变成行动。',
    '把手机放到另一个房间，比在桌边反复对自己说“不要看”更可靠。',
    '真正难的从来不是知道该做什么，而是在分心发生的瞬间发现自己已经分心。',
    '所以训练的重点不是延长专注，而是缩短回到任务的时间。',
    '每一次觉察都是一次微小的复位，复位越多，越不需要靠情绪推动自己。',
    '环境不是背景，它是一组提前做好的选择。',
    '把重要的东西放在伸手可及的地方，把诱人的东西放远一点，行为就会改变。',
    '意志力应该留给真正重要的取舍，而不是消耗在每天几十次的抵抗里。',
    '这就是为什么改变环境往往比发誓更有效。',
    '读一本书也是一样：先清掉会让你分心的入口，再决定要读哪一页。',
    '当选择变少，行动反而变快。',
    '不是所有分心都需要被消灭，有些只是提醒你该休息了。',
    '关键是能分辨哪一种分心是逃避，哪一种分心是身体在求救。',
    '把这个问题想清楚，专注就不再是一场苦役。',
  ].join('')
  const longer = `${chapterText}${chapterText}${chapterText}`
  const config = {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
  }
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thinread-notes-cache-'))
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  const startedAt = Date.now()
  const first = await generateChapterNotes(
    {
      bookTitle: '真实模型标准档基线',
      chapterTitle: '专注与环境',
      chapterText: longer,
      chapterHtml: '',
      config,
      demo: false,
      mode: 'standard',
      usage,
      cacheDir,
    },
    () => undefined,
    AbortSignal.timeout(300_000),
  )
  const firstMs = Date.now() - startedAt
  const cachedStartedAt = Date.now()
  const second = await generateChapterNotes(
    {
      bookTitle: '真实模型标准档基线',
      chapterTitle: '专注与环境',
      chapterText: longer,
      chapterHtml: '',
      config,
      demo: false,
      mode: 'standard',
      cacheDir,
    },
    () => undefined,
    AbortSignal.timeout(30_000),
  )
  const cachedMs = Date.now() - cachedStartedAt
  fs.rmSync(cacheDir, { recursive: true, force: true })

  if (first.notes.length === 0) throw new Error('真实模型没有返回任何笔记。')
  if (first.report.degraded?.length) throw new Error(`真实模型生成出现降级：${JSON.stringify(first.report.degraded)}`)
  if (!second.report.cached) throw new Error('第二次生成没有命中内容哈希缓存。')
  if (second.report.usage?.totalTokens !== 0) throw new Error('缓存命中仍然消耗了 token。')
  if (second.notes.length !== first.notes.length) throw new Error('缓存结果与首次生成不一致。')

  console.log(
    JSON.stringify(
      {
        provider: settings.provider,
        model: settings.model,
        mode: first.report.mode,
        firstMs,
        tokens: usage,
        inputChars: longer.length,
        condensedChars: first.report.condensedChars,
        ratio: first.report.ratio,
        cards: first.report.cards,
        divergences: first.report.divergences,
        fidelityMissing: first.report.fidelityMissing,
        notes: first.notes.length,
        cached: second.report.cached,
        cachedTokens: second.report.cachedTokens,
        cachedMs,
      },
      null,
      2,
    ),
  )
}
