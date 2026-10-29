import type { Note } from '../../shared/types.js'

const DIVERGENCE_LABELS: Record<string, string> = {
  boundary: '边界',
  crossbook: '跨书',
  transfer: '触类',
}

export interface MarkdownExportArgs {
  bookTitle: string
  author?: string | null
  chapterTitle: string
  date: string
  condensed: Note
  cards: Note[]
  includeCards: boolean
}

/** 导出给博客用的读薄稿；卡片只在显式要求时附在文末。 */
export function buildChapterMarkdown(args: MarkdownExportArgs): string {
  const blocks: string[] = [
    `# ${args.chapterTitle}`,
    `> 《${args.bookTitle}》${args.author ? ` · ${args.author}` : ''} · ${args.date}`,
    args.condensed.content.trim(),
  ]

  if (args.includeCards && args.cards.length > 0) {
    const cards = args.cards.map((card, index) => {
      const lines = [`### ${index + 1}. ${card.title}`, card.content.trim()]
      if (card.role) lines.push(`- **在文中的作用**：${card.role}`)
      if (card.quote) lines.push(`- **原文依据**：${card.quote}`)
      if (card.divergences.length > 0) {
        lines.push('', '**延伸**')
        for (const divergence of card.divergences) {
          lines.push(`- ${DIVERGENCE_LABELS[divergence.type] ?? divergence.type}：${divergence.text}`)
        }
      }
      return lines.join('\n')
    })
    blocks.push('---', '## 核心卡片', cards.join('\n\n'))
  }

  return `${blocks.filter((block) => block.trim()).join('\n\n')}\n`
}

export function markdownFilename(bookTitle: string, chapterTitle: string): string {
  const base = `${bookTitle} ${chapterTitle}`
    .replace(/[\\/:*?"<>|#%{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${base || 'reading-note'}.md`
}

/** 本地日期，避免 UTC 与用户所在时区相差一天。 */
export function todayStamp(): string {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
