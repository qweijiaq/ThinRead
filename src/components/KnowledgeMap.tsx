import { useEffect, useMemo, useRef, useState, type JSX, type PointerEvent, type WheelEvent } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'

import type {
  KnowledgeMapData,
  KnowledgeMapEdge,
  KnowledgeMapNode,
  NoteKind,
} from '../../shared/types.js'

interface KnowledgeMapProps {
  onBack(): void
  onOpenNote(node: KnowledgeMapNode): void
  onOpenBook(bookId: string): void
}

interface SimNode extends KnowledgeMapNode, SimulationNodeDatum {
  radius: number
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  id: string
  kind: KnowledgeMapEdge['kind']
  weight: number
  cross: boolean
}

const KIND_LABEL: Record<NoteKind, string> = {
  condensed: '读薄稿',
  summary: '摘要',
  claim: '论点',
  point: '知识点',
  question: '问题',
  thought: '想法',
  highlight: '划线',
}

const KIND_OPTIONS: Array<{ value: NoteKind | ''; label: string }> = [
  { value: '', label: '全部类型' },
  { value: 'point', label: '知识点' },
  { value: 'claim', label: '论点' },
  { value: 'summary', label: '摘要' },
  { value: 'question', label: '问题' },
  { value: 'thought', label: '想法' },
  { value: 'highlight', label: '划线' },
  { value: 'condensed', label: '读薄稿' },
]

function edgeId(value: SimLink['source'] | SimLink['target']): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return value.id
}

export function KnowledgeMap({ onBack, onOpenNote, onOpenBook }: KnowledgeMapProps): JSX.Element {
  const [data, setData] = useState<KnowledgeMapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [bookFilter, setBookFilter] = useState('')
  const [kindFilter, setKindFilter] = useState<NoteKind | ''>('')
  const [hovered, setHovered] = useState<string | null>(null)
  const [layoutKey, setLayoutKey] = useState(0)
  const [, setFrame] = useState(0)
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const [dragging, setDragging] = useState(false)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const simulationRef = useRef<Simulation<SimNode, undefined> | null>(null)
  const simNodesRef = useRef<SimNode[]>([])
  const simLinksRef = useRef<SimLink[]>([])
  const panRef = useRef<{ x: number; y: number; startX: number; startY: number; pointerId: number } | null>(null)

  async function load(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      setData(await window.api.getKnowledgeMap())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => window.api.onSemanticReady(() => void load()), [])

  useEffect(() => {
    if (!data) return
    simulationRef.current?.stop()
    const bookNodes = data.nodes.filter((node) => node.type === 'book')
    const bookPositions = new Map<string, { x: number; y: number }>()
    bookNodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, bookNodes.length) - Math.PI / 2
      bookPositions.set(node.bookId, {
        x: 600 + Math.cos(angle) * Math.min(250, 120 + bookNodes.length * 22),
        y: 380 + Math.sin(angle) * Math.min(190, 90 + bookNodes.length * 18),
      })
    })
    const nodes: SimNode[] = data.nodes.map((node) => {
      const position = bookPositions.get(node.bookId) ?? { x: 600, y: 380 }
      return {
        ...node,
        radius:
          node.type === 'book'
            ? Math.min(36, 18 + (node.noteCount ?? 0) * 1.3)
            : Math.min(8, 3.5 + node.weight * 0.55),
        x: node.type === 'book' ? position.x : position.x + (Math.random() - 0.5) * 110,
        y: node.type === 'book' ? position.y : position.y + (Math.random() - 0.5) * 90,
      }
    })
    const links: SimLink[] = data.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      weight: edge.weight,
      cross: edge.cross,
    }))
    simNodesRef.current = nodes
    simLinksRef.current = links

    const simulation = forceSimulation<SimNode>(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((node) => node.id)
          .distance((link) => (link.kind === 'book' ? 72 : 135))
          .strength((link) => (link.kind === 'book' ? 0.55 : 0.12)),
      )
      .force('charge', forceManyBody<SimNode>().strength((node) => (node.type === 'book' ? -900 : -110)))
      .force('center', forceCenter(600, 380))
      .force('collide', forceCollide<SimNode>().radius((node) => node.radius + 3))
      .alpha(1)
      .alphaDecay(0.035)
    let lastTick = 0
    simulation
      .on('tick', () => {
        const now = performance.now()
        if (now - lastTick < 40) return
        lastTick = now
        setFrame((value) => value + 1)
      })
      .on('end', () => setFrame((value) => value + 1))
    simulationRef.current = simulation
    setFrame((value) => value + 1)
    return () => {
      simulation.stop()
    }
  }, [data, layoutKey])

  useEffect(
    () => () => {
      simulationRef.current?.stop()
    },
    [],
  )

  const hoveredNode = useMemo(
    () => data?.nodes.find((node) => node.id === hovered) ?? null,
    [data, hovered],
  )
  const nodeById = useMemo(() => new Map((data?.nodes ?? []).map((node) => [node.id, node])), [data])
  const neighbours = useMemo(() => {
    const set = new Set<string>()
    if (!data || !hovered) return set
    for (const edge of data.edges) {
      if (edge.source === hovered) set.add(edge.target)
      if (edge.target === hovered) set.add(edge.source)
    }
    return set
  }, [data, hovered])

  const bookOptions = useMemo(() => data?.nodes.filter((node) => node.type === 'book') ?? [], [data])
  const matches = (node: KnowledgeMapNode): boolean => {
    const term = query.trim().toLowerCase()
    if (!term || node.type === 'book') return true
    return `${node.label} ${node.bookTitle} ${node.chapterTitle ?? ''} ${node.tags.join(' ')}`.toLowerCase().includes(term)
  }
  const dimmed = (node: KnowledgeMapNode): boolean => {
    if (hovered && node.id !== hovered && !neighbours.has(node.id)) return true
    if (bookFilter && node.bookId !== bookFilter) return true
    if (kindFilter && node.type === 'note' && node.kind !== kindFilter) return true
    if (query.trim() && node.type === 'note' && !matches(node)) return true
    return false
  }
  const edgeActive = (edge: SimLink | KnowledgeMapEdge): boolean => {
    const source = edgeId(edge.source)
    const target = edgeId(edge.target)
    return Boolean(hovered && (source === hovered || target === hovered))
  }
  const edgeDimmed = (edge: SimLink | KnowledgeMapEdge): boolean => {
    const sourceId = edgeId(edge.source)
    const targetId = edgeId(edge.target)
    if (hovered && !edgeActive(edge)) return true
    if (bookFilter) {
      const source = nodeById.get(sourceId)
      const target = nodeById.get(targetId)
      if (source?.bookId !== bookFilter && target?.bookId !== bookFilter) return true
    }
    if (kindFilter) {
      const source = nodeById.get(sourceId)
      const target = nodeById.get(targetId)
      const relevant = [source, target].some((node) => node?.type === 'note' && node.kind === kindFilter)
      if (!relevant) return true
    }
    return false
  }

  const noteCount = data?.nodes.filter((node) => node.type === 'note').length ?? 0
  const crossEdges = data?.edges.filter((edge) => edge.cross).length ?? 0
  const semanticEdges = data?.edges.filter((edge) => edge.kind === 'semantic').length ?? 0

  function zoomBy(factor: number): void {
    setTransform((current) => ({ ...current, k: Math.min(3, Math.max(0.4, current.k * factor)) }))
  }

  function onWheel(event: WheelEvent<SVGSVGElement>): void {
    event.preventDefault()
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const local = point.matrixTransform(ctm.inverse())
    setTransform((current) => {
      const nextK = Math.min(3, Math.max(0.4, current.k * (event.deltaY < 0 ? 1.12 : 0.89)))
      const worldX = (local.x - current.x) / current.k
      const worldY = (local.y - current.y) / current.k
      return { k: nextK, x: local.x - worldX * nextK, y: local.y - worldY * nextK }
    })
  }

  function localPoint(event: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return null
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    return point.matrixTransform(ctm.inverse())
  }

  function startPan(event: PointerEvent<SVGSVGElement>): void {
    if (event.target !== event.currentTarget) return
    const point = localPoint(event)
    if (!point) return
    panRef.current = {
      x: transform.x,
      y: transform.y,
      startX: point.x,
      startY: point.y,
      pointerId: event.pointerId,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  function movePan(event: PointerEvent<SVGSVGElement>): void {
    const pan = panRef.current
    const point = localPoint(event)
    if (!pan || !point) return
    setTransform((current) => ({
      ...current,
      x: pan.x + point.x - pan.startX,
      y: pan.y + point.y - pan.startY,
    }))
  }

  function endPan(): void {
    panRef.current = null
    setDragging(false)
  }

  return (
    <main className="map-view">
      <div className="map-header">
        <div>
          <h1>知识地图</h1>
          <p>
            {noteCount} 条笔记 · {bookOptions.length} 本书 · {semanticEdges} 条语义连接 · {crossEdges} 条跨书连接
            {data && data.totalNotes > data.displayedNotes ? ` · 显示最近 ${data.displayedNotes}/${data.totalNotes}` : ''}
          </p>
        </div>
        <div className="map-actions">
          <button type="button" className="ghost-button" onClick={onBack}>
            返回
          </button>
          <button type="button" className="ghost-button" onClick={() => setLayoutKey((value) => value + 1)}>
            重新布局
          </button>
        </div>
      </div>

      <div className="map-toolbar">
        <input
          className="map-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="高亮笔记标题、章节或标签…"
          aria-label="搜索地图节点"
        />
        <select
          className="map-select"
          value={bookFilter}
          onChange={(event) => setBookFilter(event.target.value)}
          aria-label="按书筛选"
        >
          <option value="">全部书</option>
          {bookOptions.map((book) => (
            <option key={book.id} value={book.bookId}>
              {book.label}
            </option>
          ))}
        </select>
        <select
          className="map-select"
          value={kindFilter}
          onChange={(event) => setKindFilter(event.target.value as NoteKind | '')}
          aria-label="按类型筛选"
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.value || 'all'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="map-zoom">
          <button type="button" onClick={() => zoomBy(1.2)} aria-label="放大">
            ＋
          </button>
          <button type="button" onClick={() => zoomBy(0.83)} aria-label="缩小">
            －
          </button>
          <button type="button" onClick={() => setTransform({ x: 0, y: 0, k: 1 })} aria-label="重置视图">
            1:1
          </button>
        </div>
      </div>

      {data && !data.semanticReady ? (
        <p className="map-hint">语义索引还在建立，当前用标签连接；索引完成后会自动刷新。</p>
      ) : null}

      {error ? <div className="inline-error map-error">{error}</div> : null}

      <div className={`map-stage${dragging ? ' is-dragging' : ''}`}>
        {loading && !data ? <p className="map-empty">正在整理知识地图…</p> : null}
        {!loading && data && data.nodes.length === 0 ? (
          <p className="map-empty">还没有笔记。先去读一章，地图会从你的卡片和概念里长出来。</p>
        ) : null}
        {data && data.nodes.length > 0 ? (
          <svg
            ref={svgRef}
            className="map-svg"
            viewBox="0 0 1200 760"
            preserveAspectRatio="xMidYMid meet"
            onWheel={onWheel}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
          >
            <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
              {simLinksRef.current.map((edge) => {
                const source = edge.source as SimNode
                const target = edge.target as SimNode
                if (source?.x == null || source?.y == null || target?.x == null || target?.y == null) return null
                return (
                  <line
                    key={edge.id}
                    className={`map-edge ${edge.kind}${edge.cross ? ' cross' : ''}${edgeActive(edge) ? ' is-active' : ''}${edgeDimmed(edge) ? ' is-dim' : ''}`}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                  />
                )
              })}
              {simNodesRef.current.map((node) => {
                const isBook = node.type === 'book'
                const isDim = dimmed(node)
                const isMatch = Boolean(query.trim() && node.type === 'note' && matches(node))
                const showLabel = isBook || node.id === hovered || isMatch
                return (
                  <g
                    key={node.id}
                    className={`map-node ${node.type}${node.kind ? ` kind-${node.kind}` : ''}${isDim ? ' is-dim' : ''}${isMatch ? ' is-match' : ''}${node.id === hovered ? ' is-hovered' : ''}`}
                    transform={`translate(${node.x ?? 0} ${node.y ?? 0})`}
                    tabIndex={0}
                    role="button"
                    aria-label={node.label}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(node.id)}
                    onBlur={() => setHovered(null)}
                    onClick={() => (isBook ? onOpenBook(node.bookId) : onOpenNote(node))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        if (isBook) onOpenBook(node.bookId)
                        else onOpenNote(node)
                      }
                    }}
                  >
                    <title>{node.label}</title>
                    <circle r={node.radius} />
                    {isBook ? (
                      <>
                        <text className="map-book-label" y={node.radius + 16}>
                          {node.label}
                        </text>
                        <text className="map-book-count" y={node.radius + 30}>
                          {node.noteCount ?? 0} 条笔记
                        </text>
                      </>
                    ) : showLabel ? (
                      <text className="map-note-label" y={-node.radius - 7}>
                        {node.label.length > 18 ? `${node.label.slice(0, 18)}…` : node.label}
                      </text>
                    ) : null}
                  </g>
                )
              })}
            </g>
          </svg>
        ) : null}

        <div className="map-legend">
          <span>
            <i className="legend-book" /> 书
          </span>
          <span>
            <i className="legend-note" /> 笔记
          </span>
          <span>
            <i className="legend-cross" /> 跨书连接
          </span>
          <span>
            <i className="legend-tag" /> 标签连接
          </span>
        </div>

        {hoveredNode ? (
          <div className="map-tooltip">
            <span className="map-tooltip-source">
              {hoveredNode.bookTitle}
              {hoveredNode.chapterTitle ? ` · ${hoveredNode.chapterTitle}` : ''}
            </span>
            <strong>{hoveredNode.label}</strong>
            {hoveredNode.type === 'note' && hoveredNode.kind ? (
              <span className="map-tooltip-kind">{KIND_LABEL[hoveredNode.kind]}</span>
            ) : null}
            {hoveredNode.tags.length > 0 ? (
              <span className="map-tooltip-tags">{hoveredNode.tags.slice(0, 5).join(' · ')}</span>
            ) : null}
            <span className="map-tooltip-open">{hoveredNode.type === 'book' ? '点击打开这本书' : '点击打开这张笔记'}</span>
          </div>
        ) : null}
      </div>
    </main>
  )
}
