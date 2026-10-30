import { useEffect, useState, type JSX } from 'react'
import type { LabDuplicatePair } from '../../shared/types.js'

export function LabDuplicateCards(): JSX.Element {
  const [pairs, setPairs] = useState<LabDuplicatePair[]>([])
  const [loading, setLoading] = useState(true)
  const [merging, setMerging] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number>(0)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.getLabArtifact('lab-dedupe').then((artifact) => {
      if (cancelled) return
      if (artifact) {
        try {
          const parsed = JSON.parse(artifact.content) as { pairs?: LabDuplicatePair[]; done?: number }
          if (Array.isArray(parsed.pairs)) setPairs(parsed.pairs)
          if (typeof parsed.done === 'number') setDone(parsed.done)
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
        tool: 'lab-dedupe',
        scope: 'latest',
        title: '卡片去重',
        content: JSON.stringify({ pairs, done }),
      })
      .catch(() => undefined)
  }, [hydrated, pairs, done])

  async function load(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      setPairs(await window.api.findDuplicateNotes())
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
    const pair = pairs[index]
    if (!pair) return
    setMerging(index)
    setError(null)
    try {
      await window.api.mergeNotes(pair.keepId, pair.mergeId)
      setPairs((current) => current.filter((_, itemIndex) => itemIndex !== index))
      setDone((value) => value + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMerging(null)
    }
  }

  return (
    <div className="lab-dedupe">
      <div className="lab-run-row">
        <span className="lab-run-hint">
          {done > 0 ? `已合并 ${done} 组卡片。` : '只合并同一本书里的相似卡片；合并后保留左边这张。'}
        </span>
        <button type="button" className="ghost-button small" onClick={() => void load()} disabled={loading}>
          {loading ? '扫描中…' : '重新扫描'}
        </button>
      </div>
      {error ? <div className="inline-error">{error}</div> : null}
      {loading && pairs.length === 0 ? <p className="lab-empty">正在扫描相似卡片…</p> : null}
      {!loading && pairs.length === 0 ? <p className="lab-empty">没有发现足够相似的卡片。</p> : null}
      <div className="lab-dedupe-list">
        {pairs.map((pair, index) => (
          <article key={`${pair.keepId}:${pair.mergeId}`} className="lab-dedupe-card">
            <div className="lab-dedupe-score">相似度 {Math.round(pair.score * 100)}%</div>
            <div className="lab-dedupe-pair">
              <div>
                <span>保留</span>
                <strong>{pair.keepTitle}</strong>
                <em>
                  {pair.keepBookTitle}
                  {pair.keepChapterTitle ? ` · ${pair.keepChapterTitle}` : ''}
                </em>
              </div>
              <span className="lab-dedupe-arrow">+</span>
              <div>
                <span>并入</span>
                <strong>{pair.mergeTitle}</strong>
                <em>
                  {pair.mergeBookTitle}
                  {pair.mergeChapterTitle ? ` · ${pair.mergeChapterTitle}` : ''}
                </em>
              </div>
            </div>
            <button type="button" className="primary-button small" onClick={() => void merge(index)} disabled={merging === index}>
              {merging === index ? '合并中…' : '合并到左边'}
            </button>
          </article>
        ))}
      </div>
    </div>
  )
}
