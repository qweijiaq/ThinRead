import type { WebDavConfigInput } from '../shared/types.js'

export interface WebDavConfig {
  url: string
  username: string
  remotePath: string
  password: string
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:displayname/><d:getcontentlength/><d:getlastmodified/></d:prop>
</d:propfind>`

function authHeader(config: WebDavConfig): string {
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
}

export function webDavRoot(config: WebDavConfigInput | WebDavConfig): string {
  const url = config.url.trim().replace(/\/+$/, '')
  if (!url) throw new Error('还没有填写 WebDAV 地址。')
  const remotePath = (config.remotePath ?? 'ThinRead').trim().replace(/^\/+|\/+$/g, '')
  return `${url}/${remotePath.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
}

async function request(
  config: WebDavConfig,
  method: string,
  url: string,
  body?: string | Uint8Array,
  headers: Record<string, string> = {},
): Promise<Response> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(config),
      ...headers,
    },
    body: body as RequestInit['body'],
    signal: AbortSignal.timeout(45_000),
  })
  if (response.status === 401 || response.status === 403) {
    throw new Error('WebDAV 认证失败，请检查用户名和密码。')
  }
  return response
}

async function ensureCollection(config: WebDavConfig, url: string): Promise<void> {
  const parts = url.replace(/\/+$/, '').split('/')
  let cursor = ''
  for (const part of parts) {
    cursor = cursor ? `${cursor}/${part}` : part
    if (!/^https?:$/.test(cursor)) continue
    const response = await request(config, 'MKCOL', `${cursor}/`, undefined, {
      'Content-Type': 'application/xml',
    }).catch(() => null)
    if (response && response.status >= 400 && response.status !== 405) {
      // 目录已存在时很多服务器返回 405 或 409；其余错误继续尝试下一级。
    }
  }
}

export async function testWebDav(config: WebDavConfig): Promise<void> {
  if (!config.url.trim()) throw new Error('还没有填写 WebDAV 地址。')
  const response = await request(config, 'PROPFIND', `${webDavRoot(config)}/`, PROPFIND_BODY, {
    Depth: '0',
    'Content-Type': 'application/xml',
  })
  if (response.status === 404) {
    await ensureCollection(config, webDavRoot(config))
    return
  }
  if (!response.ok) throw new Error(`WebDAV 连接失败：HTTP ${response.status}`)
}

export async function ensureWebDavRoot(config: WebDavConfig): Promise<void> {
  await testWebDav(config)
}

export async function putWebDav(config: WebDavConfig, name: string, data: Buffer): Promise<void> {
  await ensureWebDavRoot(config)
  const response = await request(config, 'PUT', `${webDavRoot(config)}/${encodeURIComponent(name)}`, new Uint8Array(data), {
    'Content-Type': 'application/octet-stream',
  })
  if (!response.ok) throw new Error(`上传失败：HTTP ${response.status}`)
}

export async function getWebDav(config: WebDavConfig, name: string): Promise<Buffer> {
  const response = await request(config, 'GET', `${webDavRoot(config)}/${encodeURIComponent(name)}`)
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

export async function deleteWebDav(config: WebDavConfig, name: string): Promise<void> {
  const response = await request(config, 'DELETE', `${webDavRoot(config)}/${encodeURIComponent(name)}`)
  if (!response.ok && response.status !== 404) throw new Error(`删除失败：HTTP ${response.status}`)
}

export async function listWebDav(config: WebDavConfig): Promise<string[]> {
  await ensureWebDavRoot(config)
  const response = await request(config, 'PROPFIND', `${webDavRoot(config)}/`, PROPFIND_BODY, {
    Depth: '1',
    'Content-Type': 'application/xml',
  })
  if (!response.ok) throw new Error(`读取目录失败：HTTP ${response.status}`)
  const xml = await response.text()
  const names = [...xml.matchAll(/<[^>]*href[^>]*>([^<]+)</gi)]
    .map((match) => {
      try {
        const pathname = new URL(match[1]!, webDavRoot(config)).pathname
        return decodeURIComponent(pathname.replace(/\/+$/, '').split('/').pop() ?? '')
      } catch {
        return ''
      }
    })
    .filter((name) => name.startsWith('thinread-sync-') && (name.endsWith('.zip') || name.endsWith('.thinsync')))
  return [...new Set(names)].sort().reverse()
}
