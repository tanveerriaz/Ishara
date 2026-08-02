import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import type { GraphData, GraphLink, GraphNode } from './types'

type Props = {
  graph: GraphData
  focusId: string | null
  mode: 'local' | 'global'
  onSelect: (id: string) => void
}

type SimNode = GraphNode & { x?: number; y?: number }

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

function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${a})`
}

export function GraphView({ graph, focusId, mode, onSelect }: Props) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 600, h: 500 })
  const timeRef = useRef(0)

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

  // Drive time for glow/orbits. linkDirectionalParticles keeps the canvas ticking.
  useEffect(() => {
    let raf = 0
    const tick = (now: number) => {
      timeRef.current = now / 1000
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const quranNodes = useMemo(
    () => graph.nodes.filter((n) => n.type === 'word' || n.type === 'root' || n.type === 'surah'),
    [graph.nodes],
  )

  const data = useMemo(() => {
    if (mode === 'global') {
      const degree = new Map<string, number>()
      for (const l of graph.links) {
        degree.set(l.source, (degree.get(l.source) ?? 0) + 1)
        degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
      }
      const keep = new Set<string>()
      for (const n of quranNodes) {
        if (n.type !== 'word') keep.add(n.id)
        else if ((degree.get(n.id) ?? 0) >= 8) keep.add(n.id)
      }
      return {
        nodes: quranNodes.filter((n) => keep.has(n.id)).map((n) => ({ ...n })),
        links: graph.links.filter((l) => keep.has(l.source) && keep.has(l.target)).map((l) => ({ ...l })),
      }
    }

    if (!focusId) return { nodes: [] as GraphNode[], links: [] as GraphLink[] }
    const keep = neighbors(focusId, graph.links, 2)
    return {
      nodes: quranNodes.filter((n) => keep.has(n.id)).map((n) => ({ ...n })),
      links: graph.links
        .filter((l) => keep.has(l.source) && keep.has(l.target))
        .map((l) => ({ ...l })),
    }
  }, [graph.links, focusId, mode, quranNodes])

  const paint = useCallback(
    (node: SimNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0
      const y = node.y ?? 0
      const baseR = node.type === 'surah' ? 7 : node.type === 'root' ? 6 : 5
      const isFocus = node.id === focusId
      const t = timeRef.current
      const h = hashId(node.id)
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + (h % 360) * 0.02)
      const r = isFocus ? baseR + 2 + pulse : baseR

      // Soft gold aura
      const aura = r + 5 + pulse * 4
      const grad = ctx.createRadialGradient(x, y, r * 0.2, x, y, aura)
      grad.addColorStop(0, hexToRgba(node.color, isFocus ? 0.55 : 0.28 + pulse * 0.12))
      grad.addColorStop(0.55, hexToRgba(node.color, 0.12))
      grad.addColorStop(1, hexToRgba(node.color, 0))
      ctx.beginPath()
      ctx.arc(x, y, aura, 0, Math.PI * 2)
      ctx.fillStyle = grad
      ctx.fill()

      // Core node
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = node.color
      ctx.fill()
      if (isFocus) {
        ctx.strokeStyle = 'rgba(250,242,214,0.95)'
        ctx.lineWidth = 1.6 / globalScale
        ctx.stroke()
      }

      // Orbiting particles
      const count = node.type === 'surah' ? 5 : node.type === 'root' ? 4 : 3
      const speed = 0.7 + (h % 7) * 0.08
      for (let i = 0; i < count; i++) {
        const ang = t * speed + (i / count) * Math.PI * 2 + (h % 100) * 0.01
        const orbit = r + 7 + (i % 2) * 2.5 + pulse
        const px = x + Math.cos(ang) * orbit
        const py = y + Math.sin(ang) * orbit
        const pr = (1.1 + pulse * 0.5) / Math.max(globalScale * 0.35, 0.75)
        ctx.beginPath()
        ctx.arc(px, py, pr, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(248,197,55,${0.45 + pulse * 0.4})`
        ctx.fill()
      }

      const fontSize = Math.max(11 / globalScale, 3)
      ctx.font = `${fontSize}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = 'rgba(250,242,214,0.92)'
      ctx.fillText(node.label, x, y + r + 3)
    },
    [focusId],
  )

  useEffect(() => {
    fgRef.current?.d3Force('charge')?.strength(mode === 'global' ? -40 : -140)
    fgRef.current?.d3Force('link')?.distance(mode === 'global' ? 28 : 52)
    if (focusId && data.nodes.length) {
      const timer = window.setTimeout(() => {
        fgRef.current?.zoomToFit(450, 48)
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [focusId, data, mode])

  return (
    <div className="graph-pane" ref={containerRef}>
      {!focusId && mode === 'local' && (
        <div className="hint">Search a Qur’anic word, root, or surah to open its meaning graph.</div>
      )}
      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={paint as never}
        nodeCanvasObjectMode={() => 'replace'}
        nodePointerAreaPaint={(node, color, ctx) => {
          const n = node as SimNode
          ctx.beginPath()
          ctx.arc(n.x ?? 0, n.y ?? 0, 14, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
        }}
        linkColor={() => 'rgba(248,197,55,0.28)'}
        linkWidth={1}
        linkDirectionalParticles={mode === 'local' ? 3 : 1}
        linkDirectionalParticleSpeed={mode === 'local' ? 0.006 : 0.003}
        linkDirectionalParticleWidth={mode === 'local' ? 2.2 : 1.4}
        linkDirectionalParticleColor={() => '#f8c537'}
        cooldownTicks={120}
        d3AlphaDecay={0.022}
        onNodeClick={(node) => onSelect((node as GraphNode).id)}
        onNodeDragEnd={(node) => {
          const n = node as SimNode & { fx?: number; fy?: number }
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
