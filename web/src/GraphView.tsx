import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import type { GraphData, GraphLink, GraphNode } from './types'

type Props = {
  graph: GraphData
  focusId: string | null
  mode: 'local' | 'global'
  onSelect: (id: string) => void
}

function neighbors(focusId: string, links: GraphLink[], depth: number): Set<string> {
  const adj = new Map<string, Set<string>>()
  for (const l of links) {
    const s = typeof l.source === 'string' ? l.source : String(l.source)
    const t = typeof l.target === 'string' ? l.target : String(l.target)
    if (!adj.has(s)) adj.set(s, new Set())
    if (!adj.has(t)) adj.set(t, new Set())
    adj.get(s)!.add(t)
    adj.get(t)!.add(s)
  }
  const keep = new Set<string>([focusId])
  let frontier = [focusId]
  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const n of adj.get(id) ?? []) {
        if (!keep.has(n)) {
          keep.add(n)
          next.push(n)
        }
      }
    }
    frontier = next
  }
  return keep
}

export function GraphView({ graph, focusId, mode, onSelect }: Props) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 600, h: 500 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth || 600, h: el.clientHeight || 500 })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth || 600, h: el.clientHeight || 500 })
    return () => ro.disconnect()
  }, [])

  const data = useMemo(() => {
    if (mode === 'global') {
      const degree = new Map<string, number>()
      for (const l of graph.links) {
        degree.set(l.source, (degree.get(l.source) ?? 0) + 1)
        degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
      }
      const keep = new Set<string>()
      for (const n of graph.nodes) {
        if (n.type !== 'word') keep.add(n.id)
        else if ((degree.get(n.id) ?? 0) >= 8) keep.add(n.id)
      }
      return {
        nodes: graph.nodes.filter((n) => keep.has(n.id)).map((n) => ({ ...n })),
        links: graph.links.filter((l) => keep.has(l.source) && keep.has(l.target)).map((l) => ({ ...l })),
      }
    }

    if (!focusId) return { nodes: [] as GraphNode[], links: [] as GraphLink[] }
    const keep = neighbors(focusId, graph.links, 2)
    return {
      nodes: graph.nodes.filter((n) => keep.has(n.id)).map((n) => ({ ...n })),
      links: graph.links
        .filter((l) => keep.has(l.source) && keep.has(l.target))
        .map((l) => ({ ...l })),
    }
  }, [graph, focusId, mode])

  const paint = useCallback(
    (node: GraphNode & { x?: number; y?: number }, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const r = node.type === 'surah' ? 7 : node.type === 'root' ? 6 : 5
      const isFocus = node.id === focusId
      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, isFocus ? r + 2 : r, 0, 2 * Math.PI)
      ctx.fillStyle = node.color
      ctx.fill()
      if (isFocus) {
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5 / globalScale
        ctx.stroke()
      }
      const fontSize = Math.max(11 / globalScale, 3)
      ctx.font = `${fontSize}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = 'rgba(232,239,233,0.92)'
      ctx.fillText(node.label, node.x ?? 0, (node.y ?? 0) + r + 2)
    },
    [focusId],
  )

  useEffect(() => {
    fgRef.current?.d3Force('charge')?.strength(mode === 'global' ? -40 : -140)
    fgRef.current?.d3Force('link')?.distance(mode === 'global' ? 28 : 52)
    if (focusId && data.nodes.length) {
      const t = window.setTimeout(() => {
        fgRef.current?.zoomToFit(450, 48)
      }, 400)
      return () => clearTimeout(t)
    }
  }, [focusId, data, mode])

  return (
    <div className="graph-pane" ref={containerRef}>
      {!focusId && mode === 'local' && (
        <div className="hint">Search a word, root, or surah to open an animated local graph.</div>
      )}
      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={paint as never}
        nodePointerAreaPaint={(node, color, ctx) => {
          const n = node as GraphNode & { x?: number; y?: number }
          ctx.beginPath()
          ctx.arc(n.x ?? 0, n.y ?? 0, 12, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
        }}
        linkColor={() => 'rgba(196,163,90,0.35)'}
        linkWidth={1}
        cooldownTicks={90}
        onNodeClick={(node) => onSelect((node as GraphNode).id)}
        onNodeDragEnd={(node) => {
          const n = node as GraphNode & { fx?: number; fy?: number; x?: number; y?: number }
          n.fx = n.x
          n.fy = n.y
        }}
        enableNodeDrag
        enableZoomInteraction
        enablePanInteraction
      />
      <div className="legend">
        <span>
          <i style={{ background: 'var(--word)' }} /> Words
        </span>
        <span>
          <i style={{ background: 'var(--root)' }} /> Roots
        </span>
        <span>
          <i style={{ background: 'var(--surah)' }} /> Surahs
        </span>
      </div>
    </div>
  )
}
