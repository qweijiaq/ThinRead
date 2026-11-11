import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { NewChapter } from '../db.js'
import { htmlToText } from '../html.js'

export interface DoclingStatus {
  available: boolean
  version?: string
  python?: string
  error?: string
}

export interface DoclingChapterStart {
  page: number
  title: string
}

export interface DoclingProgress {
  phase: 'initialize' | 'build' | 'assemble' | 'enrich' | 'pages' | 'done'
  done?: number
  total?: number
}

export interface DoclingParseResult {
  title: string
  author: string
  chapters: NewChapter[]
  pageCount: number
}

const statusCache = new Map<string, Promise<DoclingStatus>>()
const STATUS_TIMEOUT_MS = 20_000
const PARSE_TIMEOUT_MS = 30 * 60 * 1000

function candidatePythons(dataDir: string): string[] {
  return [
    process.env.THINREAD_DOCLING_PYTHON ?? '',
    path.join(dataDir, 'docling-venv', 'bin', 'python'),
    path.join(os.homedir(), 'Library', 'Application Support', 'reading-notes', 'docling-venv', 'bin', 'python'),
    '/opt/homebrew/bin/python3.12',
    '/usr/local/bin/python3.12',
    'python3.12',
    'python3',
  ].filter(Boolean)
}

function findDoclingScript(): string | null {
  const resources = (process as unknown as { resourcesPath?: string }).resourcesPath
  const candidates = [
    ...(resources ? [path.join(resources, 'scripts', 'docling-parse.py')] : []),
    path.join(process.cwd(), 'scripts', 'docling-parse.py'),
    path.join(__dirname, '..', 'scripts', 'docling-parse.py'),
    path.join(__dirname, '..', '..', 'scripts', 'docling-parse.py'),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

async function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  onLine?: (line: string) => void,
  env?: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env })
    let settled = false
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      resolve({ code, stdout, stderr })
    }
    let stdout = ''
    let stderr = ''
    let lineBuffer = ''
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      if (!onLine) return
      lineBuffer += text
      let index = lineBuffer.indexOf('\n')
      while (index >= 0) {
        const line = lineBuffer.slice(0, index).trim()
        lineBuffer = lineBuffer.slice(index + 1)
        if (line) onLine(line)
        index = lineBuffer.indexOf('\n')
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const timer = setTimeout(() => {
      child.kill()
      stderr += '\n解析超时'
      finish(-1)
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      stderr += `\n${error.message}`
      finish(-1)
    })
    // Docling 可能留下持有 stdout 管道的子进程；exit 比 close 更适合判断主进程结束。
    child.on('exit', (code) => {
      setTimeout(() => {
        clearTimeout(timer)
        finish(code ?? -1)
      }, 300)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish(code ?? -1)
    })
  })
}

async function detectDocling(dataDir: string): Promise<DoclingStatus> {
  const script = findDoclingScript()
  if (!script) return { available: false, error: '找不到 Docling 解析脚本。' }
  for (const python of candidatePythons(dataDir)) {
    const exists = python.includes(path.sep) ? fs.existsSync(python) : true
    if (!exists) continue
    const result = await runProcess(
      python,
      ['-c', 'import docling; print(getattr(docling, "__version__", ""))'],
      STATUS_TIMEOUT_MS,
    )
    if (result.code === 0) {
      return { available: true, version: result.stdout.trim() || undefined, python }
    }
  }
  return {
    available: false,
    error: '没有找到可用的 Docling。需要 Python 3.10+ 和 `pip install docling`。',
  }
}

/** 检测 Docling 是否可用；结果按数据目录缓存，避免每次打开导入框都启动 Python。 */
export function getDoclingStatus(dataDir: string): Promise<DoclingStatus> {
  const key = path.resolve(dataDir)
  const cached = statusCache.get(key)
  if (cached) return cached
  const next = detectDocling(dataDir).catch((error: unknown) => ({
    available: false,
    error: error instanceof Error ? error.message : String(error),
  }))
  statusCache.set(key, next)
  return next
}

export function clearDoclingStatusCache(): void {
  statusCache.clear()
}

function doclingEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  const cache = process.env.HF_HOME
    ? path.join(process.env.HF_HOME, 'hub')
    : path.join(os.homedir(), '.cache', 'huggingface', 'hub')
  const cached =
    fs.existsSync(path.join(cache, 'models--docling-project--docling-models')) &&
    fs.existsSync(path.join(cache, 'models--docling-project--docling-layout-heron'))
  if (cached) {
    // 模型已经缓存后不要再联网检查，否则 HuggingFace 超时会把解析卡住几分钟。
    env.HF_HUB_OFFLINE = '1'
  } else if (!env.HF_ENDPOINT) {
    env.HF_ENDPOINT = 'https://hf-mirror.com'
  }
  return env
}

export async function parsePdfWithDocling(args: {
  sourcePath: string
  dataDir: string
  outline?: DoclingChapterStart[]
  title?: string
  author?: string
  onProgress?: (progress: DoclingProgress) => void
}): Promise<DoclingParseResult> {
  const status = await getDoclingStatus(args.dataDir)
  if (!status.available || !status.python) {
    throw new Error(
      status.error ??
        'Docling 深度解析还没有安装。需要 Python 3.10+，然后在终端运行 `pip install docling`。',
    )
  }
  const script = findDoclingScript()
  if (!script) throw new Error('找不到 Docling 解析脚本。')

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'thinread-docling-'))
  const outputPath = path.join(tempDir, 'result.json')
  const outlinePath = path.join(tempDir, 'outline.json')
  try {
    if (args.outline && args.outline.length > 0) {
      await fsp.writeFile(outlinePath, JSON.stringify(args.outline), 'utf8')
    }
    const commandArgs = [
      script,
      args.sourcePath,
      outputPath,
      '--title',
      args.title ?? '',
      '--author',
      args.author ?? '',
    ]
    if (args.outline && args.outline.length > 0) {
      commandArgs.push('--outline', outlinePath)
    }
    const result = await runProcess(status.python, commandArgs, PARSE_TIMEOUT_MS, (line) => {
      try {
        const event = JSON.parse(line) as { type?: unknown; phase?: unknown; done?: unknown; total?: unknown }
        if (event.type === 'phase' && typeof event.phase === 'string') {
          args.onProgress?.({ phase: event.phase as DoclingProgress['phase'] })
        } else if (event.type === 'pages') {
          args.onProgress?.({
            phase: 'pages',
            done: Number(event.done) || 0,
            total: Number(event.total) || 0,
          })
        }
      } catch {
        // Ignore non-progress stdout lines.
      }
    }, doclingEnvironment())
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim().slice(-1200)
      throw new Error(`Docling 深度解析失败${detail ? `：${detail}` : '。'}`)
    }
    const parsed = JSON.parse(await fsp.readFile(outputPath, 'utf8')) as {
      title?: unknown
      author?: unknown
      pageCount?: unknown
      chapters?: unknown
    }
    if (!Array.isArray(parsed.chapters)) throw new Error('Docling 返回结果格式异常。')
    const chapters: NewChapter[] = []
    for (const item of parsed.chapters) {
      if (!item || typeof item !== 'object') continue
      const chapter = item as { title?: unknown; html?: unknown }
      const title = typeof chapter.title === 'string' ? chapter.title.trim() : ''
      const html = typeof chapter.html === 'string' ? chapter.html : ''
      if (!html.trim()) continue
      chapters.push({ title: title || '未命名章节', text: htmlToText(html), html })
    }
    if (chapters.length === 0) throw new Error('Docling 没有解析出可读章节。')
    return {
      title:
        (typeof parsed.title === 'string' && parsed.title.trim()) ||
        args.title ||
        path.basename(args.sourcePath, path.extname(args.sourcePath)),
      author: (typeof parsed.author === 'string' && parsed.author) || args.author || '',
      chapters,
      pageCount: typeof parsed.pageCount === 'number' ? parsed.pageCount : 0,
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
