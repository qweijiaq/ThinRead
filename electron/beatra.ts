import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { TtsAudio, TtsVoice } from '../shared/types.js'

const MCP_ENDPOINT = 'https://mcp.beatra.cn/mcp'
const PROTOCOL_VERSION = '2025-11-25'
const REQUEST_TIMEOUT_MS = 45_000
const SYNTH_TIMEOUT_MS = 90_000
const TASK_GET_TIMEOUT_MS = 30_000
const TASK_TIMEOUT_MS = 5 * 60_000

interface JsonRpcResponse {
  jsonrpc?: string
  id?: number
  result?: unknown
  error?: { message?: string; code?: number }
}

function parseSse(text: string): JsonRpcResponse | null {
  for (const chunk of text.split(/\n\n+/)) {
    const data = chunk
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('')
    if (!data) continue
    try {
      return JSON.parse(data) as JsonRpcResponse
    } catch {
      // 继续找下一个事件。
    }
  }
  return null
}

interface McpSession {
  token: string
  sessionId: string | null
  nextId: number
}

/**
 * MCP 可能用 SSE 长连接返回结果；response.text() 会一直等连接关闭，
 * 任务已经完成时反而被 AbortSignal 打断。这里读到首个完整消息就取消读取。
 */
async function readMcpResponse(response: Response, expectedId?: number): Promise<JsonRpcResponse | null> {
  if (!response.body) return null
  const contentType = response.headers.get('content-type') ?? ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let sseBuffer = ''
  const finish = async (value: JsonRpcResponse | null): Promise<JsonRpcResponse | null> => {
    await reader.cancel().catch(() => undefined)
    return value
  }
  while (true) {
    let chunk: { done: boolean; value?: Uint8Array }
    try {
      chunk = await reader.read()
    } catch {
      break
    }
    if (chunk.value) {
      const part = decoder.decode(chunk.value, { stream: true })
      text += part
      if (/text\/event-stream/i.test(contentType)) {
        sseBuffer += part
        const events = sseBuffer.split(/\n\n+/)
        sseBuffer = events.pop() ?? ''
        for (const event of events) {
          const data = event
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('')
          if (!data) continue
          try {
            const parsed = JSON.parse(data) as JsonRpcResponse
            if (expectedId === undefined || parsed.id === expectedId) return await finish(parsed)
          } catch {
            // 该事件不是 JSON，继续读下一个事件。
          }
        }
      } else {
        try {
          const parsed = JSON.parse(text) as JsonRpcResponse
          if (expectedId === undefined || parsed.id === expectedId) return await finish(parsed)
        } catch {
          // JSON 还没收完整，继续读。
        }
      }
    }
    if (chunk.done) break
  }
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as JsonRpcResponse
  } catch {
    return parseSse(text)
  }
}

async function fetchMcpOnce(headers: Record<string, string>, body: string, timeoutMs: number): Promise<Response> {
  const attempts: Array<() => Promise<Response>> = []
  try {
    const { net } = await import('electron')
    if (typeof net?.fetch === 'function') {
      attempts.push(() => net.fetch(MCP_ENDPOINT, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) }))
    }
  } catch {
    // 测试环境或非 Electron 环境退回 Node fetch。
  }
  attempts.push(() =>
    fetch(MCP_ENDPOINT, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) }),
  )
  let lastError: unknown = null
  for (const attempt of attempts) {
    try {
      return await attempt()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function postMcp(
  session: McpSession,
  payload: Record<string, unknown>,
  operation: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
  retries = 0,
): Promise<{ body: JsonRpcResponse | null }> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.token.trim()}`,
    'MCP-Protocol-Version': PROTOCOL_VERSION,
    'User-Agent': 'ThinRead/Electron',
  }
  if (session.sessionId) headers['MCP-Session-Id'] = session.sessionId
  const body = JSON.stringify(payload)
  let lastError: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response: Response
    try {
      response = await fetchMcpOnce(headers, body, timeoutMs)
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
        continue
      }
      break
    }
    if (response.status === 401) throw new Error('Beatra 授权已失效，请重新配置 Device Token。')
    if (!response.ok) {
      lastError = new Error(`HTTP ${response.status}`)
      if ((response.status >= 500 || response.status === 429) && attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
        continue
      }
      break
    }
    const nextSession = response.headers.get('mcp-session-id')
    if (nextSession) session.sessionId = nextSession
    let result: JsonRpcResponse | null
    try {
      result = await readMcpResponse(response, typeof payload.id === 'number' ? payload.id : undefined)
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
        continue
      }
      break
    }
    if (!result) return { body: null }
    if (result.jsonrpc !== '2.0' && result.id === undefined && !result.error) {
      lastError = new Error('返回了无法解析的 MCP 响应')
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
        continue
      }
      break
    }
    if (result.error) throw new Error(`Beatra：${result.error.message ?? '未知错误'}`)
    return { body: result }
  }
  const detail =
    lastError instanceof Error
      ? lastError.message
      : String(lastError ?? '未知网络错误')
  throw new Error(`Beatra ${operation}失败：${detail}`)
}

async function openSession(token: string): Promise<McpSession> {
  const session: McpSession = { token, sessionId: null, nextId: 1 }
  await postMcp(
    session,
    {
      jsonrpc: '2.0',
      id: session.nextId++,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'thinread', version: '1.0.0' },
      },
    },
    '初始化连接',
    REQUEST_TIMEOUT_MS,
    1,
  )
  await postMcp(
    session,
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    '初始化连接',
  )
  return session
}

async function callTool(
  session: McpSession,
  name: string,
  args: Record<string, unknown>,
  timeoutMs = REQUEST_TIMEOUT_MS,
  retries = 0,
): Promise<unknown> {
  const response = await postMcp(
    session,
    {
      jsonrpc: '2.0',
      id: session.nextId++,
      method: 'tools/call',
      params: {
        name,
        arguments: {
          ...args,
          source_package_slug: 'thinread',
          source_platform: 'electron',
        },
      },
    },
    name,
    timeoutMs,
    retries,
  )
  return response.body?.result ?? null
}

function parseTextJson(text: unknown): unknown {
  if (typeof text !== 'string') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function structuredResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result
  const value = result as Record<string, unknown>
  if (value.structuredContent !== undefined) return value.structuredContent
  if (Array.isArray(value.content)) {
    for (const item of value.content) {
      if (item && typeof item === 'object' && (item as { type?: unknown }).type === 'text') {
        const parsed = parseTextJson((item as { text?: unknown }).text)
        if (parsed !== null) return parsed
      }
    }
  }
  return result
}

function findArrayOfRecords(value: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 6 || !value) return []
  if (Array.isArray(value)) {
    const records = value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    if (records.some((item) => typeof item.id === 'string' || typeof item.voice_id === 'string')) return records
    for (const item of value) {
      const found = findArrayOfRecords(item, depth + 1)
      if (found.length > 0) return found
    }
    return []
  }
  if (typeof value !== 'object') return []
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findArrayOfRecords(child, depth + 1)
    if (found.length > 0) return found
  }
  return []
}

export function readLocalBeatraCredential(): string | null {
  try {
    const file = path.join(os.homedir(), '.beatra', 'credentials.json')
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      access_token?: unknown
      token_type?: unknown
      mcp_url?: unknown
    }
    return value.token_type === 'Bearer' && typeof value.access_token === 'string' && value.access_token
      ? value.access_token
      : null
  } catch {
    return null
  }
}

export async function listBeatraVoices(token: string): Promise<TtsVoice[]> {
  if (!token.trim()) throw new Error('还没有配置 Beatra Device Token。')
  const session = await openSession(token)
  const result = await callTool(session, 'beatra.voices.list', {}, REQUEST_TIMEOUT_MS, 1)
  const records = findArrayOfRecords(structuredResult(result))
  return records
    .map((item): TtsVoice | null => {
      const id = typeof item.id === 'string' ? item.id : typeof item.voice_id === 'string' ? item.voice_id : ''
      if (!id) return null
      const label =
        (typeof item.display_name === 'string' && item.display_name) ||
        (typeof item.name === 'string' && item.name) ||
        id
      const language =
        (typeof item.language === 'string' && item.language) ||
        (typeof item.locale === 'string' && item.locale) ||
        'zh-CN'
      const gender = item.gender === 'female' || item.gender === 'male' ? item.gender : 'unknown'
      return { id, label, language, gender }
    })
    .filter((item): item is TtsVoice => Boolean(item))
}

function findTaskId(value: unknown, depth = 0): string | null {
  if (depth > 6 || !value || typeof value !== 'object') return null
  const object = value as Record<string, unknown>
  for (const key of ['task_id', 'taskId']) {
    if (typeof object[key] === 'string' && object[key]) return object[key] as string
  }
  if (object.task && typeof object.task === 'object') {
    const task = object.task as Record<string, unknown>
    if (typeof task.task_id === 'string' && task.task_id) return task.task_id
    if (typeof task.id === 'string' && task.id) return task.id
    const nested = findTaskId(object.task, depth + 1)
    if (nested) return nested
  }
  for (const child of Object.values(object)) {
    const nested = findTaskId(child, depth + 1)
    if (nested) return nested
  }
  return null
}

function findAudioUrl(value: unknown, depth = 0): string | null {
  if (depth > 8 || !value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAudioUrl(item, depth + 1)
      if (found) return found
    }
    return null
  }
  const object = value as Record<string, unknown>
  const mime = typeof object.mime_type === 'string' ? object.mime_type : typeof object.mime === 'string' ? object.mime : ''
  for (const key of ['download_url', 'artifact_url', 'audio_url', 'url']) {
    const candidate = object[key]
    if (typeof candidate === 'string' && /^https?:\/\//.test(candidate) && (!mime || mime.startsWith('audio/'))) {
      return candidate
    }
  }
  for (const child of Object.values(object)) {
    const found = findAudioUrl(child, depth + 1)
    if (found) return found
  }
  return null
}

function findStatus(value: unknown, depth = 0): string {
  if (depth > 5 || !value || typeof value !== 'object') return ''
  const object = value as Record<string, unknown>
  if (typeof object.status === 'string') return object.status
  for (const child of Object.values(object)) {
    const status = findStatus(child, depth + 1)
    if (status) return status
  }
  return ''
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : ''
    return `${error.message}${cause}`
  }
  return String(error)
}

export interface DownloadedAudio {
  data: Buffer
  mime: string
}

export async function downloadAudio(url: string, token: string): Promise<DownloadedAudio> {
  const headers = {
    Authorization: `Bearer ${token.trim()}`,
    'User-Agent': 'ThinRead/Electron',
  }
  const attempts: Array<{ label: string; run(signal: AbortSignal): Promise<Response> }> = [
    { label: 'Node fetch（授权）', run: (signal) => fetch(url, { headers, signal }) },
  ]
  try {
    const { net } = await import('electron')
    if (typeof net?.fetch === 'function') {
      // 部分网络下 Node 的 TLS 握手会卡住，Electron 的 Chromium 网络栈能继承系统代理。
      // CDN 对带 Authorization 的请求偶尔会提前断开，因此这里先不带授权。
      attempts.push({ label: 'Electron 网络栈', run: (signal) => net.fetch(url, { signal }) })
    }
  } catch {
    // 测试环境或非 Electron 环境没有 net.fetch。
  }
  attempts.push({ label: 'Node fetch', run: (signal) => fetch(url, { signal }) })

  let lastError: unknown = null
  for (const [index, attempt] of attempts.entries()) {
    // CDN 实测 49KB 可能要 20 秒；超时必须覆盖到响应体读完，不能只覆盖响应头。
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('下载超时')), 90_000)
    try {
      const response = await attempt.run(controller.signal)
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        lastError = new Error(`HTTP ${response.status}`)
      } else {
        const mime = (response.headers.get('content-type') ?? '').split(';')[0] || 'audio/mpeg'
        if (!mime.startsWith('audio/')) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error('返回的不是音频文件')
        }
        const data = Buffer.from(await response.arrayBuffer())
        if (data.length === 0) throw new Error('返回了空音频')
        return { data, mime }
      }
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timer)
    }
    if (index < attempts.length - 1) await new Promise((resolve) => setTimeout(resolve, 500 + index * 500))
  }
  throw new Error(`Beatra 音频下载失败：${describeError(lastError)}`)
}

async function synthesizeBeatraOnce(
  token: string,
  text: string,
  voice: string,
  rate: number,
  setStage: (stage: string) => void,
): Promise<TtsAudio> {
  setStage('连接 Beatra')
  let session = await openSession(token)
  setStage('提交配音任务')
  const created = await callTool(
    session,
    'beatra.speech.synthesize',
    {
      voice,
      input: text,
      client_request_id: crypto.randomUUID(),
      model: 'auto',
      language: 'zh-CN',
      format: 'mp3',
      speed: Math.min(2, Math.max(0.5, rate || 1)),
      volume: 1,
      pitch: 0,
    },
    SYNTH_TIMEOUT_MS,
    0,
  )
  const structured = structuredResult(created)
  const taskId = findTaskId(structured)
  let artifactUrl = findAudioUrl(structured)
  let final = structured

  if (taskId) {
    setStage('等待配音任务完成')
    const deadline = Date.now() + TASK_TIMEOUT_MS
    let delay = 2_000
    let pollError: unknown = null
    while (!artifactUrl && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(15_000, Math.round(delay * 1.5))
      try {
        const result = await callTool(session, 'beatra.tasks.get', { task_id: taskId }, TASK_GET_TIMEOUT_MS, 1)
        final = structuredResult(result)
        const status = findStatus(final)
        if (status === 'failed' || status === 'canceled') {
          throw new Error(`Beatra 配音任务${status === 'canceled' ? '已取消' : '失败'}。`)
        }
        artifactUrl = findAudioUrl(final)
        pollError = null
      } catch (error) {
        // 读任务可以安全重试；网络短暂抖动不应该把已经成功的配音判死。
        pollError = error
        try {
          session = await openSession(token)
        } catch {
          // 下一轮继续用旧 session 重试。
        }
      }
    }
    if (!artifactUrl && pollError) {
      throw new Error(`Beatra 任务已创建，但读取结果失败：${describeError(pollError)}`)
    }
  }
  if (!artifactUrl) throw new Error('Beatra 没有返回可播放的音频。')
  setStage('下载配音音频')
  const { data, mime } = await downloadAudio(artifactUrl, token)
  return { mime, base64: data.toString('base64') }
}

export async function synthesizeBeatra(
  token: string,
  text: string,
  voice: string,
  rate: number,
): Promise<TtsAudio> {
  if (!token.trim()) throw new Error('请先在设置里配置 Beatra Device Token。')
  if (!voice) throw new Error('请先选择 Beatra 音色。')
  let stage = '准备配音'
  try {
    return await synthesizeBeatraOnce(token, text, voice, rate, (next) => {
      stage = next
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Beatra')) throw error
    throw new Error(`Beatra 配音失败（${stage}）：${describeError(error)}`)
  }
}

export async function testBeatra(token: string): Promise<{ ok: boolean; message: string }> {
  try {
    const voices = await listBeatraVoices(token)
    return {
      ok: true,
      message: voices.length > 0 ? `Beatra 连接成功，可用音色 ${voices.length} 个。` : 'Beatra 连接成功，但没有可用音色。',
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
