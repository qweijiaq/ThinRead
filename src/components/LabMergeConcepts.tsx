import { useEffect, useState, type JSX } from 'react'
import type { LabMergeGroup } from '../../shared/types.js'

export function LabMergeConcepts(): JSX.Element {
  const [groups, setGroups] = useState<LabMergeGroup[]>([])
  const [names, setNames] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)
  const [merging, setMerging] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.getLabArtifact('lab-merge').then((artifact) => {
      if (cancelled) return
      if (artifact) {
        try {
          const parsed = JSON.parse(artifact.content) as {
            groups?: LabMergeGroup[]
            names?: Record<number, string>
            done?: number | null
          }
          if (Array.isArray(parsed.groups)) setGroups(parsed.groups)
          if (parsed.names) setNames(parsed.names)
          if (parsed.done != null) setDone(parsed.done)
        } catch {
          // 忽略旧格式。
        }
      }
      setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    void window.api
      .saveLabArtifact({
        tool: 'lab-merge',
        scope: 'latest',
        title: '概念合并',
        content: JSON.stringify({ groups, names, done }),
      })
      .catch(() => undefined)
  }, [hydrated, groups, names, done])

  async function load(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.suggestConceptMerges()
      setGroups(result)
      setNames(Object.fromEntries(result.map((group, index) => [index, group.canonical])))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function merge(index: number): Promise<void> {
    const group = groups[index]
    const canonical = (names[index] ?? group?.canonical ?? '').trim()
    if (!group || !canonical) return
    setMerging(index)
    setError(null)
    try {
      const changed = await window.api.mergeNoteTags(group.tags, canonical)
      setGroups((current) => current.filter((_, itemIndex) => itemIndex !== index))
      setDone(changed)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMerging(null)
    }
  }

  return (
    <div className="lab-merge">
      <div className="lab-run-row">
        <span className="lab-run-hint">
          {done != null ? `已更新 ${done} 条笔记的标签。` : 'AI 只给建议，合并前可以改标准名。'}
        </span>
        <button type="button" className="ghost-button small" onClick={() => void load()} disabled={loading}>
          {loading ? '分析中…' : '重新分析'}
        </button>
        {loading ? (
          <button type="button" className="ghost-button small" onClick={() => void window.api.cancelLab()}>
            取消
          </button>
        ) : null}
      </div>
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      {loading && groups.length === 0 ? <p className="lab-empty">正在找近义标签…</p> : null}
      {!loading && groups.length === 0 ? <p className="lab-empty">没有发现需要合并的标签。</p> : null}
      <div className="lab-merge-list">
        {groups.map((group, index) => (
          <article key={`${group.canonical}-${index}`} className="lab-merge-card">
            <div className="lab-merge-tags">
              {group.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
              <span className="lab-merge-count">{group.noteCount} 条笔记</span>
            </div>
            <p>{group.reason}</p>
            <div className="lab-merge-action">
              <label>
                合并为标准名
                <input
                  value={names[index] ?? group.canonical}
                  onChange={(event) => setNames((current) => ({ ...current, [index]: event.target.value }))}
                />
              </label>
              <button type="button" className="primary-button small" onClick={() => void merge(index)} disabled={merging === index}>
                {merging === index ? '合并中…' : '合并'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
