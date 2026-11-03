/** 去掉 Electron IPC 包装前缀，只留下给用户看的错误信息。 */
export function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
