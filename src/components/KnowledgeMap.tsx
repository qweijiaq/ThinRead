import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Background,
  BackgroundVariant,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type MiniMapNodeProps,
  type Node,
  type NodeProps,
  type NodeTypes,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'

import type {
  BookSummary,
  KnowledgeMapData,
  KnowledgeMapEdge,
  KnowledgeMapNode,
  LibraryNote,
} from '../../shared/types.js'
import { exportFlowImage, graphImageFilename } from '../lib/flow-image.js'
import { knowledgeMapToMermaid, mermaidFence } from '../lib/mermaid-graph.js'
import { noteDisplayTitle } from '../lib/note-display.js'
import { Checkbox } from './Checkbox.js'
import { LabRelationGraph } from './LabRelationGraph.js'
import { Select } from './Select.js'

interface KnowledgeMapProps {
  books: BookSummary[]
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

type MapNodeData = {
  node: KnowledgeMapNode
  radius: number
  cross: boolean
  dim: boolean
  match: boolean
  neighbour: boolean
  selected: boolean
}

type MapFlowNode = Node<MapNodeData, 'book' | 'concept'>

type MapEdgeData = {
  kind: KnowledgeMapEdge['kind']
  cross: boolean
}

type MapFlowEdge = Edge<MapEdgeData>

const EDGE_KIND_LABEL: Record<KnowledgeMapEdge['kind'], string> = {
  book: '书 · 概念',
  semantic: '概念共现',
  tag: '标签共现',
}

const MINIMAP_WIDTH = 148
const MINIMAP_HEIGHT = 104

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function jitter(id: string, seed: number, axis: number): number {
  return (hashString(`${id}:${seed}:${axis}`) % 2001) / 1000 - 1
}

function shortLabel(label: string): string {
  return label.length > 12 ? `${label.slice(0, 12)}…` : label
}

function MapNodeView({ data }: NodeProps): JSX.Element {
  const { node, radius, cross, dim, match, neighbour, selected } = data as MapNodeData
  const size = (radius + 8) * 2
  const center = size / 2
  const isBook = node.type === 'book'
  const className = [
    'map-node',
    node.type,
    cross ? 'is-cross' : '',
    dim ? 'is-dim' : '',
    match ? 'is-match' : '',
    neighbour ? 'is-neighbour' : '',
    selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} style={{ width: size, height: size }}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <svg className="map-node-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="map-hit" cx={center} cy={center} r={radius + 8} />
        <circle className="map-node-dot" cx={center} cy={center} r={radius} />
        {isBook ? (
          <>
            <text className="map-book-label" x={center} y={center + radius + 16}>
              {node.label}
            </text>
            <text className="map-book-count" x={center} y={center + radius + 30}>
              {node.noteCount ?? 0} 条笔记
            </text>
          </>
        ) : (
          <>
            <text className="map-concept-label" x={center} y={center - radius - 7}>
              {shortLabel(node.label)}
            </text>
            {cross ? (
              <text className="map-concept-cross" x={center} y={center + radius + 14}>
                跨书
              </text>
            ) : null}
          </>
        )}
      </svg>
    </div>
  )
}

function MiniMapDot({ x, y, width, height, color, strokeColor, strokeWidth }: MiniMapNodeProps): JSX.Element {
  return (
    <circle
      cx={x + width / 2}
      cy={y + height / 2}
      r={Math.max(3, Math.min(width, height) / 2)}
      style={{ fill: color, stroke: strokeColor, strokeWidth }}
    />
  )
}

const NODE_TYPES: NodeTypes = {
  book: MapNodeView,
  concept: MapNodeView,
}

function minimapColor(node: Node): string {
  return (node as MapFlowNode).data?.node?.type === 'book' ? 'var(--accent-soft)' : 'var(--white)'
}

function minimapStroke(node: Node): string {
  return (node as MapFlowNode).data?.node?.type === 'book' ? 'var(--accent)' : 'var(--accent-dark)'
}

const MAP_POSITIONS_KEY = 'reading-notes-map-positions'

function readMapPositions(): Record<string, { x: number; y: number }> {
  try {
    const value = JSON.parse(localStorage.getItem(MAP_POSITIONS_KEY) ?? '{}') as unknown
    if (!value || typeof value !== 'object') return {}
    const positions: Record<string, { x: number; y: number }> = {}
    for (const [id, point] of Object.entries(value as Record<string, unknown>)) {
      if (!point || typeof point !== 'object') continue
      const x = Number((point as { x?: unknown }).x)
      const y = Number((point as { y?: unknown }).y)
      if (Number.isFinite(x) && Number.isFinite(y)) positions[id] = { x, y }
    }
    return positions
  } catch {
    return {}
  }
}

export function KnowledgeMap({ books, onBack, onOpenNote, onOpenBook }: KnowledgeMapProps): JSX.Element {
  const [mode, setMode] = useState<'map' | 'relation'>('map')
  const [relationBookId, setRelationBookId] = useState(
    books.find((book) => book.chapterCount > 0)?.id ?? '',
  )
  const [data, setData] = useState<KnowledgeMapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [bookFilter, setBookFilter] = useState('')
  const [crossOnly, setCrossOnly] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [layoutKey, setLayoutKey] = useState(0)
  const [detailNotes, setDetailNotes] = useState<LibraryNote[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [mapNotice, setMapNotice] = useState<string | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [nodes, setNodes, onNodesChange] = useNodesState<MapFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<MapFlowEdge>([])
  const flowRef = useRef<ReactFlowInstance<MapFlowNode, MapFlowEdge> | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const centerByIdRef = useRef<Map<string, { x: number; y: number }>>(new Map())

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
      if (event.key !== 'Escape') return
      setSelected(null)
      setSelectedEdgeId(null)
      setHovered(null)
      // 同时清掉 React Flow 内部选中态，避免方向键继续移动旧的选中节点
      setNodes((current) =>
        current.some((node) => node.selected) ? current.map((node) => (node.selected ? { ...node, selected: false } : node)) : current,
      )
      setEdges((current) =>
        current.some((edge) => edge.selected) ? current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)) : current,
      )
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setEdges, setNodes])

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

  const matches = useCallback(
    (node: KnowledgeMapNode): boolean => {
      const term = query.trim().toLowerCase()
      if (!term) return true
      return `${node.label} ${node.bookTitle} ${node.tags.join(' ')}`.toLowerCase().includes(term)
    },
    [query],
  )
  const dimmed = useCallback(
    (node: KnowledgeMapNode): boolean => {
      if (focusId) return !(node.id === focusId || neighbours.has(node.id))
      if (bookFilter) {
        if (node.type === 'book') return node.bookId !== bookFilter
        return !conceptBooks.get(node.id)?.has(bookFilter)
      }
      if (crossOnly && node.type === 'concept') return (conceptBooks.get(node.id)?.size ?? 0) < 2
      if (query.trim() && !matches(node)) return true
      return false
    },
    [bookFilter, conceptBooks, crossOnly, focusId, matches, neighbours, query],
  )
  const edgeDimmed = useCallback(
    (sourceId: string, targetId: string): boolean => {
      const active = Boolean(focusId && (sourceId === focusId || targetId === focusId))
      if (focusId) return !active
      const source = nodeById.get(sourceId)
      const target = nodeById.get(targetId)
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
    },
    [bookFilter, conceptBooks, crossOnly, focusId, nodeById],
  )

  // d3-force 只负责计算初始/重排坐标，交互交给 React Flow 的视口与拖拽
  useEffect(() => {
    if (!data) return
    const dataNodes = new Map(data.nodes.map((node) => [node.id, node]))
    const bookNodes = data.nodes
      .filter((node) => node.type === 'book')
      .sort((a, b) => a.bookId.localeCompare(b.bookId))
    const bookPositions = new Map<string, { x: number; y: number }>()
    bookNodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, bookNodes.length) - Math.PI / 2
      bookPositions.set(node.bookId, {
        x: 600 + Math.cos(angle) * Math.min(300, 140 + bookNodes.length * 26),
        y: 380 + Math.sin(angle) * Math.min(220, 100 + bookNodes.length * 22),
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

    const simNodes: SimNode[] = data.nodes.map((node) => {
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
    const simLinks: SimLink[] = data.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      weight: edge.weight,
      cross: edge.cross,
    }))
    const simulation = forceSimulation<SimNode>(simNodes)
      .stop()
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinks)
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
    simulation.stop()

    const centers = new Map<string, { x: number; y: number }>()
    const savedPositions = readMapPositions()
    const flowNodes: MapFlowNode[] = simNodes.map((simNode) => {
      const original = dataNodes.get(simNode.id) ?? simNode
      const size = (simNode.radius + 8) * 2
      const saved = savedPositions[simNode.id]
      const x = saved?.x ?? simNode.x ?? 600
      const y = saved?.y ?? simNode.y ?? 380
      centers.set(simNode.id, { x, y })
      return {
        id: simNode.id,
        type: original.type === 'book' ? 'book' : 'concept',
        position: { x, y },
        origin: [0.5, 0.5],
        width: size,
        height: size,
        ariaLabel: original.label,
        ariaRole: 'button',
        data: {
          node: original,
          radius: simNode.radius,
          cross: original.type === 'concept' && (conceptBooks.get(original.id)?.size ?? 0) > 1,
          dim: false,
          match: false,
          neighbour: false,
          selected: false,
        },
      }
    })
    const flowEdges: MapFlowEdge[] = data.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'straight',
      interactionWidth: 12,
      className: `map-edge ${edge.kind}${edge.cross ? ' cross' : ''}`,
      data: { kind: edge.kind, cross: edge.cross },
    }))
    centerByIdRef.current = centers
    setNodes(flowNodes)
    setEdges(flowEdges)

    const frame = requestAnimationFrame(() => {
      void flowRef.current?.fitView({ padding: 0.16, duration: 0 })
    })
    return () => cancelAnimationFrame(frame)
  }, [conceptBooks, data, layoutKey, setEdges, setNodes])

  // 选中 / 悬停 / 过滤只更新节点 data，不动 position，保证拖拽位置不被重置
  useEffect(() => {
    setNodes((current) => {
      let changed = false
      const next = current.map((flowNode) => {
        const node = flowNode.data.node
        const dim = dimmed(node)
        const match = Boolean(query.trim()) && matches(node)
        const neighbour = Boolean(selected && selected !== node.id && neighbours.has(node.id))
        const isSelected = node.id === selected
        if (
          flowNode.data.dim === dim &&
          flowNode.data.match === match &&
          flowNode.data.neighbour === neighbour &&
          flowNode.data.selected === isSelected
        ) {
          return flowNode
        }
        changed = true
        return { ...flowNode, data: { ...flowNode.data, dim, match, neighbour, selected: isSelected } }
      })
      return changed ? next : current
    })
  }, [data, dimmed, layoutKey, matches, neighbours, query, selected, setNodes])

  useEffect(() => {
    setEdges((current) => {
      let changed = false
      const next = current.map((edge) => {
        const active = Boolean(focusId && (edge.source === focusId || edge.target === focusId))
        const dim = edgeDimmed(edge.source, edge.target)
        const picked = edge.id === selectedEdgeId
        const className = `map-edge ${edge.data?.kind ?? 'semantic'}${edge.data?.cross ? ' cross' : ''}${active ? ' is-active' : ''}${dim ? ' is-dim' : ''}${picked ? ' is-picked' : ''}`
        if (edge.className === className) return edge
        changed = true
        return { ...edge, className }
      })
      return changed ? next : current
    })
  }, [data, edgeDimmed, focusId, layoutKey, selectedEdgeId, setEdges])

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
  const relationBooks = useMemo(() => books.filter((book) => book.chapterCount > 0), [books])

  useEffect(() => {
    if (relationBooks.length === 0) return
    if (!relationBooks.some((book) => book.id === relationBookId)) {
      setRelationBookId(relationBooks[0]!.id)
    }
  }, [relationBookId, relationBooks])

  const selectedRelationBook = relationBooks.find((book) => book.id === relationBookId) ?? null
  const conceptCount = data?.nodes.filter((node) => node.type === 'concept').length ?? 0
  const crossConceptCount = [...conceptBooks.values()].filter((entry) => entry.size > 1).length
  const selectedEdge = useMemo(
    () => (selectedEdgeId ? data?.edges.find((edge) => edge.id === selectedEdgeId) ?? null : null),
    [data, selectedEdgeId],
  )
  const selectedEdgeSource = selectedEdge ? nodeById.get(selectedEdge.source) ?? null : null
  const selectedEdgeTarget = selectedEdge ? nodeById.get(selectedEdge.target) ?? null : null

  const handleInit = useCallback((instance: ReactFlowInstance<MapFlowNode, MapFlowEdge>) => {
    flowRef.current = instance
    // 从人物关系切回地图时 React Flow 会重新挂载，补一次 fitView 恢复全图
    if (instance.getNodes().length > 0) {
      requestAnimationFrame(() => {
        void instance.fitView({ padding: 0.16, duration: 0 })
      })
    }
  }, [])

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams<MapFlowNode, MapFlowEdge>) => {
      const nodeId = selectedNodes[0]?.id ?? null
      setSelected(nodeId)
      setSelectedEdgeId(nodeId ? null : selectedEdges[0]?.id ?? null)
    },
    [],
  )

  const handleNodeDoubleClick = useCallback(
    (_event: ReactMouseEvent, node: MapFlowNode) => {
      if (node.data.node.type === 'book') onOpenBook(node.data.node.bookId)
    },
    [onOpenBook],
  )

  const handleNodeMouseEnter = useCallback((_event: ReactMouseEvent, node: MapFlowNode) => {
    setHovered(node.id)
  }, [])

  const handleNodeMouseLeave = useCallback(() => {
    setHovered(null)
  }, [])

  const handleNodeDragStop = useCallback(() => {
    const current = flowRef.current?.getNodes() ?? []
    const positions = Object.fromEntries(current.map((node) => [node.id, node.position]))
    try {
      localStorage.setItem(MAP_POSITIONS_KEY, JSON.stringify(positions))
    } catch {
      // 布局持久化失败不影响本次拖拽。
    }
  }, [])

  function focusFirstMatch(): void {
    if (!data) return
    const found = data.nodes.find((node) => matches(node))
    if (!found) return
    setSelected(found.id)
    setSelectedEdgeId(null)
    requestAnimationFrame(() => focusNode(found.id))
  }

  async function copyMermaid(): Promise<void> {
    if (!data) return
    const text = mermaidFence(knowledgeMapToMermaid(data))
    try {
      await window.api.copyText(text)
      setMapNotice('Mermaid 已复制')
      window.setTimeout(() => setMapNotice(null), 1800)
    } catch {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        const area = document.createElement('textarea')
        area.value = text
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.append(area)
        area.select()
        document.execCommand('copy')
        area.remove()
      }
      setMapNotice('Mermaid 已复制')
      window.setTimeout(() => setMapNotice(null), 1800)
    }
  }

  async function exportImage(): Promise<void> {
    if (imageBusy || !data) return
    setImageBusy(true)
    setError(null)
    try {
      const result = await exportFlowImage({
        root: stageRef.current,
        nodes: flowRef.current?.getNodes() ?? [],
        filename: graphImageFilename('知识地图'),
      })
      if (result.saved) {
        setMapNotice(`已保存到 ${result.path ?? '图片'}`)
        window.setTimeout(() => setMapNotice(null), 2400)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImageBusy(false)
    }
  }

  function zoomBy(factor: number): void {
    const flow = flowRef.current
    if (!flow) return
    if (factor >= 1) void flow.zoomIn({ duration: 160 })
    else void flow.zoomOut({ duration: 160 })
  }

  function fitGraph(): void {
    void flowRef.current?.fitView({ padding: 0.16, duration: 240 })
  }

  function focusNode(id: string): void {
    const flow = flowRef.current
    const position = flow?.getNode(id)?.position ?? centerByIdRef.current.get(id)
    if (!position) return
    void flow?.setCenter(position.x, position.y, { zoom: 1.7, duration: 320 })
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
          <h1>{mode === 'map' ? '知识地图' : '人物关系'}</h1>
          <p>
            {mode === 'map' ? (
              <>
                {conceptCount} 个概念 · {bookOptions.length} 本书 · {crossConceptCount} 个跨书概念 · {data?.displayedNotes ?? 0} 条带标签笔记
                {data && data.totalNotes > data.displayedNotes ? `（共 ${data.totalNotes} 条）` : ''}
                <span className="map-usage">· 点击节点查看详情 · 双击打开书 · 拖拽节点或框选</span>
              </>
            ) : (
              <>
                {relationBooks.length} 本书 · 按人物、组织和事件抽取关系
                <span className="map-usage">· 选择一本书后生成关系图</span>
              </>
            )}
          </p>
        </div>
        <div className="map-actions">
          <div className="map-mode-switch" role="tablist" aria-label="地图模式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'map'}
              className={mode === 'map' ? 'active' : ''}
              onClick={() => setMode('map')}
            >
              知识地图
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'relation'}
              className={mode === 'relation' ? 'active' : ''}
              onClick={() => setMode('relation')}
            >
              人物关系
            </button>
          </div>
          <button type="button" className="ghost-button" onClick={onBack}>
            返回
          </button>
          {mode === 'map' ? (
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                try {
                  localStorage.removeItem(MAP_POSITIONS_KEY)
                } catch {
                  // 忽略存储失败。
                }
                setLayoutKey((value) => value + 1)
              }}
            >
              重新布局
            </button>
          ) : null}
        </div>
      </div>

      {mode === 'relation' ? (
        <div className="map-relation">
          <div className="map-relation-toolbar">
            <span>选择一本书</span>
            <Select
              value={relationBookId}
              onChange={setRelationBookId}
              ariaLabel="选择关系图书"
              options={relationBooks.map((book) => ({ value: book.id, label: `${book.title}${book.author ? ` · ${book.author}` : ''}` }))}
            />
          </div>
          {selectedRelationBook ? (
            <LabRelationGraph bookId={selectedRelationBook.id} bookTitle={selectedRelationBook.title} />
          ) : (
            <p className="map-empty">书架里还没有书。先导入一本书，再来抽取人物关系。</p>
          )}
        </div>
      ) : (
        <>
      <div className="map-toolbar">
        <input
          className="map-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              focusFirstMatch()
            }
          }}
          placeholder="搜索概念或书名，回车定位…"
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
          <button type="button" onClick={fitGraph} aria-label="重置视图">
            全图
          </button>
          <button type="button" onClick={() => void copyMermaid()} aria-label="复制 Mermaid 图">
            复制 Mermaid
          </button>
          <button type="button" onClick={() => void exportImage()} disabled={imageBusy} aria-label="导出地图图片">
            {imageBusy ? '导出中…' : '导出图片'}
          </button>
        </div>
        {mapNotice ? <span className="map-copy-notice" role="status">{mapNotice}</span> : null}
      </div>

      {error ? <div className="inline-error map-error">{error}</div> : null}
      {data && conceptCount === 0 ? (
        <p className="map-hint">还没有带标签的笔记，概念图暂时为空；你仍然可以在笔记库里浏览全部笔记。</p>
      ) : null}

      <div className="map-stage" ref={stageRef}>
        {loading && !data ? <p className="map-empty">正在整理知识地图…</p> : null}
        {!loading && data && data.nodes.length === 0 ? (
          <p className="map-empty">还没有带标签的笔记。先去读一章生成卡片，地图会从概念里长出来。</p>
        ) : null}
        {data && data.nodes.length > 0 ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onInit={handleInit}
            onSelectionChange={handleSelectionChange}
            onNodeDoubleClick={handleNodeDoubleClick}
            onNodeMouseEnter={handleNodeMouseEnter}
            onNodeMouseLeave={handleNodeMouseLeave}
            onNodeDragStop={handleNodeDragStop}
            onPaneClick={() => {
              setSelected(null)
              setSelectedEdgeId(null)
            }}
            nodesConnectable={false}
            edgesReconnectable={false}
            zoomOnDoubleClick={false}
            multiSelectionKeyCode={null}
            minZoom={0.3}
            maxZoom={3}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--line)" />
            <MiniMap
              position="top-left"
              pannable
              zoomable
              style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
              bgColor="var(--paper-2)"
              maskColor="rgba(251, 248, 241, 0.66)"
              nodeColor={minimapColor}
              nodeStrokeColor={minimapStroke}
              nodeStrokeWidth={2}
              nodeComponent={MiniMapDot}
              ariaLabel="知识地图缩略图"
            />
          </ReactFlow>
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

        {selectedEdge ? (
          <div className="map-edge-detail" role="status">
            <span className="map-edge-detail-kind">{EDGE_KIND_LABEL[selectedEdge.kind]}</span>
            <span className="map-edge-detail-path">
              {selectedEdgeSource?.label ?? selectedEdge.source} → {selectedEdgeTarget?.label ?? selectedEdge.target}
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={() => setSelectedEdgeId(null)}
              aria-label="关闭关系详情"
            >
              ×
            </button>
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
              {detailError ? <p className="inline-error" role="alert">{detailError}</p> : null}
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
        </>
      )}
    </main>
  )
}
