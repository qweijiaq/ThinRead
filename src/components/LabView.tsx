import { useEffect, useMemo, useState, type JSX } from 'react'
import type { BookSummary, ChapterMeta, LabToolId } from '../../shared/types.js'
import { LAB_TOOLS, labTool } from '../lib/lab-tools.js'
import { LabChat } from './LabChat.js'
import { LabDuplicateCards } from './LabDuplicateCards.js'
import { LabExperiments } from './LabExperiments.js'
import { LabMergeConcepts } from './LabMergeConcepts.js'
import { LabPdfPage } from './LabPdfPage.js'
import { LabQuiz } from './LabQuiz.js'
import { LabReport } from './LabReport.js'
import { LabShare } from './LabShare.js'

interface LabViewProps {
  books: BookSummary[]
  onBack(): void
  onSaveReport(title: string, markdown: string, bookId: string, chapterId: string): Promise<void>
  onListen(title: string, text: string): void
}

export function LabView({ books, onBack, onSaveReport, onListen }: LabViewProps): JSX.Element {
  const [toolId, setToolId] = useState<LabToolId>('library-research')
  const [bookIds, setBookIds] = useState<string[]>([])
  const [bookId, setBookId] = useState(books.find((book) => book.chapterCount > 0)?.id ?? books[0]?.id ?? '')
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [chapterId, setChapterId] = useState('')
  const [questions, setQuestions] = useState<Record<string, string>>({})
  const [visited, setVisited] = useState<Set<LabToolId>>(() => new Set(['library-research']))
  const [chapterError, setChapterError] = useState<string | null>(null)
  const tool = labTool(toolId) ?? LAB_TOOLS[0]!
  const question = questions[toolId] ?? ''
  function setQuestion(value: string): void {
    setQuestions((current) => ({ ...current, [toolId]: value }))
  }

  useEffect(() => {
    if (!bookId) {
      setChapters([])
      setChapterId('')
      return
    }
    let cancelled = false
    setChapterError(null)
    void window.api
      .openBook(bookId)
      .then((opened) => {
        if (cancelled) return
        const visible = opened.chapters.filter((chapter) => !chapter.hidden)
        setChapters(visible)
        setChapterId((current) => (visible.some((chapter) => chapter.id === current) ? current : visible[0]?.id ?? ''))
      })
      .catch((err: unknown) => {
        if (!cancelled) setChapterError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [bookId])

  const groups = useMemo(() => [...new Set(LAB_TOOLS.map((item) => item.group))], [])
  const selectedBook = books.find((book) => book.id === bookId) ?? null

  function toggleBook(id: string): void {
    setBookIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  const needsChapter = tool.chapter
  const sourceHint =
    tool.books === 'multi'
      ? bookIds.length > 0
        ? `已选 ${bookIds.length} 本书`
        : '未选书时使用全库'
      : tool.books === 'single'
        ? selectedBook?.title ?? '还没有书'
        : null

  return (
    <main className="lab-view">
      <header className="lab-header">
        <div>
          <h1>AI 工作台</h1>
          <p>把读薄稿、卡片和笔记变成对话、研究、练习和输出。</p>
        </div>
        <button type="button" className="ghost-button" onClick={onBack}>
          返回
        </button>
      </header>

      <div className="lab-layout">
        <nav className="lab-rail">
          {groups.map((group) => (
            <div key={group} className="lab-rail-group">
              <span>{group}</span>
              {LAB_TOOLS.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === toolId ? 'is-active' : ''}
                  onClick={() => {
                    setToolId(item.id)
                    setVisited((current) => (current.has(item.id) ? current : new Set(current).add(item.id)))
                    if (item.id === 'author-roundtable' && bookIds.length === 0 && books.length > 0) {
                      setBookIds([bookId || books[0]!.id])
                    }
                  }}
                  title={item.description}
                >
                  {item.title}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <section className="lab-main">
          <div className="lab-tool-head">
            <div>
              <h2>{tool.title}</h2>
              <p>{tool.description}</p>
            </div>
            <span className="lab-tool-group">{tool.group}</span>
          </div>

          {tool.kind === 'chat' || tool.kind === 'report' ? (
            <div className="lab-sources">
              {tool.books === 'multi' ? (
                <div className="lab-source-block">
                  <span className="lab-source-label">选择书 <em>{sourceHint}</em></span>
                  <div className="lab-book-chips">
                    {books.map((book) => (
                      <button
                        key={book.id}
                        type="button"
                        className={bookIds.includes(book.id) ? 'is-active' : ''}
                        onClick={() => toggleBook(book.id)}
                      >
                        {book.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {tool.books === 'single' ? (
                <label className="lab-source-block lab-inline-source">
                  <span className="lab-source-label">书</span>
                  <select value={bookId} onChange={(event) => setBookId(event.target.value)}>
                    {books.map((book) => (
                      <option key={book.id} value={book.id}>
                        {book.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {needsChapter ? (
                <label className="lab-source-block lab-inline-source">
                  <span className="lab-source-label">章节</span>
                  <select value={chapterId} onChange={(event) => setChapterId(event.target.value)}>
                    {chapters.map((chapter) => (
                      <option key={chapter.id} value={chapter.id}>
                        {chapter.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {tool.kind === 'report' && tool.question ? (
                <label className="lab-source-block">
                  <span className="lab-source-label">{tool.questionLabel ?? '输入'}</span>
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder={tool.questionPlaceholder}
                    rows={tool.id === 'margin-note' ? 3 : 2}
                  />
                </label>
              ) : null}
              {chapterError ? <span className="lab-source-error">{chapterError}</span> : null}
            </div>
          ) : null}

          <div className="lab-panes">
            {[...visited].map((id) => {
              const item = labTool(id) ?? tool
              const paneQuestion = questions[id] ?? ''
              const selectedBooks = bookIds
                .map((idItem) => books.find((book) => book.id === idItem)?.title)
                .filter((title): title is string => Boolean(title))
              const sourceLabel = item.chapter
                ? `${chapters.find((chapter) => chapter.id === chapterId)?.title ?? ''}${item.id === 'margin-note' && paneQuestion.trim() ? ` · ${paneQuestion.trim().slice(0, 24)}` : ''}`
                : item.books === 'multi'
                  ? `${selectedBooks.length > 0 ? selectedBooks.join('、') : '全库'}${paneQuestion.trim() ? ` · ${paneQuestion.trim().slice(0, 24)}` : ''}`
                  : item.books === 'single'
                    ? books.find((book) => book.id === bookId)?.title ?? ''
                    : item.id === 'view-timeline' || item.id === 'margin-note'
                      ? paneQuestion.trim().slice(0, 32)
                      : '全库'
              return (
                <div key={id} className={`lab-tool-pane${id === toolId ? ' is-active' : ''}`}>
                  {item.kind === 'chat' ? (
                    <LabChat
                      tool={item.id}
                      bookIds={bookIds}
                      chapterId={chapterId}
                      voice={item.id === 'voice-chat'}
                    />
                  ) : item.kind === 'report' ? (
                    <LabReport
                      tool={item.id}
                      bookIds={bookIds}
                      bookId={bookId}
                      chapterId={chapterId}
                      question={paneQuestion}
                      sourceLabel={sourceLabel}
                      onSave={(title, markdown, targetBookId, targetChapterId) =>
                        onSaveReport(title, markdown, targetBookId || bookId || books[0]?.id || '', targetChapterId)
                      }
                      onListen={onListen}
                    />
                  ) : item.kind === 'pdf' ? (
                    <LabPdfPage books={books} />
                  ) : item.kind === 'quiz' ? (
                    chapterId ? (
                      <LabQuiz key={chapterId} chapterId={chapterId} />
                    ) : (
                      <p className="lab-empty">先选择一章，才能出题。</p>
                    )
                  ) : item.kind === 'merge' ? (
                    <LabMergeConcepts />
                  ) : item.kind === 'dedupe' ? (
                    <LabDuplicateCards />
                  ) : item.kind === 'experiments' ? (
                    <LabExperiments />
                  ) : (
                    <LabShare />
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}
