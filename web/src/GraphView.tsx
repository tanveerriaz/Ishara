import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import type { GraphData, GraphLink, GraphNode } from './types'

/** Obsidian graph group colors (from vault/.obsidian/graph.json). */
export const OBSIDIAN_COLORS = {
  word: '#c95e27',
  root: '#f8cd37',
  surah: '#ffbf00',
} as const

type Props = {
  graph: GraphData
  focusId: string | null
  mode: 'local' | 'global'
  onSelect: (id: string) => void
}

type SimNode = GraphNode & { x?: number; y?: number; vx?: number; vy?: number }

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

function nodeColor(type: GraphNode['type']): string {
  return OBSIDIAN_COLORS[type] ?? OBSIDIAN_COLORS.word
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

  // Smooth continuous motion like Obsidian's Animate toggle.
  useEffect(() => {
    let raf = 0
    let lastReheat = 0
    const tick = (now: number) => {
      timeRef.current = now / 1000
      const fg = fgRef.current as ForceGraphMethods & {
        d3ReheatSimulation?: () => void
        d3AlphaTarget?: (n: number) => void
      }
      // Tiny periodic reheat keeps the cloud gently drifting
      if (now - lastReheat > 2800) {
        lastReheat = now
        fg?.d3AlphaTarget?.(0.04)
        fg?.d3ReheatSimulation?.()
        window.setTimeout(() => fg?.d3AlphaTarget?.(0), 900)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const quranNodes = useMemo(
    () =>
      graph.nodes
        .filter((n) => n.type === 'word' || n.type === 'root' || n.type === 'surah')
        .map((n) => ({ ...n, color: nodeColor(n.type) })),
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
      const color = nodeColor(node.type)
      const baseR = node.type === 'surah' ? 6.5 : node.type === 'root' ? 5.5 : 4.5
      const isFocus = node.id === focusId
      const t = timeRef.current
      const h = hashId(node.id)
      // Slow breathe — closer to Obsidian glow than busy sparkles
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.15 + (h % 360) * 0.017)
      const r = isFocus ? baseR + 1.8 + pulse * 0.6 : baseR

      const aura = r + 3.5 + pulse * 2.2
      const grad = ctx.createRadialGradient(x, y, 0, x, y, aura)
      grad.addColorStop(0, hexToRgba(color, isFocus ? 0.65 : 0.38 + pulse * 0.1))
      grad.addColorStop(0.45, hexToRgba(color, 0.14))
      grad.addColorStop(1, hexToRgba(color, 0))
      ctx.beginPath()
      ctx.arc(x, y, aura, 0, Math.PI * 2)
      ctx.fillStyle = grad
      ctx.fill()

      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      if (isFocus) {
        ctx.strokeStyle = 'rgba(250,242,214,0.9)'
        ctx.lineWidth = 1.4 / globalScale
        ctx.stroke()
      }

      // Soft orbiting motes (fewer, slower)
      const count = isFocus ? 4 : node.type === 'root' ? 3 : 2
      const speed = 0.35 + (h % 5) * 0.04
      for (let i = 0; i < count; i++) {
        const ang = t * speed + (i / count) * Math.PI * 2
        const orbit = r + 5.5 + pulse * 1.2
        const px = x + Math.cos(ang) * orbit
        const py = y + Math.sin(ang) * orbit
        const pr = (0.9 + pulse * 0.35) / Math.max(globalScale * 0.4, 0.8)
        ctx.beginPath()
        ctx.arc(px, py, pr, 0, Math.PI * 2)
        ctx.fillStyle = hexToRgba(OBSIDIAN_COLORS.root, 0.4 + pulse * 0.35)
        ctx.fill()
      }

      if (globalScale > 0.55 || isFocus) {
        const fontSize = Math.max(10 / globalScale, 2.8)
        ctx.font = `${fontSize}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = 'rgba(250,242,214,0.88)'
        ctx.fillText(node.label, x, y + r + 2)
      }
    },
    [focusId],
  )

  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return

    // Obsidian-like forces: soft center, strong repel, longer links
    const charge = mode === 'global' ? -55 : -160
    const dist = mode === 'global' ? 36 : 70
    fg.d3Force('charge')?.strength(charge)
    fg.d3Force('link')?.distance(dist)?.strength(0.55)
    const center = fg.d3Force('center') as { strength?: (n: number) => void } | undefined
    center?.strength?.(mode === 'global' ? 0.05 : 0.08)

    ;(fg as ForceGraphMethods & { d3VelocityDecay?: (n: number) => void }).d3VelocityDecay?.(0.28)
    fg.d3ReheatSimulation()

    if (focusId && data.nodes.length) {
      const timer = window.setTimeout(() => fg.zoomToFit(700, 56), 500)
      return () => clearTimeout(timer)
    }
    if (mode === 'global' && data.nodes.length) {
      const timer = window.setTimeout(() => fg.zoomToFit(900, 40), 700)
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
        linkColor={() => 'rgba(248,205,55,0.22)'}
        linkWidth={0.7}
        linkDirectionalParticles={mode === 'local' ? 2 : 1}
        linkDirectionalParticleSpeed={0.0028}
        linkDirectionalParticleWidth={1.6}
        linkDirectionalParticleColor={() => OBSIDIAN_COLORS.root}
        cooldownTicks={Infinity}
        d3AlphaDecay={0.008}
        d3AlphaMin={0.001}
        warmupTicks={40}
        onNodeClick={(node) => onSelect((node as GraphNode).id)}
        onNodeDragEnd={(node) => {
          // Release pin so the cloud keeps drifting (Obsidian-like)
          const n = node as SimNode & { fx?: number | null; fy?: number | null }
          n.fx = undefined
          n.fy = undefined
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
