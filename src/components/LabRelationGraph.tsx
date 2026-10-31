import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'

import type { RelationEdge, RelationGraph, RelationNode } from '../../shared/types.js'

interface LabRelationGraphProps {
  bookId: string
  bookTitle: string
}

interface SimNode extends RelationNode, SimulationNodeDatum {
  radius: number
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  edge: RelationEdge
}

const NODE_RADIUS: Record<RelationNode['kind'], number> = {
  person: 28,
  organization: 24,
  place: 21,
  event: 22,
  concept: 20,
}

const ROLE_LABEL: Record<RelationNode['role'], string> = {
  detective: '侦探',
  killer: '凶手',
  victim: '被害人',
  witness: '关键证人',
  suspect: '嫌疑人',
  protagonist: '主角',
  supporting: '配角',
  other: '其他',
}

function radiusFor(node: RelationNode): number {
  const base = NODE_RADIUS[node.kind] ?? 20
  const roleBonus = node.kind === 'person' && (node.role === 'detective' || node.role === 'killer')
    ? 8
    : node.kind === 'person' && (node.role === 'victim' || node.role === 'witness')
      ? 5
      : 0
  return base + roleBonus + (node.kind === 'person' && node.importance >= 4 ? 2 : 0)
}

const NODE_LABEL: Record<RelationNode['kind'], string> = {
  person: '人物',
  organization: '组织',
  place: '地点',
  event: '事件',
  concept: '概念',
}

function edgeKey(edge: RelationEdge): string {
  return `${edge.source}:${edge.target}:${edge.label}`
}

export function LabRelationGraph({ bookId, bookTitle }: LabRelationGraphProps): JSX.Element {
  const [graph, setGraph] = useState<RelationGraph | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [layoutKey, setLayoutKey] = useState(0)
  const [nodes, setNodes] = useState<SimNode[]>([])
  const [links, setLinks] = useState<SimLink[]>([])
  const [fullscreen, setFullscreen] = useState(false)
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const [drag, setDrag] = useState<{ pointerId: number; startX: number; startY: number; ox: number; oy: number } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const simulationRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null)

  useEffect(() => {
    let cancelled = false
    setGraph(null)
    setNodes([])
    setLinks([])
    setSelectedId(null)
    setTransform({ x: 0, y: 0, k: 1 })
    setError(null)
    if (!bookId) return
    void window.api.getLabArtifact('relation-graph', `book:${bookId}`).then((artifact) => {
      if (cancelled || !artifact) return
      try {
        const parsed = JSON.parse(artifact.content) as RelationGraph
        if (Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
          setGraph(parsed)
          setSelectedId(parsed.nodes[0]?.id ?? null)
        }
      } catch {
        // 旧格式不是关系图，忽略。
      }
    })
    return () => {
      cancelled = true
    }
  }, [bookId])

  useEffect(() => {
    if (!fullscreen) return
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fullscreen])

  useEffect(() => {
    if (!graph) return
    const simNodes: SimNode[] = graph.nodes.map((node, index) => ({
      ...node,
      radius: radiusFor(node),
      x: 600 + Math.cos((index / Math.max(1, graph.nodes.length)) * Math.PI * 2) * 180,
      y: 380 + Math.sin((index / Math.max(1, graph.nodes.length)) * Math.PI * 2) * 160,
    }))
    const simLinks: SimLink[] = graph.edges
      .filter((edge) => simNodes.some((node) => node.id === edge.source) && simNodes.some((node) => node.id === edge.target))
      .map((edge) => ({ source: edge.source, target: edge.target, edge }))
    const simulation = forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinks)
          .id((node) => node.id)
          .distance(190)
          .strength(0.35),
      )
      .force('charge', forceManyBody<SimNode>().strength(-480))
      .force('center', forceCenter(600, 380))
      .force('collide', forceCollide<SimNode>().radius((node) => node.radius + 18))
      .stop()
    for (let tick = 0; tick < 220; tick++) simulation.tick()
    simulationRef.current = simulation
    setNodes([...simNodes])
    setLinks([...simLinks])
    return () => {
      simulation.stop()
    }
  }, [graph, layoutKey])

  const selected = useMemo(() => graph?.nodes.find((node) => node.id === selectedId) ?? null, [graph, selectedId])
  const selectedRelations = useMemo(() => {
    if (!graph || !selectedId) return []
    return graph.edges
      .filter((edge) => edge.source === selectedId || edge.target === selectedId)
      .map((edge) => {
        const outgoing = edge.source === selectedId
        return {
          edge,
          label: outgoing ? edge.label : edge.reverseLabel || edge.label,
          other: graph.nodes.find((node) => node.id === (outgoing ? edge.target : edge.source)),
        }
      })
  }, [graph, selectedId])

  function svgPoint(event: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return {
      x: (event.clientX - rect.left) * (1200 / rect.width),
      y: (event.clientY - rect.top) * (760 / rect.height),
    }
  }

  function zoomBy(factor: number, center?: { x: number; y: number }): void {
    setTransform((current) => {
      const k = Math.min(2.6, Math.max(0.45, current.k * factor))
      const point = center ?? { x: 600, y: 380 }
      const ratio = k / current.k
      return {
        k,
        x: point.x - (point.x - current.x) * ratio,
        y: point.y - (point.y - current.y) * ratio,
      }
    })
  }

  async function exportGraph(): Promise<void> {
    if (!graph) return
    setError(null)
    const byId = new Map(graph.nodes.map((node) => [node.id, node]))
    const kindLabel: Record<RelationNode['kind'], string> = {
      person: '人物',
      organization: '组织',
      place: '地点',
      event: '事件',
      concept: '概念',
    }
    const markdown = [
      `# ${graph.title}`,
      graph.genre ? `体裁：${graph.genre}` : '',
      graph.summary ? `\n${graph.summary}` : '',
      graph.plot ? `\n## 情节梗概（含剧透）\n\n${graph.plot}` : '',
      '\n## 节点\n',
      ...graph.nodes.map((node) => {
        const facts = [node.identity, node.rank, node.affiliation].filter(Boolean).join(' / ')
        const chapters = node.chapters?.length ? ` · 出处：${node.chapters.join('、')}` : ''
        return `- **${node.label}**（${kindLabel[node.kind]}${node.role !== 'other' ? ` · ${node.role}` : ''}${facts ? ` · ${facts}` : ''}）${node.description ? `：${node.description}` : ''}${chapters}`
      }),
      '\n## 关系\n',
      ...graph.edges.map((edge) => {
        const source = byId.get(edge.source)?.label ?? edge.source
        const target = byId.get(edge.target)?.label ?? edge.target
        const chapters = edge.chapters?.length ? `（出处：${edge.chapters.join('、')}）` : ''
        return `- ${source} — ${edge.label} — ${target}${edge.description ? `：${edge.description}` : ''}${chapters}`
      }),
    ]
      .filter(Boolean)
      .join('\n')
    try {
      const filename = `${graph.title.replace(/[\\/:*?"<>|#%{}]/g, ' ').replace(/\s+/g, ' ').trim() || '关系图'}.md`
      await window.api.saveMarkdown(filename, markdown)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function generate(): Promise<void> {
    if (!bookId || busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.api.generateRelationGraph(bookId)
      setGraph(next)
      setSelectedId(next.nodes[0]?.id ?? null)
      setTransform({ x: 0, y: 0, k: 1 })
      setLayoutKey((value) => value + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!bookId) return <p className="lab-empty">先选择一本书。</p>

  return (
    <div className={`relation-view${fullscreen ? ' is-fullscreen' : ''}`}>
      <div className="relation-head">
        <div>
          <h2>人物关系图</h2>
          <p>{bookTitle ? `《${bookTitle}》 · ` : ''}按书里的人物、组织和事件抽取关系。</p>
        </div>
        <div className="relation-head-actions">
          {graph ? (
            <>
              <button type="button" className="ghost-button small" onClick={() => void exportGraph()}>
                导出
              </button>
              <button type="button" className="ghost-button small" onClick={() => setFullscreen((value) => !value)}>
                {fullscreen ? '退出全屏' : '全屏'}
              </button>
            </>
          ) : null}
          <button type="button" className="primary-button small" onClick={() => void generate()} disabled={busy}>
            {busy ? '抽取中…' : graph ? '重新生成' : '生成关系图'}
          </button>
        </div>
      </div>

      {error ? <div className="inline-error">{error}</div> : null}

      {graph ? (
        <>
          <div className="relation-meta">
            <span className="relation-genre">{graph.genre}</span>
            <strong>{graph.title}</strong>
            <span>{graph.nodes.length} 个节点 · {graph.edges.length} 条关系</span>
            <button
              type="button"
              className="text-button"
              onClick={() => setLayoutKey((value) => value + 1)}
            >
              重新布局
            </button>
          </div>
          {graph.summary ? <p className="relation-summary">{graph.summary}</p> : null}
          {graph.plot ? (
            <details className="relation-plot-details">
              <summary>情节梗概（含剧透）</summary>
              <p className="relation-plot">{graph.plot}</p>
            </details>
          ) : null}
          <div className="relation-key-roles">
            {(['detective', 'killer', 'victim', 'witness'] as const).map((role) => {
              const people = graph.nodes.filter((node) => node.kind === 'person' && node.role === role)
              if (people.length === 0) return null
              return (
                <span key={role} className={`role-chip role-${role}`}>
                  {ROLE_LABEL[role]}：{people.map((node) => node.label).join('、')}
                </span>
              )
            })}
          </div>

          <div className="relation-body">
            <div className="relation-canvas">
              <div className="relation-canvas-tools">
                <button type="button" onClick={() => zoomBy(1.18)} aria-label="放大">＋</button>
                <button type="button" onClick={() => zoomBy(0.85)} aria-label="缩小">−</button>
                <button type="button" onClick={() => setTransform({ x: 0, y: 0, k: 1 })} aria-label="重置视图">重置</button>
                <span>{Math.round(transform.k * 100)}%</span>
              </div>
              <svg
                ref={svgRef}
                viewBox="0 0 1200 760"
                role="img"
                aria-label="人物关系图"
                className={drag ? 'is-dragging' : ''}
                onPointerDown={(event) => {
                  if ((event.target as Element).closest('.relation-node')) return
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setDrag({
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    ox: transform.x,
                    oy: transform.y,
                  })
                }}
                onPointerMove={(event) => {
                  if (!drag || drag.pointerId !== event.pointerId) return
                  const svg = svgRef.current
                  if (!svg) return
                  const rect = svg.getBoundingClientRect()
                  setTransform((current) => ({
                    ...current,
                    x: drag.ox + ((event.clientX - drag.startX) * 1200) / rect.width,
                    y: drag.oy + ((event.clientY - drag.startY) * 760) / rect.height,
                  }))
                }}
                onPointerUp={(event) => {
                  if (drag?.pointerId === event.pointerId) setDrag(null)
                }}
                onPointerCancel={() => setDrag(null)}
                onWheel={(event) => {
                  event.preventDefault()
                  const point = svgPoint(event)
                  zoomBy(event.deltaY < 0 ? 1.12 : 0.89, point ?? undefined)
                }}
              >
                <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
                <g className="relation-edges">
                  {links.map((link) => {
                    const source = link.source as SimNode
                    const target = link.target as SimNode
                    const active = !selectedId || link.edge.source === selectedId || link.edge.target === selectedId
                    return (
                      <g key={edgeKey(link.edge)} className={`relation-edge kind-${link.edge.kind}${active ? ' is-active' : ''}`}>
                        <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} />
                        <title>{`${source.label} — ${link.edge.label} — ${target.label}${link.edge.description ? `：${link.edge.description}` : ''}`}</title>
                        <text x={((source.x ?? 0) + (target.x ?? 0)) / 2} y={((source.y ?? 0) + (target.y ?? 0)) / 2 - 6}>
                          {selectedId && link.edge.target === selectedId ? link.edge.reverseLabel : link.edge.label}
                        </text>
                      </g>
                    )
                  })}
                </g>
                <g className="relation-nodes">
                  {nodes.map((node) => {
                    const active = !selectedId || node.id === selectedId || selectedRelations.some((item) => item.other?.id === node.id)
                    return (
                      <g
                        key={node.id}
                        className={`relation-node kind-${node.kind} role-${node.role}${node.id === selectedId ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
                        onClick={() => setSelectedId(node.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelectedId(node.id)
                          }
                        }}
                      >
                        <circle cx={node.x} cy={node.y} r={node.radius} />
                        <text x={node.x} y={(node.y ?? 0) + 4} textAnchor="middle">
                          {node.label.length > 8 ? `${node.label.slice(0, 7)}…` : node.label}
                        </text>
                        <title>{node.description || node.label}</title>
                      </g>
                    )
                  })}
                </g>
                </g>
              </svg>
            </div>

            <aside className="relation-detail">
              {selected ? (
                <>
                  <span className={`relation-kind kind-${selected.kind}`}>{NODE_LABEL[selected.kind]}</span>
                  {selected.kind === 'person' && selected.role !== 'other' ? (
                    <span className={`relation-role role-${selected.role}`}>{ROLE_LABEL[selected.role]}</span>
                  ) : null}
                  {selected.realWorld ? <span className="relation-real">真实/神话</span> : null}
                  <h3>{selected.label}</h3>
                  {(selected.aliases?.length ?? 0) > 0 ? <p className="relation-aliases">别名：{selected.aliases?.join('、')}</p> : null}
                  <p>{selected.description || '暂无描述。'}</p>
                  <div className="relation-facts">
                    {selected.identity ? <span><b>身份</b>{selected.identity}</span> : null}
                    {selected.rank ? <span><b>官阶/职位</b>{selected.rank}</span> : null}
                    {selected.affiliation ? <span><b>阵营/归属</b>{selected.affiliation}</span> : null}
                  </div>
                  {selected.chapters?.length ? (
                    <p className="relation-chapters">出现章节：{selected.chapters.join('、')}</p>
                  ) : null}
                  {selected.encyclopedia ? (
                    <div className="relation-encyclopedia">
                      <strong>百科背景</strong>
                      <p>{selected.encyclopedia}</p>
                      <em>模型常识，需核对</em>
                    </div>
                  ) : null}
                  <div className="relation-relations">
                    <span>关系</span>
                    {selectedRelations.length === 0 ? <p className="muted">还没有连接到其他节点。</p> : null}
                    {selectedRelations.map(({ edge, label, other }) => (
                      <button
                        key={`${edge.source}-${edge.target}-${edge.label}`}
                        type="button"
                        onClick={() => other && setSelectedId(other.id)}
                      >
                        <strong>{label}</strong>
                        <span>{other?.label ?? '未知节点'}</span>
                        {edge.description ? <em>{edge.description}</em> : null}
                        {edge.chapters?.length ? <small>出处：{edge.chapters.join('、')}</small> : null}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="muted">点击图中的节点查看人物和关系。</p>
              )}
              <div className="relation-legend">
                {(Object.keys(NODE_LABEL) as RelationNode['kind'][]).map((kind) => (
                  <span key={kind}>
                    <i className={`kind-${kind}`} />
                    {NODE_LABEL[kind]}
                  </span>
                ))}
              </div>
            </aside>
          </div>
        </>
      ) : (
        <div className="relation-empty">
          <p>历史、传记和侦探故事最适合看人物关系：谁和谁结盟、谁在隐瞒、哪件事改变了局面。</p>
          <button type="button" className="primary-button small" onClick={() => void generate()} disabled={busy}>
            {busy ? '抽取中…' : '生成人物关系图'}
          </button>
        </div>
      )}
    </div>
  )
}
