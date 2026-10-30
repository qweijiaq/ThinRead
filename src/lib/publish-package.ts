import { strToU8, zipSync } from 'fflate'

import { bookDescription, buildBookBlogHtml } from './blog-export.js'
import { coverBase64 } from './publish-cover.js'

export interface PublishPackageInput {
  bookTitle: string
  author: string
  title: string
  markdown: string
  description: string
  date: string
  coverDataUrl: string
  includeCover: boolean
  includeMarkdown: boolean
}

export interface PublishPackage {
  archive: Uint8Array
  fileName: string
  entries: string[]
}

function safeName(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|#%{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70) || 'reading-notes'
  )
}

function readme(input: PublishPackageInput): string {
  return [
    `《${input.bookTitle}》读书笔记发布包`,
    '',
    '把整个文件夹上传到任意静态托管即可（GitHub Pages、Netlify、Vercel、Cloudflare Pages 等）。',
    'index.html 是文章首页；cover.png 同时用作页面封面和 Open Graph 图片。',
    input.includeMarkdown ? 'notes.md 是未套版式的 Markdown 原稿，方便再编辑。' : '',
    '页面不依赖外部字体、脚本或图片，可以直接离线打开。',
  ]
    .filter(Boolean)
    .join('\n')
}

/** 生成可上传的发布包；封面和 HTML 都在本地生成，不访问外部服务。 */
export function buildPublishPackage(input: PublishPackageInput): PublishPackage {
  const articleTitle = input.title.trim() || input.bookTitle
  const coverSrc = input.includeCover ? 'cover.png' : undefined
  const html = buildBookBlogHtml({
    bookTitle: articleTitle,
    author: input.author,
    markdown: input.markdown,
    date: input.date,
    description: input.description.trim() || undefined,
    coverSrc,
  })
  const files: Record<string, Uint8Array> = {
    'index.html': strToU8(html),
    'README.txt': strToU8(readme(input)),
    'metadata.json': strToU8(
      JSON.stringify(
        {
          title: articleTitle,
          author: input.author,
          description: input.description.trim() || bookDescription(input.markdown, 300),
          date: input.date,
          source: '页边 ThinRead',
          cover: coverSrc ?? null,
        },
        null,
        2,
      ),
    ),
  }
  if (input.includeCover) {
    if (!input.coverDataUrl) throw new Error('封面还没有生成完成，请稍等。')
    files['cover.png'] = Uint8Array.from(atob(coverBase64(input.coverDataUrl)), (char) => char.charCodeAt(0))
  }
  if (input.includeMarkdown) files['notes.md'] = strToU8(input.markdown)
  return {
    archive: zipSync(files, { level: 6 }),
    fileName: `${safeName(articleTitle)} 发布包.zip`,
    entries: Object.keys(files),
  }
}
