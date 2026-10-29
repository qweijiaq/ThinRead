import { strToU8, zipSync } from 'fflate'

import { generateChapterNotes } from './ai/notes.js'
import { createNote, getBookSummary, getChapter, getChapters, insertBook, listBooks, listNotes } from './db.js'
import { parseEpub } from './parsers/epub.js'

export function sampleEpubBuffer(): Buffer {
  const chapterOne =
    '第一章 论专注\n\n专注不是把注意力锁死在一个点上，而是不断把走神的自己带回来。' +
    '许多人以为自己缺乏意志力，其实缺的是回到任务上的动作。' +
    '作者提出，真正可靠的方法不是禁止分心，而是缩短发现自己分心的时间。' +
    '当你能更早觉察，就更容易在注意力漂走之前把它拉回来。' +
    '本章最后讨论了环境设计：把诱人的选项移出视线，比反复下决心更有效。'
  const chapterTwo =
    '第二章 环境与选择\n\n人的选择并不只发生在头脑里，环境本身也在替我们做决定。' +
    '把手机放到另一个房间，比告诉自己“不要看手机”更可靠。' +
    '作者引用了一系列实验说明，减少选项数量能显著降低拖延。' +
    '这并不意味着意志无用，而是说意志应该用在设计环境上，而不是用在每一次抵抗诱惑上。'

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>专注的练习</dc:title>
    <dc:creator>示例作者</dc:creator>
    <dc:identifier id="bookid">urn:uuid:sample</dc:identifier>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

  const xhtml = (title: string, body: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1><p>${body.replace(/\n\n/g, '</p><p>')}</p></body></html>`

  const zipped = zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/ch1.xhtml': strToU8(xhtml('第一章 论专注', chapterOne)),
    'OEBPS/ch2.xhtml': strToU8(xhtml('第二章 环境与选择', chapterTwo)),
  })
  return Buffer.from(zipped)
}

export async function runSmokeTest(): Promise<void> {
  const parsed = parseEpub(sampleEpubBuffer(), 'sample.epub')
  if (parsed.title !== '专注的练习') throw new Error(`书名解析错误：${parsed.title}`)
  if (parsed.chapters.length !== 2) throw new Error(`章节数量错误：${parsed.chapters.length}`)

  const book = insertBook(
    { title: parsed.title, author: parsed.author, format: 'epub', filePath: '/tmp/sample.epub' },
    parsed.chapters,
  )
  if (listBooks().length !== 1) throw new Error('书籍列表错误')
  const chapters = getChapters(book.id)
  if (chapters.length !== 2) throw new Error('章节列表错误')

  const chapter = getChapter(chapters[0]!.id)
  if (!chapter.text.includes('专注')) throw new Error('章节正文错误')

  const manual = createNote({
    bookId: book.id,
    chapterId: chapter.id,
    kind: 'thought',
    content: '我的想法：注意力是可以被训练的。',
  })
  if (listNotes(book.id).length !== 1) throw new Error('笔记写入错误')

  const { notes: generated, report } = await generateChapterNotes(
    {
      bookTitle: book.title,
      chapterTitle: chapter.title,
      chapterText: chapter.text,
      chapterHtml: chapter.html ?? '',
      config: { provider: 'demo', baseUrl: '', model: 'demo', apiKey: null },
      demo: true,
    },
    () => undefined,
    new AbortController().signal,
  )
  const condensed = generated.find((note) => note.kind === 'condensed')
  if (!condensed) throw new Error('演示生成缺少读薄稿')
  if (!generated.some((note) => note.kind === 'point' && note.quoteVerified)) {
    throw new Error('演示生成没有可校验的原文引用')
  }

  console.log(
    JSON.stringify(
      {
        book: getBookSummary(book.id)?.title,
        chapters: chapters.length,
        manualNote: manual.title,
        report,
        generated: generated.map((note) => ({
          kind: note.kind,
          verified: note.quoteVerified,
          section: note.section,
          divergences: note.divergences?.length ?? 0,
        })),
      },
      null,
      2,
    ),
  )
}
