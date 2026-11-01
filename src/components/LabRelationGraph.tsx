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

import type { RelationEdge, RelationGraph, RelationNode, RelationNodeKind } from '../../shared/types.js'
import { exportFlowImage, graphImageFilename } from '../lib/flow-image.js'
import { mermaidFence, relationGraphToMermaid } from '../lib/mermaid-graph.js'

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

type RelationNodeData = {
  node: RelationNode
  radius: number
  /** 同时连接两种以上类型的节点（例如人物同时连着组织和事件）。 */
  cross: boolean
  dim: boolean
  neighbour: boolean
  selected: boolean
}

type RelationFlowNode = Node<RelationNodeData, RelationNodeKind>

type RelationEdgeData = {
  edge: RelationEdge
}

type RelationFlowEdge = Edge<RelationEdgeData>

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

const NODE_LABEL: Record<RelationNode['kind'], string> = {
  person: '人物',
  organization: '组织',
  place: '地点',
  event: '事件',
  concept: '概念',
}

const EDGE_KIND_LABEL: Record<RelationEdge['kind'], string> = {
  family: '亲缘',
  ally: '盟友',
  rival: '敌对',
  suspect: '嫌疑',
  motive: '动机',
  clue: '线索',
  event: '事件牵连',
  other: '其他',
}

const MINIMAP_WIDTH = 148
const MINIMAP_HEIGHT = 104

const EDGE_LABEL_STYLE = {
  fill: 'var(--muted)',
  fontSize: 10,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
}

const EDGE_LABEL_BG_STYLE = { fill: 'var(--paper-2)', fillOpacity: 0.92 }

function radiusFor(node: RelationNode): number {
  const base = NODE_RADIUS[node.kind] ?? 20
  const roleBonus =
    node.kind === 'person' && (node.role === 'detective' || node.role === 'killer')
      ? 8
      : node.kind === 'person' && (node.role === 'victim' || node.role === 'witness')
        ? 5
        : 0
  return base + roleBonus + (node.kind === 'person' && node.importance >= 4 ? 2 : 0)
}

function shortLabel(label: string): string {
  return label.length > 8 ? `${label.slice(0, 7)}…` : label
}

function relationEdgeId(edge: RelationEdge, index: number): string {
  return `${edge.source}:${edge.target}:${edge.label}:${index}`
}

function RelationNodeView({ data }: NodeProps): JSX.Element {
  const { node, radius, cross, dim, neighbour, selected } = data as RelationNodeData
  const size = (radius + 8) * 2
  const center = size / 2
  const className = [
    'relation-node',
    `kind-${node.kind}`,
    `role-${node.role}`,
    cross ? 'is-cross' : '',
    dim ? 'is-dim' : '',
    neighbour ? 'is-neighbour' : '',
    selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} style={{ width: size, height: size }}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <svg
        className="relation-node-svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        <title>{node.description || node.label}</title>
        {cross ? <circle className="relation-node-cross-ring" cx={center} cy={center} r={radius + 4} /> : null}
        <circle className="relation-node-dot" cx={center} cy={center} r={radius} />
        <text className="relation-node-label" x={center} y={center + 4} textAnchor="middle">
          {shortLabel(node.label)}
        </text>
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
  person: RelationNodeView,
  organization: RelationNodeView,
  place: RelationNodeView,
  event: RelationNodeView,
  concept: RelationNodeView,
}

function minimapColor(node: Node): string {
  const kind = (node as RelationFlowNode).data?.node?.kind
  switch (kind) {
    case 'person':
      return 'var(--accent)'
    case 'organization':
      return 'var(--ai)'
    case 'event':
      return 'var(--warn)'
    case 'place':
      return 'var(--line-strong)'
    default:
      return 'var(--paper-3)'
  }
}

function minimapStroke(): string {
  return 'var(--paper-2)'
}

export function LabRelationGraph({ bookId, bookTitle }: LabRelationGraphProps): JSX.Element {
  const [graph, setGraph] = useState<RelationGraph | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [layoutKey, setLayoutKey] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [imageBusy, setImageBusy] = useState(false)
  const [nodes, setNodes, onNodesChange] = useNodesState<RelationFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelationFlowEdge>([])
  const flowRef = useRef<ReactFlowInstance<RelationFlowNode, RelationFlowEdge> | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const centerByIdRef = useRef<Map<string, { x: number; y: number }>>(new Map())

  useEffect(() => {
    let cancelled = false
    setGraph(null)
    setNodes([])
    setEdges([])
    setSelectedId(null)
    setSelectedEdgeId(null)
    setHovered(null)
    setError(null)
    setNotice(null)
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
  }, [bookId, setEdges, setNodes])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  // Escape 同时退出全屏并清除选中；React Flow 自己也用 Escape 取消选中，这里保持状态一致。
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      if (fullscreen) setFullscreen(false)
      setSelectedId(null)
      setSelectedEdgeId(null)
      setHovered(null)
      setNodes((current) =>
        current.some((node) => node.selected)
          ? current.map((node) => (node.selected ? { ...node, selected: false } : node))
          : current,
      )
      setEdges((current) =>
        current.some((edge) => edge.selected)
          ? current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge))
          : current,
      )
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen, setEdges, setNodes])

  // 全屏容器尺寸变化后补一次 fitView，否则 React Flow 仍按旧视口取景。
  useEffect(() => {
    if (!fullscreen) return
    const timer = window.setTimeout(() => {
      void flowRef.current?.fitView({ padding: 0.16, duration: 0 })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [fullscreen])

  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map((node) => [node.id, node])), [graph])

  const edgeEntries = useMemo(
    () => (graph?.edges ?? []).map((edge, index) => ({ edge, id: relationEdgeId(edge, index) })),
    [graph],
  )

  const selectedEdge = useMemo(
    () => edgeEntries.find((entry) => entry.id === selectedEdgeId)?.edge ?? null,
    [edgeEntries, selectedEdgeId],
  )

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const node of graph?.nodes ?? []) map.set(node.id, new Set())
    for (const edge of graph?.edges ?? []) {
      map.get(edge.source)?.add(edge.target)
      map.get(edge.target)?.add(edge.source)
    }
    return map
  }, [graph])

  // 跨类节点：连接的节点类型不止一种，用虚线外圈标出来。
  const crossById = useMemo(() => {
    const kindsById = new Map<string, Set<RelationNode['kind']>>()
    for (const edge of graph?.edges ?? []) {
      const source = nodeById.get(edge.source)
      const target = nodeById.get(edge.target)
      if (!source || !target) continue
      if (!kindsById.has(source.id)) kindsById.set(source.id, new Set())
      if (!kindsById.has(target.id)) kindsById.set(target.id, new Set())
      kindsById.get(source.id)!.add(target.kind)
      kindsById.get(target.id)!.add(source.kind)
    }
    const cross = new Map<string, boolean>()
    for (const [id, kinds] of kindsById) cross.set(id, kinds.size > 1)
    return cross
  }, [graph, nodeById])

  const activeNodeIds = useMemo(() => {
    const active = new Set<string>()
    if (hovered) {
      active.add(hovered)
      adjacency.get(hovered)?.forEach((id) => active.add(id))
    } else if (selectedEdge) {
      active.add(selectedEdge.source)
      active.add(selectedEdge.target)
    } else if (selectedId) {
      active.add(selectedId)
      adjacency.get(selectedId)?.forEach((id) => active.add(id))
    }
    return active
  }, [adjacency, hovered, selectedEdge, selectedId])

  // d3-force 只负责计算坐标；缩放、平移、拖拽和选中都交给 React Flow。
  useEffect(() => {
    if (!graph) return
    const ids = new Set(graph.nodes.map((node) => node.id))
    const simNodes: SimNode[] = graph.nodes.map((node, index) => ({
      ...node,
      radius: radiusFor(node),
      x: 600 + Math.cos((index / Math.max(1, graph.nodes.length)) * Math.PI * 2) * 180,
      y: 380 + Math.sin((index / Math.max(1, graph.nodes.length)) * Math.PI * 2) * 160,
    }))
    const simLinks: SimLink[] = graph.edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
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
    for (let tick = 0; tick < 240; tick++) simulation.tick()
    simulation.stop()

    const centers = new Map<string, { x: number; y: number }>()
    const flowNodes: RelationFlowNode[] = simNodes.map((simNode) => {
      const original = nodeById.get(simNode.id) ?? simNode
      const size = (simNode.radius + 8) * 2
      const x = simNode.x ?? 600
      const y = simNode.y ?? 380
      centers.set(simNode.id, { x, y })
      return {
        id: simNode.id,
        type: original.kind,
        position: { x, y },
        origin: [0.5, 0.5],
        width: size,
        height: size,
        ariaLabel: `${original.label}（${NODE_LABEL[original.kind]}）`,
        ariaRole: 'button',
        data: {
          node: original,
          radius: simNode.radius,
          cross: crossById.get(original.id) ?? false,
          dim: false,
          neighbour: false,
          selected: false,
        },
      }
    })

    const flowEdges: RelationFlowEdge[] = edgeEntries.map(({ edge, id }) => {
      const source = nodeById.get(edge.source)?.label ?? edge.source
      const target = nodeById.get(edge.target)?.label ?? edge.target
      return {
        id,
        source: edge.source,
        target: edge.target,
        type: 'straight',
        interactionWidth: 18,
        className: `relation-edge kind-${edge.kind}`,
        label: edge.label,
        labelShowBg: true,
        labelStyle: EDGE_LABEL_STYLE,
        labelBgStyle: EDGE_LABEL_BG_STYLE,
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 3,
        ariaLabel: `${source} ${edge.label} ${target}`,
        data: { edge },
      }
    })

    centerByIdRef.current = centers
    setNodes(flowNodes)
    setEdges(flowEdges)

    const frame = requestAnimationFrame(() => {
      void flowRef.current?.fitView({ padding: 0.16, duration: 0 })
    })
    return () => cancelAnimationFrame(frame)
  }, [crossById, edgeEntries, graph, layoutKey, nodeById, setEdges, setNodes])

  // 选中、悬停只更新节点 data，不碰 position，避免拖拽后的位置被重置。
  useEffect(() => {
    setNodes((current) => {
      let changed = false
      const next = current.map((flowNode) => {
        const id = flowNode.data.node.id
        const dim = activeNodeIds.size > 0 && !activeNodeIds.has(id)
        const neighbour = Boolean(selectedId && selectedId !== id && adjacency.get(selectedId)?.has(id))
        const selected = id === selectedId
        if (
          flowNode.data.dim === dim &&
          flowNode.data.neighbour === neighbour &&
          flowNode.data.selected === selected
        ) {
          return flowNode
        }
        changed = true
        return { ...flowNode, data: { ...flowNode.data, dim, neighbour, selected } }
      })
      return changed ? next : current
    })
  }, [activeNodeIds, adjacency, layoutKey, selectedId, setNodes])

  useEffect(() => {
    const focusId = hovered ?? selectedId
    setEdges((current) => {
      let changed = false
      const next = current.map((edge) => {
        const picked = edge.id === selectedEdgeId
        const active = selectedEdgeId
          ? picked
          : Boolean(focusId && (edge.source === focusId || edge.target === focusId))
        const dim = selectedEdgeId ? !picked : focusId ? !active : false
        const reverse = Boolean(selectedId && edge.target === selectedId)
        const edgeLabel = reverse
          ? edge.data?.edge.reverseLabel || edge.data?.edge.label || ''
          : edge.data?.edge.label ?? ''
        const className = `relation-edge kind-${edge.data?.edge.kind ?? 'other'}${active ? ' is-active' : ''}${
          dim ? ' is-dim' : ''
        }${picked ? ' is-picked' : ''}`
        if (edge.className === className && edge.label === edgeLabel) return edge
        changed = true
        return { ...edge, className, label: edgeLabel }
      })
      return changed ? next : current
    })
  }, [hovered, layoutKey, selectedEdgeId, selectedId, setEdges])

  const selected = useMemo(
    () => (selectedId ? nodeById.get(selectedId) ?? null : null),
    [nodeById, selectedId],
  )

  const selectedRelations = useMemo(() => {
    if (!graph || !selectedId) return []
    return graph.edges
      .filter((edge) => edge.source === selectedId || edge.target === selectedId)
      .map((edge) => {
        const outgoing = edge.source === selectedId
        return {
          edge,
          label: outgoing ? edge.label : edge.reverseLabel || edge.label,
          other: nodeById.get(outgoing ? edge.target : edge.source),
        }
      })
  }, [graph, nodeById, selectedId])

  const selectedEdgeSource = selectedEdge ? nodeById.get(selectedEdge.source) ?? null : null
  const selectedEdgeTarget = selectedEdge ? nodeById.get(selectedEdge.target) ?? null : null
  const mermaidSource = useMemo(() => (graph ? relationGraphToMermaid(graph) : ''), [graph])

  const clearSelection = useCallback(() => {
    setSelectedId(null)
    setSelectedEdgeId(null)
    setHovered(null)
    setNodes((current) =>
      current.some((node) => node.selected)
        ? current.map((node) => (node.selected ? { ...node, selected: false } : node))
        : current,
    )
    setEdges((current) =>
      current.some((edge) => edge.selected)
        ? current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge))
        : current,
    )
  }, [setEdges, setNodes])

  const selectNode = useCallback(
    (id: string | null) => {
      setSelectedId(id)
      setSelectedEdgeId(null)
      setNodes((current) => {
        let changed = false
        const next = current.map((node) => {
          const selected = node.id === id
          if ((node.selected ?? false) === selected) return node
          changed = true
          return { ...node, selected }
        })
        return changed ? next : current
      })
      setEdges((current) =>
        current.some((edge) => edge.selected)
          ? current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge))
          : current,
      )
    },
    [setEdges, setNodes],
  )

  const handleInit = useCallback(
    (instance: ReactFlowInstance<RelationFlowNode, RelationFlowEdge>) => {
      flowRef.current = instance
      if (instance.getNodes().length > 0) {
        requestAnimationFrame(() => {
          void instance.fitView({ padding: 0.16, duration: 0 }).then(() => setZoom(instance.getZoom()))
        })
      }
    },
    [],
  )

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams<RelationFlowNode, RelationFlowEdge>) => {
      const nodeId = selectedNodes[0]?.id ?? null
      if (nodeId) {
        setSelectedId(nodeId)
        setSelectedEdgeId(null)
        return
      }
      setSelectedId(null)
      setSelectedEdgeId(selectedEdges[0]?.id ?? null)
    },
    [],
  )

  const handleNodeMouseEnter = useCallback((_event: ReactMouseEvent, node: RelationFlowNode) => {
    setHovered(node.id)
  }, [])

  const handleNodeMouseLeave = useCallback(() => {
    setHovered(null)
  }, [])

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

  function selectAndFocus(id: string): void {
    selectNode(id)
    focusNode(id)
  }

  async function exportGraph(): Promise<void> {
    if (!graph) return
    setError(null)
    const kindLabel = NODE_LABEL
    const markdown = [
      `# ${graph.title}`,
      graph.genre ? `体裁：${graph.genre}` : '',
      graph.summary ? `\n${graph.summary}` : '',
      graph.plot ? `\n## 情节梗概（含剧透）\n\n${graph.plot}` : '',
      '\n## 关系图\n',
      mermaidFence(mermaidSource),
      '\n## 节点\n',
      ...graph.nodes.map((node) => {
        const facts = [node.identity, node.rank, node.affiliation].filter(Boolean).join(' / ')
        const role =
          node.kind === 'person' && node.role !== 'other' ? ` · ${ROLE_LABEL[node.role]}` : ''
        const chapters = node.chapters?.length ? ` · 出处：${node.chapters.join('、')}` : ''
        return `- **${node.label}**（${kindLabel[node.kind]}${role}${facts ? ` · ${facts}` : ''}）${node.description ? `：${node.description}` : ''}${chapters}`
      }),
      '\n## 关系\n',
      ...graph.edges.map((edge) => {
        const source = nodeById.get(edge.source)?.label ?? edge.source
        const target = nodeById.get(edge.target)?.label ?? edge.target
        const chapters = edge.chapters?.length ? `（出处：${edge.chapters.join('、')}）` : ''
        const reverse =
          edge.reverseLabel && edge.reverseLabel !== edge.label
            ? ` · 反向：${target} — ${edge.reverseLabel} — ${source}`
            : ''
        return `- ${source} — ${edge.label} — ${target}${edge.description ? `：${edge.description}` : ''}${chapters}${reverse}`
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

  async function copyMermaid(): Promise<void> {
    if (!mermaidSource) return
    setError(null)
    try {
      await window.api.copyText(mermaidSource)
      setNotice('Mermaid 代码已复制，可粘贴到支持 Mermaid 的 Markdown 或 HTML。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function exportImage(): Promise<void> {
    if (imageBusy || !graph) return
    setImageBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await exportFlowImage({
        root: canvasRef.current,
        nodes: flowRef.current?.getNodes() ?? [],
        filename: graphImageFilename('人物关系图'),
      })
      if (result.saved) setNotice(`已保存到 ${result.path ?? '图片'}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImageBusy(false)
    }
  }

  async function generate(): Promise<void> {
    if (!bookId || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const next = await window.api.generateRelationGraph(bookId)
      setGraph(next)
      setSelectedId(next.nodes[0]?.id ?? null)
      setSelectedEdgeId(null)
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
                导出 Markdown
              </button>
              <button type="button" className="ghost-button small" onClick={() => void copyMermaid()}>
                导出 Mermaid
              </button>
              <button type="button" className="ghost-button small" onClick={() => void exportImage()} disabled={imageBusy}>
                {imageBusy ? '导出中…' : '导出图片'}
              </button>
              <button type="button" className="ghost-button small" onClick={() => setFullscreen((value) => !value)}>
                {fullscreen ? '退出全屏' : '全屏'}
              </button>
            </>
          ) : null}
          <button type="button" className="primary-button small" onClick={() => void generate()} disabled={busy}>
            {busy ? '抽取中…' : graph ? '重新生成' : '生成关系图'}
          </button>
          {busy ? (
            <button type="button" className="ghost-button small" onClick={() => void window.api.cancelLab()}>
              取消
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      {notice ? <p className="relation-notice" role="status">{notice}</p> : null}

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
            <div className="relation-canvas" ref={canvasRef}>
              <div className="relation-canvas-tools">
                <button type="button" onClick={() => zoomBy(1.18)} aria-label="放大">＋</button>
                <button type="button" onClick={() => zoomBy(0.85)} aria-label="缩小">−</button>
                <button type="button" onClick={fitGraph} aria-label="全图">全图</button>
                <span>{Math.round(zoom * 100)}%</span>
              </div>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onInit={handleInit}
                onSelectionChange={handleSelectionChange}
                onNodeMouseEnter={handleNodeMouseEnter}
                onNodeMouseLeave={handleNodeMouseLeave}
                onPaneClick={clearSelection}
                onMove={(_event, viewport) => setZoom(viewport.zoom)}
                nodesConnectable={false}
                edgesReconnectable={false}
                zoomOnDoubleClick={false}
                multiSelectionKeyCode={null}
                deleteKeyCode={null}
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
                  ariaLabel="人物关系图缩略图"
                />
              </ReactFlow>

              {selectedEdge ? (
                <div className="relation-edge-detail" role="status">
                  <span className="relation-edge-detail-kind">{EDGE_KIND_LABEL[selectedEdge.kind]}</span>
                  <div className="relation-edge-detail-main">
                    <strong>
                      {selectedEdgeSource?.label ?? selectedEdge.source}
                      <i> → {selectedEdge.label} → </i>
                      {selectedEdgeTarget?.label ?? selectedEdge.target}
                    </strong>
                    {selectedEdge.description ? <p>{selectedEdge.description}</p> : null}
                    {selectedEdge.chapters?.length ? <small>出处：{selectedEdge.chapters.join('、')}</small> : null}
                    {selectedEdge.reverseLabel && selectedEdge.reverseLabel !== selectedEdge.label ? (
                      <small className="relation-edge-detail-reverse">
                        反向：{selectedEdgeTarget?.label ?? selectedEdge.target} — {selectedEdge.reverseLabel} —{' '}
                        {selectedEdgeSource?.label ?? selectedEdge.source}
                      </small>
                    ) : null}
                  </div>
                  <button type="button" className="icon-button" onClick={clearSelection} aria-label="关闭关系详情">
                    ×
                  </button>
                </div>
              ) : null}
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
                  {(selected.aliases?.length ?? 0) > 0 ? (
                    <p className="relation-aliases">别名：{selected.aliases?.join('、')}</p>
                  ) : null}
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
                        onClick={() => other && selectAndFocus(other.id)}
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
                <span>
                  <i className="kind-cross" />
                  跨类关联
                </span>
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
