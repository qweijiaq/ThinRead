import type { ContentItem, ContentKind } from '../../shared/types.js'

export const CONTENT_KIND_LABELS: Record<ContentKind, string> = {
  report: '报告',
  chat: '对话',
  quiz: '出题',
  notes: '笔记',
  format: '排版',
  compose: '整本成稿',
  suggestion: '整理建议',
  pdf: 'PDF 页',
  graph: '关系图',
  other: '其他',
}

/** 把不同工具的 JSON 内容转成可读 Markdown，供预览、复制和存为笔记。 */
export function contentToMarkdown(item: ContentItem): string {
  if (item.kind === 'chat') {
    try {
      const parsed = JSON.parse(item.content) as { turns?: Array<{ role?: string; content?: string }> }
      if (Array.isArray(parsed.turns)) {
        return parsed.turns
          .map((turn) => `**${turn.role === 'user' ? '我' : '助手'}**：${turn.content ?? ''}`)
          .join('\n\n')
      }
    } catch {
      // 旧格式直接显示原文。
    }
  }
  if (item.kind === 'quiz') {
    try {
      const parsed = JSON.parse(item.content) as {
        quiz?: { questions?: Array<Record<string, unknown>> }
        questions?: Array<Record<string, unknown>>
      }
      const questions = parsed.quiz?.questions ?? parsed.questions
      if (Array.isArray(questions)) {
        return questions
          .map((question, index) => {
            const title = typeof question.question === 'string' ? question.question : ''
            const answer = typeof question.answer === 'string' ? question.answer : ''
            const source = typeof question.source === 'string' ? question.source : ''
            return `${index + 1}. **${title}**\n\n参考答案：${answer}${source ? `\n\n依据：${source}` : ''}`
          })
          .join('\n\n')
      }
    } catch {
      // 旧格式直接显示原文。
    }
  }
  if (item.kind === 'notes') {
    try {
      const parsed = JSON.parse(item.content) as { notes?: Array<Record<string, unknown>> }
      if (Array.isArray(parsed.notes)) {
        return parsed.notes
          .filter((note) => typeof note.content === 'string' && note.content.trim())
          .map((note) => {
            const title = typeof note.title === 'string' ? note.title : ''
            return `${title ? `### ${title}\n\n` : ''}${note.content as string}`
          })
          .join('\n\n')
      }
    } catch {
      // 旧格式直接显示原文。
    }
  }
  if (item.kind === 'graph') {
    try {
      const parsed = JSON.parse(item.content) as {
        title?: string
        genre?: string
        summary?: string
        plot?: string
        nodes?: Array<{ label?: string; kind?: string; role?: string; importance?: number; identity?: string; rank?: string; affiliation?: string; aliases?: string[]; realWorld?: boolean; encyclopedia?: string; description?: string; chapters?: string[] }>
        edges?: Array<{ source?: string; target?: string; label?: string; description?: string; chapters?: string[] }>
      }
      if (Array.isArray(parsed.nodes)) {
        const lines = [
          parsed.title ? `# ${parsed.title}` : '',
          parsed.genre ? `体裁：${parsed.genre}` : '',
          parsed.summary ?? '',
          parsed.plot ?? '',
          '## 节点',
          ...parsed.nodes.map((node) => {
            const facts = [node.identity, node.rank, node.affiliation].filter(Boolean).join(' / ')
            const wiki = node.encyclopedia ? `\n  百科：${node.encyclopedia}` : ''
            const chapters = node.chapters?.length ? `\n  出处：${node.chapters.join('、')}` : ''
            return `- ${node.label ?? '未命名'}（${node.kind ?? 'other'}${node.role ? ` · ${node.role}` : ''}${node.importance ? ` · 重要度 ${node.importance}` : ''}${facts ? ` · ${facts}` : ''}）：${node.description ?? ''}${wiki}${chapters}`
          }),
          '## 关系',
          ...(parsed.edges ?? []).map((edge) => `- ${edge.source ?? ''} — ${edge.label ?? '关系'} — ${edge.target ?? ''}${edge.description ? `：${edge.description}` : ''}${edge.chapters?.length ? `（出处：${edge.chapters.join('、')}）` : ''}`),
        ].filter(Boolean)
        return lines.join('\n')
      }
    } catch {
      // 旧格式直接显示原文。
    }
  }
  if (item.kind === 'compose') {
    try {
      const parsed = JSON.parse(item.content) as { markdown?: string }
      if (typeof parsed.markdown === 'string') return parsed.markdown
    } catch {
      // 旧格式直接显示原文。
    }
  }
  if (item.kind === 'pdf') {
    try {
      const parsed = JSON.parse(item.content) as { result?: { markdown?: string } }
      if (typeof parsed.result?.markdown === 'string') return parsed.result.markdown
    } catch {
      // 旧格式直接显示原文。
    }
  }
  if (item.kind === 'format') {
    try {
      const parsed = JSON.parse(item.content) as { note?: string; removed?: unknown[] }
      const note = typeof parsed.note === 'string' ? parsed.note.trim() : ''
      if (note) return note
      if (Array.isArray(parsed.removed)) return `本次排版移除了 ${parsed.removed.length} 处内容。`
    } catch {
      // 旧格式直接显示原文。
    }
  }
  return item.content
}

export function contentSnippet(item: ContentItem, length = 140): string {
  return contentToMarkdown(item).replace(/\s+/g, ' ').trim().slice(0, length)
}
