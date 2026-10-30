import { useEffect, useState, type JSX } from 'react'
import type { LabExperiment } from '../../shared/types.js'

const STATUS_LABEL: Record<LabExperiment['status'], string> = {
  planned: '待开始',
  active: '进行中',
  done: '已完成',
}

export function LabExperiments(): JSX.Element {
  const [items, setItems] = useState<LabExperiment[]>([])
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(): Promise<void> {
    try {
      setItems(await window.api.listExperiments())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function create(): Promise<void> {
    if (!goal.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await window.api.createExperiment(goal.trim())
      setItems((current) => [created, ...current])
      setGoal('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function change(item: LabExperiment, status: LabExperiment['status']): Promise<void> {
    try {
      await window.api.updateExperimentStatus(item.id, status)
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status } : entry)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="lab-experiments">
      <div className="lab-experiment-form">
        <textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="想把书里的哪个方法拿去试一试？例如：把手机移出卧室，看看专注有没有变化。"
          rows={3}
        />
        <button type="button" className="primary-button small" onClick={() => void create()} disabled={!goal.trim() || busy}>
          {busy ? '设计中…' : '生成实验'}
        </button>
      </div>
      {error ? <div className="inline-error">{error}</div> : null}
      <div className="lab-experiment-list">
        {items.map((item) => (
          <article key={item.id} className={`lab-experiment-card ${item.status}`}>
            <div className="lab-experiment-head">
              <span className={`lab-experiment-status ${item.status}`}>{STATUS_LABEL[item.status]}</span>
              <span className="lab-experiment-duration">{item.duration}</span>
            </div>
            <h3>{item.title}</h3>
            <p className="lab-experiment-goal">目标：{item.goal}</p>
            <div className="lab-experiment-steps">
              {item.steps.split('\n').map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </div>
            <div className="lab-experiment-actions">
              <button type="button" className="text-button" onClick={() => void change(item, 'active')} disabled={item.status === 'active'}>
                开始
              </button>
              <button type="button" className="text-button" onClick={() => void change(item, 'done')} disabled={item.status === 'done'}>
                完成
              </button>
            </div>
          </article>
        ))}
        {items.length === 0 ? <p className="lab-empty">还没有实验。把一个想实践的方法写成目标，AI 会给出 3–7 天的计划。</p> : null}
      </div>
    </div>
  )
}
