import { z } from 'zod'

import type {
  FeynmanResult,
  GeneratedNote,
  LabChatAnswer,
  LabDuplicatePair,
  LabMergeGroup,
  LabQuiz,
  Note,
  NoteKind,
  NoteReport,
  ReaderStyle,
  RelationGraph,
  RelationNodeKind,
  RelationRole,
  RemovedPart,
} from './types.js'

const NOTE_KINDS = [
  'condensed',
  'summary',
  'claim',
  'point',
  'question',
  'thought',
  'highlight',
] as const satisfies readonly NoteKind[]

const DIVERGENCE_TYPES = ['boundary', 'crossbook', 'transfer'] as const
const RELATION_NODE_KINDS = ['person', 'organization', 'place', 'event', 'concept'] as const
const RELATION_ROLES = ['detective', 'killer', 'victim', 'witness', 'suspect', 'protagonist', 'supporting', 'other'] as const
const RELATION_EDGE_KINDS = ['family', 'ally', 'rival', 'suspect', 'motive', 'clue', 'event', 'other'] as const

export const noteKindSchema = z.enum(NOTE_KINDS)
export const noteDivergenceSchema = z.object({
  type: z.enum(DIVERGENCE_TYPES),
  text: z.string().trim().min(1),
})

const generatedNoteShape = {
  kind: noteKindSchema,
  title: z.string().trim().min(1),
  content: z.string().trim().min(1),
  quote: z.string().nullable(),
  quoteVerified: z.boolean(),
  tags: z.array(z.string()),
  section: z.string().nullable().optional(),
  importance: z.number().int().min(1).max(5).nullable().optional(),
  role: z.string().nullable().optional(),
  divergences: z.array(noteDivergenceSchema).optional(),
}

export const generatedNoteSchema = z.object(generatedNoteShape) satisfies z.ZodType<GeneratedNote>
export const generatedNoteListSchema = z.array(generatedNoteSchema).min(1)

/** 数据库读出的完整笔记；kind/author 这类枚举在损坏的旧数据里也会被拒绝。 */
export const noteSchema = z.object({
  id: z.string().min(1),
  bookId: z.string().min(1),
  chapterId: z.string().nullable(),
  kind: noteKindSchema,
  title: z.string().trim().min(1),
  content: z.string(),
  quote: z.string().nullable(),
  quoteVerified: z.boolean(),
  author: z.enum(['ai', 'user']),
  edited: z.boolean(),
  tags: z.array(z.string()),
  section: z.string().nullable(),
  importance: z.number().int().min(1).max(5).nullable(),
  role: z.string().nullable(),
  divergences: z.array(noteDivergenceSchema),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}) satisfies z.ZodType<Note>

export const relationNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(RELATION_NODE_KINDS) satisfies z.ZodType<RelationNodeKind>,
  role: z.enum(RELATION_ROLES) satisfies z.ZodType<RelationRole>,
  importance: z.number().int().min(1).max(5),
  identity: z.string(),
  rank: z.string(),
  affiliation: z.string(),
  aliases: z.array(z.string()),
  realWorld: z.boolean(),
  encyclopedia: z.string(),
  description: z.string(),
  chapters: z.array(z.string()).optional(),
})

export const relationEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().min(1),
  reverseLabel: z.string().min(1),
  kind: z.enum(RELATION_EDGE_KINDS),
  description: z.string(),
  chapters: z.array(z.string()).optional(),
})

export const relationGraphSchema = z.object({
  title: z.string().min(1),
  genre: z.string(),
  summary: z.string(),
  plot: z.string(),
  nodes: z.array(relationNodeSchema).min(1),
  edges: z.array(relationEdgeSchema),
}) satisfies z.ZodType<RelationGraph>

export const labQuizSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().trim().min(1),
        kind: z.string(),
        answer: z.string().trim().min(1),
        source: z.string(),
      }),
    )
    .min(1),
}) satisfies z.ZodType<LabQuiz>

export const tagListSchema = z.array(z.string())

/** 模型输出的是引文字符串；verified 由本地对照正文后补齐。 */
export const chatOutputSchema = z.object({
  answer: z.string().trim().min(1),
  citations: z.array(z.string()),
})

export const feynmanResultSchema = z.object({
  feedback: z.string(),
  covered: z.array(z.string()),
  missing: z.array(z.string()),
  misconceptions: z.array(z.string()),
}) satisfies z.ZodType<FeynmanResult>

export const labChatAnswerSchema = z.object({
  answer: z.string().trim().min(1),
}) satisfies z.ZodType<LabChatAnswer>

export const chatTurnsSchema = z.object({
  turns: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
})

export const readerStyleSchema = z.object({
  fontFamily: z.enum(['serif', 'sans']),
  fontSize: z.number(),
  lineHeight: z.number(),
  paragraphSpacing: z.number(),
  indent: z.boolean(),
  theme: z.enum(['paper', 'plain', 'warm', 'folio']),
}) satisfies z.ZodType<ReaderStyle>

export const removedPartSchema = z.object({
  reason: z.string(),
  text: z.string(),
  verified: z.boolean(),
}) satisfies z.ZodType<RemovedPart>

export const noteReportSchema = z.object({
  originalChars: z.number(),
  condensedChars: z.number(),
  ratio: z.number(),
  sections: z.number(),
  cards: z.number(),
  divergences: z.number(),
  fidelityMissing: z.number(),
  omitted: z.number(),
  omittedItems: z.array(z.object({ text: z.string(), reason: z.string() })).optional(),
  durationMs: z.number(),
  mode: z.enum(['fast', 'standard', 'deep']).optional(),
  usage: z
    .object({ inputTokens: z.number(), outputTokens: z.number(), totalTokens: z.number() })
    .optional(),
  promptVersion: z.string().optional(),
  model: z.string(),
  createdAt: z.string(),
}) satisfies z.ZodType<NoteReport>

export const formatArtifactSchema = z.object({
  html: z.string().trim().min(1),
  removed: z.array(removedPartSchema),
  style: readerStyleSchema.optional(),
  note: z.string().optional(),
})

export const notesArtifactSchema = z.object({
  notes: z.array(noteSchema).min(1),
  report: noteReportSchema.nullable().optional(),
})

export const feynmanArtifactSchema = z.object({
  explanation: z.string(),
  result: feynmanResultSchema,
})

export const composeArtifactSchema = z.object({ markdown: z.string() })
export const pdfPageArtifactSchema = z.object({ result: z.object({ markdown: z.string() }) })

export const labMergeGroupsSchema = z.array(
  z.object({
    canonical: z.string(),
    tags: z.array(z.string()),
    reason: z.string(),
    noteCount: z.number(),
  }),
) satisfies z.ZodType<LabMergeGroup[]>

export const labDuplicatePairsSchema = z.array(
  z.object({
    keepId: z.string(),
    keepTitle: z.string(),
    keepBookTitle: z.string(),
    keepChapterId: z.string().nullable(),
    keepChapterTitle: z.string().nullable(),
    keepPreview: z.string(),
    mergeId: z.string(),
    mergeTitle: z.string(),
    mergeBookTitle: z.string(),
    mergeChapterId: z.string().nullable(),
    mergeChapterTitle: z.string().nullable(),
    mergePreview: z.string(),
    score: z.number(),
  }),
) satisfies z.ZodType<LabDuplicatePair[]>

