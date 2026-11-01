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
