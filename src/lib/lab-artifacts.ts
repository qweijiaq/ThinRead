import { bridge } from '../lib/bridge.js'
import type { LabArtifact, LabRequest } from '../../shared/types.js'

export interface LabArtifactMeta {
  request?: LabRequest
  bookId?: string
  page?: number
  sourceKey?: string
  label?: string
}

export async function loadLabArtifact(tool: string, scope = 'latest'): Promise<LabArtifact | null> {
  return bridge.getLabArtifact(tool, scope)
}

export async function listLabArtifacts(tool: string): Promise<LabArtifact[]> {
  return bridge.listLabArtifacts(tool, 40)
}

export async function saveLabArtifact(
  tool: string,
  title: string,
  content: string,
  meta: LabArtifactMeta,
  scope = 'latest',
): Promise<LabArtifact> {
  return bridge.saveLabArtifact({
    tool,
    scope,
    title,
    content,
    meta: JSON.stringify(meta),
  })
}

export function parseArtifactMeta(artifact: LabArtifact | null): LabArtifactMeta {
  if (!artifact?.meta) return {}
  try {
    const parsed = JSON.parse(artifact.meta) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as LabArtifactMeta) : {}
  } catch {
    return {}
  }
}
