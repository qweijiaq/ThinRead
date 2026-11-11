import { z } from 'zod'

/**
 * IPC 边界校验。渲染层是可被攻破的，主进程不能假设参数形状正确。
 * 只覆盖会拼路径、写库或接收大段文本的通道；其余通道沿用现有的轻量检查。
 */

export const idSchema = z.string().uuid('需要合法的 UUID')
export const noteKindSchema = z.enum(['condensed', 'summary', 'claim', 'point', 'question', 'thought', 'highlight'])
export const contentKindSchema = z.enum([
  'report',
  'chat',
  'quiz',
  'notes',
  'format',
  'compose',
  'suggestion',
  'pdf',
  'graph',
  'other',
])

const MAX_TITLE = 300
const MAX_AUTHOR = 200
const MAX_NOTE_CONTENT = 200_000
const MAX_IMPORT_TEXT = 10_000_000
const MAX_ARTIFACT_CONTENT = 5_000_000
const MAX_SAVE_CONTENT = 20_000_000

export const bookIdArgs = z.tuple([idSchema])

export const chapterIdArgs = z.tuple([idSchema])

export const chapterIdsArgs = z.tuple([
  z.array(idSchema).min(1, '至少选择一章').max(2_000, '一次最多处理 2000 章'),
])

export const chapterFormatArgs = z.tuple([
  idSchema,
  z.string().max(4_000).optional(),
  z.object({ skipReferences: z.boolean().optional(), deepPdf: z.boolean().optional() }).optional(),
])

export const bookFormatArgs = z.tuple([
  idSchema,
  z
    .object({
      onlyMissing: z.boolean().optional(),
      chapterIds: z.array(idSchema).max(2_000).optional(),
      skipReferences: z.boolean().optional(),
    })
    .optional(),
])

export const notesGenerateArgs = z.tuple([
  idSchema,
  z.object({ fresh: z.boolean().optional() }).optional(),
])

export const bookGenerateArgs = z.tuple([
  idSchema,
  z
    .object({
      onlyMissing: z.boolean().optional(),
      chapterIds: z.array(idSchema).max(2_000).optional(),
    })
    .optional(),
])

export const bookTranslateArgs = z.tuple([
  idSchema,
  z
    .object({
      force: z.boolean().optional(),
      onlyMissing: z.boolean().optional(),
      chapterIds: z.array(idSchema).max(2_000).optional(),
    })
    .optional(),
])

export const bookComposeArgs = z.tuple([
  idSchema,
  z
    .object({
      length: z.enum(['tight', 'full']).optional(),
      voice: z.enum(['calm', 'personal', 'sharp']).optional(),
    })
    .optional(),
])

export const noteIdArgs = z.tuple([idSchema])

export const chapterUnderstandImageArgs = z.tuple([idSchema, z.string().min(1).max(8_000_000)])

export const chapterCodeAssistArgs = z.tuple([
  idSchema,
  z.string().min(1).max(30_000),
  z.enum(['review', 'explain', 'fix']),
  z.string().max(40).optional(),
])

export const chapterSaveContentArgs = z.tuple([idSchema, z.string().min(1).max(5_000_000)])

export const bookReparseArgs = z.tuple([
  idSchema,
  z.object({ skipReferences: z.boolean().optional(), deepPdf: z.boolean().optional() }).optional(),
])

export const mergeBooksArgs = z.tuple([
  z.array(idSchema).min(2, '至少选择两本书').max(100, '一次最多合并 100 本书'),
  z.string().max(MAX_TITLE).optional(),
  z.string().max(MAX_AUTHOR).optional(),
])

export const splitBookArgs = z.tuple([idSchema, idSchema, z.string().max(MAX_TITLE).optional()])

export const textImportArgs = z.tuple([
  z.object({
    title: z.string().max(MAX_TITLE).optional(),
    author: z.string().max(MAX_AUTHOR).optional(),
    text: z.string().max(MAX_IMPORT_TEXT, '正文超过 1000 万字上限'),
  }),
])

export const noteDraftArgs = z.tuple([
  z.object({
    bookId: idSchema,
    chapterId: idSchema.nullish(),
    kind: noteKindSchema,
    title: z.string().max(MAX_TITLE).optional(),
    content: z.string().max(MAX_NOTE_CONTENT, '笔记超过 20 万字上限'),
    quote: z.string().max(20_000).nullish(),
    tags: z.array(z.string().max(80)).max(50).optional(),
  }),
])

export const notePatchArgs = z.tuple([
  idSchema,
  z.object({
    title: z.string().max(MAX_TITLE).optional(),
    content: z.string().max(MAX_NOTE_CONTENT, '笔记超过 20 万字上限').optional(),
    quote: z.string().max(20_000).nullish(),
    tags: z.array(z.string().max(80)).max(50).optional(),
    kind: noteKindSchema.optional(),
  }),
])

export const labArtifactArgs = z.tuple([
  z.object({
    tool: z.string().min(1).max(80),
    scope: z.string().min(1).max(200),
    title: z.string().max(MAX_TITLE),
    content: z.string().max(MAX_ARTIFACT_CONTENT, '生成内容超过 500 万字上限'),
    meta: z.string().max(MAX_ARTIFACT_CONTENT).nullish(),
    kind: contentKindSchema.optional(),
    bookId: idSchema.nullish(),
    chapterId: idSchema.nullish(),
  }),
])

export const saveTextArgs = z.tuple([
  z.string().max(MAX_TITLE),
  z.string().max(MAX_SAVE_CONTENT, '导出内容超过 2000 万字上限'),
])

export const saveTextFileArgs = z.tuple([
  z.string().max(MAX_TITLE),
  z.string().max(MAX_SAVE_CONTENT, '导出内容超过 2000 万字上限'),
  z.enum(['bib', 'ris', 'txt']),
])
