import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import type { GraphData, GraphLink, GraphNode } from './types'

/**
 * Visual language matches vault/.obsidian/graph.json (Wasp / Obsidian groups):
 * Words #c95e27 · Roots #f8cd37 · Surahs #ffbf00
 * Forces inspired by Obsidian: centerStrength, repelStrength, linkDistance, Animate.
 */
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
  lowPower?: boolean
  /** Obsidian-like Animate: soft glow, particles, gentle drift. */
  animate?: boolean
}

type SimNode = GraphNode & {
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  __userPinned?: boolean
  __hoverPushed?: boolean
  __hoverOx?: number
  __hoverOy?: number
}

function buildAdj(links: GraphLink[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>()
  for (const l of links) {
    const s = typeof l.source === 'string' ? l.source : String(l.source)
    const t = typeof l.target === 'string' ? l.target : String(l.target)
    if (!adj.has(s)) adj.set(s, new Set())
    if (!adj.has(t)) adj.set(t, new Set())
    adj.get(s)!.add(t)
    adj.get(t)!.add(s)
  }
  return adj
}

/**
 * Local cluster: focus + its root/word neighbors + sibling lemmas via root,
 * plus a capped set of surahs. Avoids BFS-through-surahs (explodes via hubs
 * and, under maxNodes, drops real neighbors — leaving only focus+root).
 */
function localCluster(
  focusId: string,
  adj: Map<string, Set<string>>,
  nodes: GraphNode[],
  maxNodes: number,
): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const keep = new Set<string>([focusId])

  for (const n of adj.get(focusId) ?? []) {
    const t = byId.get(n)?.type
    if (t === 'word' || t === 'root') keep.add(n)
  }

  const roots = [...keep].filter((id) => byId.get(id)?.type === 'root')
  if (byId.get(focusId)?.type === 'root') roots.push(focusId)
  for (const rid of new Set(roots)) {
    keep.add(rid)
    for (const n of adj.get(rid) ?? []) {
      if (byId.get(n)?.type === 'word') keep.add(n)
    }
  }

  // Prefer surahs directly linked to the focus (all of them if they fit),
  // then fill remaining budget from sibling words' surahs.
  const surahBudget = Math.min(32, Math.max(8, Math.floor(maxNodes * 0.55)))
  const surahs: string[] = []
  const addSurah = (id: string) => {
    if (byId.get(id)?.type !== 'surah' || surahs.includes(id)) return
    surahs.push(id)
  }
  for (const n of adj.get(focusId) ?? []) addSurah(n)
  if (surahs.length < surahBudget) {
    for (const id of [...keep]) {
      if (byId.get(id)?.type !== 'word') continue
      for (const n of adj.get(id) ?? []) {
        addSurah(n)
        if (surahs.length >= surahBudget) break
      }
      if (surahs.length >= surahBudget) break
    }
  }
  for (const s of surahs.slice(0, surahBudget)) keep.add(s)

  if (keep.size <= maxNodes) return keep

  // Prefer focus, then its direct neighbors, then roots/words/surahs.
  const direct = adj.get(focusId) ?? new Set()
  const typeRank = (t: GraphNode['type'] | undefined) =>
    t === 'root' ? 0 : t === 'word' ? 1 : t === 'surah' ? 2 : 3
  return new Set(
    [...keep]
      .sort((a, b) => {
        if (a === focusId) return -1
        if (b === focusId) return 1
        const da = direct.has(a) ? 0 : 1
        const db = direct.has(b) ? 0 : 1
        if (da !== db) return da - db
        return typeRank(byId.get(a)?.type) - typeRank(byId.get(b)?.type)
      })
      .slice(0, maxNodes),
  )
}

function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function seedXY(id: string): { x: number; y: number } {
  const h = hashId(id)
  return { x: (h % 900) - 450, y: ((h >>> 10) % 700) - 350 }
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

function degreeMap(links: GraphLink[]): Map<string, number> {
  const degree = new Map<string, number>()
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1)
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
  }
  return degree
}

function connectedSubgraph(
  nodes: GraphNode[],
  links: GraphLink[],
  focusId?: string | null,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const used = new Set<string>()
  for (const l of links) {
    used.add(l.source)
    used.add(l.target)
  }
  if (focusId) used.add(focusId)
  return {
    nodes: nodes.filter((n) => used.has(n.id)),
    links: links.filter((l) => used.has(l.source) && used.has(l.target)),
  }
}

function globalKeepIds(nodes: GraphNode[], links: GraphLink[], lowPower: boolean): Set<string> {
  const degree = degreeMap(links)
  if (!lowPower) {
    const keep = new Set<string>()
    for (const n of nodes) {
      if (n.type !== 'word') keep.add(n.id)
      else if ((degree.get(n.id) ?? 0) >= 8) keep.add(n.id)
    }
    return keep
  }
  const words = nodes
    .filter((n) => n.type === 'word')
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
    .slice(0, 70)
  const roots = nodes
    .filter((n) => n.type === 'root')
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
    .slice(0, 45)
  const keep = new Set<string>()
  for (const n of words) keep.add(n.id)
  for (const n of roots) keep.add(n.id)
  return keep
}

function displayLabel(node: GraphNode): string {
  const raw = (node.label || '').trim()
  const title = node.title || node.slug || ''
  const parts = title.includes(' - ') ? title.split(' - ') : null
  const meaningFromTitle = parts ? parts.slice(1).join(' - ').trim() : ''
  const bwHead = parts ? parts[0].trim() : ''
  const looksBw =
    /^[A-Za-z$'>]{2,8}$/.test(raw) &&
    (!/[aeiouAEIOU]/.test(raw) || raw.toLowerCase() === bwHead.toLowerCase())
  if (looksBw && meaningFromTitle && meaningFromTitle.toLowerCase() !== raw.toLowerCase()) {
    return meaningFromTitle
  }
  if (bwHead && raw === bwHead && meaningFromTitle) return meaningFromTitle
  return raw || meaningFromTitle || title
}

function refreshGraph(fg: ForceGraphMethods | undefined) {
  try {
    ;(fg as { refresh?: () => void } | undefined)?.refresh?.()
  } catch {
    /* ignore */
  }
}

export function GraphView({ graph, focusId, mode, onSelect, lowPower = false, animate = true }: Props) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const posCache = useRef(new Map<string, { x: number; y: number }>())
  const nodesRef = useRef<SimNode[]>([])
  const hoverIdRef = useRef<string | null>(null)
  const fittedFor = useRef<string | null>(null)
  const [size, setSize] = useState({ w: 600, h: 500 })
  const liveAnimate = animate && !lowPower

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

  // Obsidian “Animate”: soft redraw loop (no React setState).
  useEffect(() => {
    if (!liveAnimate) return
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      if (now - last > 40) {
        last = now
        refreshGraph(fgRef.current)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [liveAnimate])

  const quranNodes = useMemo(
    () =>
      graph.nodes
        .filter((n) => n.type === 'word' || n.type === 'root' || n.type === 'surah')
        .map((n) => ({ ...n, color: nodeColor(n.type) })),
    [graph.nodes],
  )

  const adj = useMemo(() => buildAdj(graph.links), [graph.links])

  const data = useMemo(() => {
    const withCachedPos = (nodes: GraphNode[]): SimNode[] =>
      nodes.map((n) => {
        const cached = posCache.current.get(n.id)
        const seed = seedXY(n.id)
        return {
          ...n,
          color: nodeColor(n.type),
          x: cached?.x ?? seed.x,
          y: cached?.y ?? seed.y,
        }
      })

    if (mode === 'global') {
      const keep = globalKeepIds(quranNodes, graph.links, lowPower)
      const byId = new Map(quranNodes.map((n) => [n.id, n]))
      let links = graph.links
        .filter((l) => keep.has(l.source) && keep.has(l.target))
        .map((l) => ({ ...l }))
      if (lowPower) {
        links = links
          .filter((l) => {
            const a = byId.get(l.source)?.type
            const b = byId.get(l.target)?.type
            return a !== 'surah' && b !== 'surah'
          })
          .slice(0, 800)
      }
      return connectedSubgraph(
        withCachedPos(quranNodes.filter((n) => keep.has(n.id))),
        links,
        null,
      )
    }

    if (!focusId) return { nodes: [] as SimNode[], links: [] as GraphLink[] }
    const maxNodes = lowPower ? 80 : 110
    const keep = localCluster(focusId, adj, quranNodes, maxNodes)
    return connectedSubgraph(
      withCachedPos(quranNodes.filter((n) => keep.has(n.id))),
      graph.links.filter((l) => keep.has(l.source) && keep.has(l.target)).map((l) => ({ ...l })),
      focusId,
    )
  }, [graph.links, focusId, mode, quranNodes, adj, lowPower])

  nodesRef.current = data.nodes as SimNode[]

  // Persist positions so clicking another node doesn’t explode the layout.
  useEffect(() => {
    for (const n of data.nodes as SimNode[]) {
      if (n.x != null && n.y != null) posCache.current.set(n.id, { x: n.x, y: n.y })
    }
  })

  const clearHoverParting = useCallback(() => {
    for (const n of nodesRef.current) {
      if (!n.__hoverPushed) continue
      if (!n.__userPinned && n.__hoverOx != null && n.__hoverOy != null) {
        n.x = n.__hoverOx
        n.y = n.__hoverOy
        n.fx = undefined
        n.fy = undefined
      }
      delete n.__hoverPushed
      delete n.__hoverOx
      delete n.__hoverOy
    }
  }, [])

  const onNodeHover = useCallback(
    (node: object | null) => {
      const n = node as SimNode | null
      clearHoverParting()
      if (!n) {
        hoverIdRef.current = null
        refreshGraph(fgRef.current)
        return
      }
      hoverIdRef.current = n.id
      const hx = n.x ?? 0
      const hy = n.y ?? 0
      const clearR = mode === 'local' ? 34 : 26
      for (const o of nodesRef.current) {
        if (o.id === n.id || o.__userPinned) continue
        const ox = o.x ?? 0
        const oy = o.y ?? 0
        let dx = ox - hx
        let dy = oy - hy
        let dist = Math.hypot(dx, dy)
        if (dist < 0.05) {
          dx = 1
          dy = 0
          dist = 0.05
        }
        if (dist >= clearR) continue
        o.__hoverOx = ox
        o.__hoverOy = oy
        o.__hoverPushed = true
        const push = (clearR - dist) * 0.5
        const nx = hx + (dx / dist) * (dist + push)
        const ny = hy + (dy / dist) * (dist + push)
        o.x = nx
        o.y = ny
        o.fx = nx
        o.fy = ny
      }
      refreshGraph(fgRef.current)
    },
    [clearHoverParting, mode],
  )

  const paint = useCallback(
    (node: SimNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0
      const y = node.y ?? 0
      const color = nodeColor(node.type)
      const isFocus = node.id === focusId
      const isHover = node.id === hoverIdRef.current
      // Obsidian nodeSizeMultiplier ~1.1
      const baseR = (node.type === 'surah' ? 6.2 : node.type === 'root' ? 5.4 : 4.6) * 1.1
      const h = hashId(node.id)
      const t = performance.now() / 1000
      const pulse = liveAnimate ? 0.5 + 0.5 * Math.sin(t * 1.05 + (h % 360) * 0.017) : 0
      const r = isFocus || isHover ? baseR + 1.4 + pulse * 0.35 : baseR

      if (liveAnimate) {
        const aura = r + 2.8 + pulse * 1.4
        const grad = ctx.createRadialGradient(x, y, 0, x, y, aura)
        grad.addColorStop(0, hexToRgba(color, isFocus || isHover ? 0.58 : 0.28 + pulse * 0.06))
        grad.addColorStop(0.55, hexToRgba(color, 0.1))
        grad.addColorStop(1, hexToRgba(color, 0))
        ctx.beginPath()
        ctx.arc(x, y, aura, 0, Math.PI * 2)
        ctx.fillStyle = grad
        ctx.fill()
      }

      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()

      if (isFocus || isHover) {
        ctx.strokeStyle = 'rgba(250,242,214,0.9)'
        ctx.lineWidth = 1.35 / Math.max(globalScale, 0.05)
        ctx.stroke()
      }

      // textFadeMultiplier: 0 in Obsidian → labels visible when zoomed enough
      const showLabel = isFocus || isHover || globalScale > (mode === 'local' ? 0.45 : 0.65)
      if (!showLabel) return

      const fontSize = Math.max(11 / Math.max(globalScale, 0.05), 2.6)
      ctx.font = `${fontSize}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = 'rgba(250,242,214,0.9)'
      ctx.fillText(displayLabel(node), x, y + r + 2)
    },
    [focusId, liveAnimate, mode],
  )

  // Obsidian-like forces (mapped from graph.json) + one soft zoom fit.
  useEffect(() => {
    hoverIdRef.current = null
    const fg = fgRef.current
    if (!fg || !data.nodes.length) return

    // Obsidian: repelStrength 12, linkDistance 250, centerStrength 0.4, linkStrength 1
    // Canvas units are smaller — scale into a comfortable web range.
    const charge = mode === 'global' ? (lowPower ? -36 : -52) : lowPower ? -95 : -125
    const dist = mode === 'global' ? (lowPower ? 34 : 42) : lowPower ? 58 : 72
    fg.d3Force('charge')?.strength(charge)
    fg.d3Force('link')?.distance(dist)?.strength(mode === 'local' ? 0.85 : 0.65)
    const center = fg.d3Force('center') as { strength?: (n: number) => void } | undefined
    center?.strength?.(mode === 'global' ? 0.08 : 0.14)

    const fgExt = fg as ForceGraphMethods & {
      d3ReheatSimulation?: () => void
      d3AlphaTarget?: (n: number) => void
    }
    fgExt.d3AlphaTarget?.(0)
    fgExt.d3ReheatSimulation?.()

    const token = `${mode}:${focusId ?? 'none'}:${data.nodes.length}`
    const fitDelay = mode === 'local' ? 280 : 420
    const fitMs = mode === 'local' ? 420 : 600
    const t = window.setTimeout(() => {
      try {
        fg.zoomToFit(fitMs, mode === 'local' ? 52 : 40)
        fittedFor.current = token
        // Gentle Obsidian Animate drift after settle (desktop only).
        if (liveAnimate) fgExt.d3AlphaTarget?.(0.018)
      } catch {
        /* ignore */
      }
    }, fitDelay)

    return () => {
      clearTimeout(t)
      fgExt.d3AlphaTarget?.(0)
    }
  }, [focusId, mode, data.nodes.length, lowPower, liveAnimate])

  return (
    <div className="graph-pane" ref={containerRef}>
      {!focusId && mode === 'local' && (
        <div className="hint">Click a node (or search) — Local graph opens like Obsidian, with details on the side.</div>
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
        linkColor={() => 'rgba(248,205,55,0.28)'}
        linkWidth={0.85}
        linkDirectionalArrowLength={mode === 'local' ? 3.2 : 0}
        linkDirectionalArrowRelPos={1}
        linkDirectionalParticles={mode === 'local' && focusId && liveAnimate ? 1 : 0}
        linkDirectionalParticleSpeed={0.0028}
        linkDirectionalParticleWidth={1.35}
        linkDirectionalParticleColor={() => OBSIDIAN_COLORS.root}
        cooldownTicks={lowPower ? 55 : mode === 'local' ? 90 : 100}
        d3AlphaDecay={lowPower ? 0.05 : 0.028}
        d3VelocityDecay={0.35}
        warmupTicks={lowPower ? 0 : 12}
        onNodeHover={onNodeHover as never}
        onNodeClick={(node) => onSelect((node as GraphNode).id)}
        onNodeDragEnd={(node) => {
          const n = node as SimNode
          n.__userPinned = true
          n.fx = n.x
          n.fy = n.y
          if (n.x != null && n.y != null) posCache.current.set(n.id, { x: n.x, y: n.y })
        }}
        enableNodeDrag={!lowPower}
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
