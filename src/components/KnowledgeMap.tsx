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
  LibraryNote,
} from '../../shared/types.js'
import { noteDisplayTitle } from '../lib/note-display.js'
import { Checkbox } from './Checkbox.js'
import { Select } from './Select.js'

interface KnowledgeMapProps {
  onBack(): void
  onOpenNote(node: KnowledgeMapNode): void
  onOpenBook(bookId: string): void
  onOpenRelation(bookId?: string): void
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

function edgeId(value: SimLink['source'] | SimLink['target']): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return value.id
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function jitter(id: string, seed: number, axis: number): number {
  return ((hashString(`${id}:${seed}:${axis}`) % 2001) / 1000) - 1
}

export function KnowledgeMap({ onBack, onOpenNote, onOpenBook, onOpenRelation }: KnowledgeMapProps): JSX.Element {
  const [data, setData] = useState<KnowledgeMapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [bookFilter, setBookFilter] = useState('')
  const [crossOnly, setCrossOnly] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [layoutKey, setLayoutKey] = useState(0)
  const [, setFrame] = useState(0)
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const [dragging, setDragging] = useState(false)
  const [detailNotes, setDetailNotes] = useState<LibraryNote[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const simulationRef = useRef<Simulation<SimNode, undefined> | null>(null)
  const simNodesRef = useRef<SimNode[]>([])
  const simLinksRef = useRef<SimLink[]>([])
  const panRef = useRef<{ x: number; y: number; startX: number; startY: number; pointerId: number } | null>(null)
  const movedRef = useRef(false)

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

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!data) return
    simulationRef.current?.stop()
    const dataNodes = new Map(data.nodes.map((node) => [node.id, node]))
    const books = data.nodes
      .filter((node) => node.type === 'book')
      .sort((a, b) => a.bookId.localeCompare(b.bookId))
    const bookPositions = new Map<string, { x: number; y: number }>()
    books.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, books.length) - Math.PI / 2
      bookPositions.set(node.bookId, {
        x: 600 + Math.cos(angle) * Math.min(300, 140 + books.length * 26),
        y: 380 + Math.sin(angle) * Math.min(220, 100 + books.length * 22),
      })
    })
    const conceptBookPositions = new Map<string, Array<{ x: number; y: number }>>()
    for (const edge of data.edges) {
      if (edge.kind !== 'book') continue
      const source = dataNodes.get(edge.source)
      const target = dataNodes.get(edge.target)
      const concept = source?.type === 'concept' ? source : target?.type === 'concept' ? target : null
      const book = source?.type === 'book' ? source : target?.type === 'book' ? target : null
      if (!concept || !book) continue
      const position = bookPositions.get(book.bookId)
      if (!position) continue
      if (!conceptBookPositions.has(concept.id)) conceptBookPositions.set(concept.id, [])
      conceptBookPositions.get(concept.id)!.push(position)
    }

    const nodes: SimNode[] = data.nodes.map((node) => {
      if (node.type === 'book') {
        const position = bookPositions.get(node.bookId) ?? { x: 600, y: 380 }
        return {
          ...node,
          radius: Math.min(34, 20 + (node.noteCount ?? 0) * 0.5),
          x: position.x,
          y: position.y,
        }
      }
      const positions = conceptBookPositions.get(node.id) ?? []
      const base =
        positions.length > 0
          ? {
              x: positions.reduce((sum, point) => sum + point.x, 0) / positions.length,
              y: positions.reduce((sum, point) => sum + point.y, 0) / positions.length,
            }
          : { x: 600, y: 380 }
      return {
        ...node,
        radius: Math.min(26, 8 + node.weight * 0.8),
        x: base.x + jitter(node.id, layoutKey, 1) * 120,
        y: base.y + jitter(node.id, layoutKey, 2) * 90,
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
    const simulation = forceSimulation<SimNode>(nodes)
      .stop()
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((node) => node.id)
          .distance((link) => (link.kind === 'book' ? 115 : 165))
          .strength((link) => (link.kind === 'book' ? 0.5 : 0.16)),
      )
      .force('charge', forceManyBody<SimNode>().strength((node) => (node.type === 'book' ? -760 : -150)))
      .force('center', forceCenter(600, 380))
      .force('collide', forceCollide<SimNode>().radius((node) => node.radius + 6))
      .alpha(1)
      .alphaDecay(0.035)
    for (let tick = 0; tick < 220; tick++) simulation.tick()
    simNodesRef.current = nodes
    simLinksRef.current = links
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

  const nodeById = useMemo(() => new Map((data?.nodes ?? []).map((node) => [node.id, node])), [data])
  const selectedNode = useMemo(() => (selected ? nodeById.get(selected) ?? null : null), [selected, nodeById])
  const hoveredNode = useMemo(() => (hovered ? nodeById.get(hovered) ?? null : null), [hovered, nodeById])
  const conceptBooks = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const edge of data?.edges ?? []) {
      if (edge.kind !== 'book') continue
      const source = nodeById.get(edge.source)
      const target = nodeById.get(edge.target)
      const concept = source?.type === 'concept' ? source : target?.type === 'concept' ? target : null
      const book = source?.type === 'book' ? source : target?.type === 'book' ? target : null
      if (!concept || !book) continue
      if (!map.has(concept.id)) map.set(concept.id, new Set())
      map.get(concept.id)!.add(book.bookId)
    }
    return map
  }, [data, nodeById])
  const focusId = hovered ?? selected
  const neighbours = useMemo(() => {
    const set = new Set<string>()
    if (!data || !focusId) return set
    for (const edge of data.edges) {
      if (edge.source === focusId) set.add(edge.target)
      if (edge.target === focusId) set.add(edge.source)
    }
    return set
  }, [data, focusId])
  const connected = useMemo(() => {
    if (!data || !selectedNode) return []
    const ids = new Set<string>()
    for (const edge of data.edges) {
      if (edge.source === selectedNode.id) ids.add(edge.target)
      if (edge.target === selectedNode.id) ids.add(edge.source)
    }
    return [...ids].map((id) => nodeById.get(id)).filter((node): node is KnowledgeMapNode => Boolean(node))
  }, [data, selectedNode, nodeById])

  useEffect(() => {
    if (!selectedNode) {
      setDetailNotes([])
      setDetailError(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    const filter = selectedNode.type === 'concept' ? { tag: selectedNode.label, limit: 60 } : { bookId: selectedNode.bookId, limit: 60 }
    void window.api
      .listLibraryNotes(filter)
      .then((notes) => {
        if (!cancelled) setDetailNotes(notes)
      })
      .catch((err: unknown) => {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedNode?.id, selectedNode?.type, selectedNode?.label, selectedNode?.bookId])

  const bookOptions = useMemo(() => data?.nodes.filter((node) => node.type === 'book') ?? [], [data])
  const conceptCount = data?.nodes.filter((node) => node.type === 'concept').length ?? 0
  const crossConceptCount = [...conceptBooks.values()].filter((books) => books.size > 1).length
  const matches = (node: KnowledgeMapNode): boolean => {
    const term = query.trim().toLowerCase()
    if (!term) return true
    return `${node.label} ${node.bookTitle} ${node.tags.join(' ')}`.toLowerCase().includes(term)
  }
  const dimmed = (node: KnowledgeMapNode): boolean => {
    if (focusId) return !(node.id === focusId || neighbours.has(node.id))
    if (bookFilter) {
      if (node.type === 'book') return node.bookId !== bookFilter
      return !conceptBooks.get(node.id)?.has(bookFilter)
    }
    if (crossOnly && node.type === 'concept') return (conceptBooks.get(node.id)?.size ?? 0) < 2
    if (query.trim() && !matches(node)) return true
    return false
  }
  const edgeActive = (edge: SimLink | KnowledgeMapEdge): boolean => {
    const source = edgeId(edge.source)
    const target = edgeId(edge.target)
    return Boolean(focusId && (source === focusId || target === focusId))
  }
  const edgeDimmed = (edge: SimLink | KnowledgeMapEdge): boolean => {
    if (focusId) return !edgeActive(edge)
    const source = nodeById.get(edgeId(edge.source))
    const target = nodeById.get(edgeId(edge.target))
    if (bookFilter) {
      const relevant = [source, target].some((node) =>
        node?.type === 'book' ? node.bookId === bookFilter : node?.type === 'concept' ? conceptBooks.get(node.id)?.has(bookFilter) : false,
      )
      if (!relevant) return true
    }
    if (crossOnly) {
      const concepts = [source, target].filter((node): node is KnowledgeMapNode => node?.type === 'concept')
      if (concepts.length > 0 && !concepts.some((node) => (conceptBooks.get(node.id)?.size ?? 0) > 1)) return true
    }
    return false
  }

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
    movedRef.current = false
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
    if (Math.abs(point.x - pan.startX) > 2 || Math.abs(point.y - pan.startY) > 2) movedRef.current = true
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

  function focusNode(id: string): void {
    const node = simNodesRef.current.find((item) => item.id === id)
    if (!node || node.x == null || node.y == null) return
    const k = 1.8
    setTransform({ k, x: 600 - node.x * k, y: 380 - node.y * k })
  }

  function openLibraryNote(note: LibraryNote): void {
    onOpenNote({
      id: `note:${note.id}`,
      type: 'note',
      label: noteDisplayTitle(note),
      bookId: note.bookId,
      bookTitle: note.bookTitle,
      chapterId: note.chapterId,
      chapterTitle: note.chapterTitle,
      noteId: note.id,
      kind: note.kind,
      weight: note.importance ?? 2,
      tags: note.tags,
      noteCount: null,
      preview: note.content.slice(0, 180),
    })
  }

  const conceptLinks = selectedNode?.type === 'concept' ? connected.filter((node) => node.type === 'concept') : []
  const conceptBooksList = selectedNode?.type === 'concept' ? connected.filter((node) => node.type === 'book') : []
  const bookConcepts = selectedNode?.type === 'book' ? connected.filter((node) => node.type === 'concept') : []

  return (
    <main className="map-view">
      <div className="map-header">
        <div>
          <h1>知识地图</h1>
          <p>
            {conceptCount} 个概念 · {bookOptions.length} 本书 · {crossConceptCount} 个跨书概念 · {data?.displayedNotes ?? 0} 条带标签笔记
            {data && data.totalNotes > data.displayedNotes ? `（共 ${data.totalNotes} 条）` : ''}
            <span className="map-usage">· 点击节点查看详情 · 双击打开书</span>
          </p>
        </div>
        <div className="map-actions">
          <button type="button" className="ghost-button" onClick={onBack}>
            返回
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() =>
              onOpenRelation(
                selectedNode?.type === 'book'
                  ? selectedNode.bookId
                  : bookFilter || bookOptions[0]?.bookId,
              )
            }
          >
            人物关系图
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setLayoutKey((value) => value + 1)
              setTransform({ x: 0, y: 0, k: 1 })
            }}
          >
            重新布局
          </button>
        </div>
      </div>

      <div className="map-toolbar">
        <input
          className="map-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索概念或书名…"
          aria-label="搜索概念或书名"
        />
        <Select
          className="filter-select"
          value={bookFilter}
          onChange={setBookFilter}
          ariaLabel="按书筛选"
          options={[
            { value: '', label: '全部书' },
            ...bookOptions.map((book) => ({ value: book.bookId, label: book.label })),
          ]}
        />
        <Checkbox className="map-toggle" checked={crossOnly} onChange={setCrossOnly} label="只看跨书概念" />
        <div className="map-zoom">
          <button type="button" onClick={() => zoomBy(1.2)} aria-label="放大">
            ＋
          </button>
          <button type="button" onClick={() => zoomBy(0.83)} aria-label="缩小">
            －
          </button>
          <button type="button" onClick={() => setTransform({ x: 0, y: 0, k: 1 })} aria-label="重置视图">
            全图
          </button>
        </div>
      </div>

      {error ? <div className="inline-error map-error">{error}</div> : null}
      {data && conceptCount === 0 ? (
        <p className="map-hint">还没有带标签的笔记，概念图暂时为空；你仍然可以在笔记库里浏览全部笔记。</p>
      ) : null}

      <div className={`map-stage${dragging ? ' is-dragging' : ''}`}>
        {loading && !data ? <p className="map-empty">正在整理知识地图…</p> : null}
        {!loading && data && data.nodes.length === 0 ? (
          <p className="map-empty">还没有带标签的笔记。先去读一章生成卡片，地图会从概念里长出来。</p>
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
            onClick={(event) => {
              if (event.target === event.currentTarget && !movedRef.current) setSelected(null)
            }}
          >
            <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
              {simLinksRef.current.map((edge) => {
                const source = edge.source as SimNode
                const target = edge.target as SimNode
                if (source?.x == null || source?.y == null || target?.x == null || target?.y == null) return null
                return (
                  <line
                    key={edge.id}
                    className={`map-edge ${edge.kind}${edgeActive(edge) ? ' is-active' : ''}${edgeDimmed(edge) ? ' is-dim' : ''}`}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                  />
                )
              })}
              {simNodesRef.current.map((node) => {
                const isBook = node.type === 'book'
                const isConcept = node.type === 'concept'
                const isCross = isConcept && (conceptBooks.get(node.id)?.size ?? 0) > 1
                const isDim = dimmed(node)
                const isMatch = Boolean(query.trim() && matches(node))
                const isSelected = node.id === selected
                const isNeighbour = Boolean(selected && neighbours.has(node.id))
                return (
                  <g
                    key={node.id}
                    className={`map-node ${node.type}${isCross ? ' is-cross' : ''}${isDim ? ' is-dim' : ''}${isMatch ? ' is-match' : ''}${isSelected ? ' is-selected' : ''}${isNeighbour ? ' is-neighbour' : ''}${node.id === hovered ? ' is-hovered' : ''}`}
                    transform={`translate(${node.x ?? 0} ${node.y ?? 0})`}
                    tabIndex={0}
                    role="button"
                    aria-label={node.label}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(node.id)}
                    onBlur={() => setHovered(null)}
                    onClick={(event) => {
                      event.stopPropagation()
                      setSelected(node.id)
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      if (isBook) onOpenBook(node.bookId)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelected(node.id)
                      }
                    }}
                  >
                    <title>{node.label}</title>
                    <circle className="map-hit" r={node.radius + 8} />
                    <circle className="map-node-dot" r={node.radius} />
                    {isBook ? (
                      <>
                        <text className="map-book-label" y={node.radius + 16}>
                          {node.label}
                        </text>
                        <text className="map-book-count" y={node.radius + 30}>
                          {node.noteCount ?? 0} 条笔记
                        </text>
                      </>
                    ) : (
                      <>
                        <text className="map-concept-label" y={-node.radius - 7}>
                          {node.label.length > 12 ? `${node.label.slice(0, 12)}…` : node.label}
                        </text>
                        {isCross ? (
                          <text className="map-concept-cross" y={node.radius + 14}>
                            跨书
                          </text>
                        ) : null}
                      </>
                    )}
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
            <i className="legend-concept" /> 概念
          </span>
          <span>
            <i className="legend-cross" /> 跨书概念
          </span>
          <span>
            <i className="legend-tag" /> 概念共现
          </span>
        </div>

        {hoveredNode && hovered !== selected ? (
          <div className="map-tooltip">
            <span className="map-tooltip-source">
              {hoveredNode.type === 'book'
                ? `${hoveredNode.noteCount ?? 0} 条笔记`
                : `${hoveredNode.noteCount ?? 0} 条笔记 · ${conceptBooks.get(hoveredNode.id)?.size ?? 0} 本书`}
            </span>
            <strong>{hoveredNode.label}</strong>
            <span className="map-tooltip-open">点击查看详情</span>
          </div>
        ) : null}

        {selectedNode ? (
          <aside className="map-detail">
            <div className="map-detail-head">
              <span className="map-tooltip-source">
                {selectedNode.type === 'book'
                  ? `书 · ${selectedNode.noteCount ?? 0} 条笔记`
                  : `概念 · ${selectedNode.noteCount ?? 0} 条笔记 · ${conceptBooks.get(selectedNode.id)?.size ?? 0} 本书`}
              </span>
              <button type="button" className="icon-button" onClick={() => setSelected(null)} aria-label="关闭详情">
                ×
              </button>
            </div>
            <h3>{selectedNode.label}</h3>
            {selectedNode.type === 'concept' && conceptBooksList.length > 0 ? (
              <div className="map-detail-links">
                <span>所属书</span>
                {conceptBooksList.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => {
                      setSelected(node.id)
                      focusNode(node.id)
                    }}
                  >
                    《{node.label}》
                  </button>
                ))}
              </div>
            ) : null}
            {selectedNode.type === 'concept' && conceptLinks.length > 0 ? (
              <div className="map-detail-links">
                <span>相关概念</span>
                {conceptLinks.slice(0, 8).map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => {
                      setSelected(node.id)
                      focusNode(node.id)
                    }}
                  >
                    {node.label}
                  </button>
                ))}
              </div>
            ) : null}
            {selectedNode.type === 'book' && bookConcepts.length > 0 ? (
              <div className="map-detail-links">
                <span>这本书的概念</span>
                {bookConcepts.slice(0, 10).map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => {
                      setSelected(node.id)
                      focusNode(node.id)
                    }}
                  >
                    {node.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="map-detail-notes">
              <span>笔记</span>
              {detailLoading ? <p className="muted">正在加载…</p> : null}
              {detailError ? <p className="inline-error">{detailError}</p> : null}
              {!detailLoading && detailNotes.length === 0 ? <p className="muted">没有可显示的笔记。</p> : null}
              {detailNotes.slice(0, 10).map((note) => (
                <button key={note.id} type="button" className="map-detail-note" onClick={() => openLibraryNote(note)}>
                  <strong>{noteDisplayTitle(note)}</strong>
                  <em>
                    {note.bookTitle}
                    {note.chapterTitle ? ` · ${note.chapterTitle}` : ''}
                  </em>
                </button>
              ))}
              {detailNotes.length > 10 ? <p className="muted">还有 {detailNotes.length - 10} 条…</p> : null}
            </div>
            <div className="map-detail-actions">
              <button type="button" className="ghost-button small" onClick={() => focusNode(selectedNode.id)}>
                聚焦
              </button>
              {selectedNode.type === 'book' ? (
                <button type="button" className="primary-button small" onClick={() => onOpenBook(selectedNode.bookId)}>
                  打开这本书
                </button>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </main>
  )
}
