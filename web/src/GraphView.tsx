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
  /** Prefer light simulation / paint (phones, coarse pointer). */
  lowPower?: boolean
}

type SimNode = GraphNode & { x?: number; y?: number; vx?: number; vy?: number }

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

/** Local cluster: prefer words/root; only a few surahs (busy roots link to 50+). */
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

  // A handful of surahs for context (not every chapter the root touches).
  const surahBudget = Math.min(8, Math.max(3, Math.floor(maxNodes / 4)))
  const surahs: string[] = []
  const consider = [focusId, ...[...keep].filter((id) => byId.get(id)?.type === 'word')]
  for (const id of consider) {
    for (const n of adj.get(id) ?? []) {
      if (byId.get(n)?.type === 'surah' && !surahs.includes(n)) {
        surahs.push(n)
        if (surahs.length >= surahBudget) break
      }
    }
    if (surahs.length >= surahBudget) break
  }
  for (const s of surahs) keep.add(s)

  if (keep.size <= maxNodes) return keep

  const typeRank = (t: GraphNode['type'] | undefined) =>
    t === 'root' ? 0 : t === 'word' ? 1 : t === 'surah' ? 2 : 3

  const ranked = [...keep].sort((a, b) => {
    if (a === focusId) return -1
    if (b === focusId) return 1
    return typeRank(byId.get(a)?.type) - typeRank(byId.get(b)?.type)
  })
  return new Set(ranked.slice(0, maxNodes))
}

function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Stable seed positions so the first paint isn’t a random explosion. */
function seedXY(id: string): { x: number; y: number } {
  const h = hashId(id)
  return {
    x: (h % 900) - 450,
    y: ((h >>> 10) % 700) - 350,
  }
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

/** Drop floating nodes; always keep focusId so Local never goes blank. */
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

/** Desktop explorer: dense; phones: compact subset that settles in ~1s. */
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
    .slice(0, 80)
  const roots = nodes
    .filter((n) => n.type === 'root')
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
    .slice(0, 50)
  const keep = new Set<string>()
  for (const n of words) keep.add(n.id)
  for (const n of roots) keep.add(n.id)
  return keep
}

/** World-space radius — canvas zoom makes circles grow/shrink naturally. */
function worldRadius(type: GraphNode['type'], isFocus: boolean): number {
  const base = type === 'surah' ? 6.2 : type === 'root' ? 5.4 : 4.6
  return isFocus ? base + 2.4 : base
}

function shouldShowLabel(
  node: GraphNode,
  isFocus: boolean,
  scale: number,
  mode: 'local' | 'global',
  lowPower: boolean,
): boolean {
  if (isFocus) return true
  if (mode === 'local') {
    // Local is small — show labels once reasonably framed; hide at extreme zoom-out.
    return scale >= (lowPower ? 0.45 : 0.35)
  }
  // Explore-all: few labels when zoomed out; more when zoomed in.
  if (scale < 0.4) return node.type === 'surah'
  if (scale < 0.75) return node.type !== 'word'
  if (lowPower && scale < 1.0) return node.type !== 'word'
  return true
}

/** Prefer English meaning if export left a Buckwalter-looking label. */
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
  if (looksBw && (!meaningFromTitle || meaningFromTitle.toLowerCase() === raw.toLowerCase())) {
    return node.type === 'root' ? 'root' : node.type === 'word' ? 'word' : raw
  }
  if (bwHead && raw === bwHead && meaningFromTitle) return meaningFromTitle
  return raw || meaningFromTitle || title
}

/** Shorten long labels when zoomed out; full text when zoomed in. */
function labelText(node: GraphNode, scale: number): string {
  const raw = displayLabel(node)
  if (scale >= 1.0 || raw.length <= 22) return raw
  if (scale >= 0.65) return raw.length > 26 ? `${raw.slice(0, 24)}…` : raw
  return raw.length > 16 ? `${raw.slice(0, 14)}…` : raw
}

export function GraphView({ graph, focusId, mode, onSelect, lowPower = false }: Props) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const fittedFor = useRef<string | null>(null)
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

  const quranNodes = useMemo(
    () =>
      graph.nodes
        .filter((n) => n.type === 'word' || n.type === 'root' || n.type === 'surah')
        .map((n) => {
          const seed = seedXY(n.id)
          return { ...n, color: nodeColor(n.type), x: seed.x, y: seed.y }
        }),
    [graph.nodes],
  )

  const adj = useMemo(() => buildAdj(graph.links), [graph.links])

  const data = useMemo(() => {
    if (mode === 'global') {
      const keep = globalKeepIds(quranNodes, graph.links, lowPower)
      const byId = new Map(quranNodes.map((n) => [n.id, n]))

      let links: GraphLink[]
      if (lowPower) {
        const structural = graph.links.filter((l) => {
          if (!keep.has(l.source) || !keep.has(l.target)) return false
          const a = byId.get(l.source)?.type
          const b = byId.get(l.target)?.type
          return a !== 'surah' && b !== 'surah'
        })
        const surahStitch: GraphLink[] = []
        const seenWord = new Set<string>()
        for (const l of graph.links) {
          const a = byId.get(l.source)?.type
          const b = byId.get(l.target)?.type
          if (a !== 'surah' && b !== 'surah') continue
          const wordId = a === 'word' ? l.source : b === 'word' ? l.target : null
          const surahId = a === 'surah' ? l.source : b === 'surah' ? l.target : null
          if (!wordId || !surahId || !keep.has(wordId) || seenWord.has(wordId)) continue
          seenWord.add(wordId)
          keep.add(surahId)
          surahStitch.push({ source: l.source, target: l.target })
          if (surahStitch.length >= 120) break
        }
        links = [...structural.map((l) => ({ ...l })), ...surahStitch]
        if (links.length > 1000) links = links.slice(0, 1000)
      } else {
        links = graph.links
          .filter((l) => keep.has(l.source) && keep.has(l.target))
          .map((l) => ({ ...l }))
      }

      const nodes = quranNodes.filter((n) => keep.has(n.id)).map((n) => ({ ...n }))
      return connectedSubgraph(nodes, links, null)
    }

    if (!focusId) return { nodes: [] as GraphNode[], links: [] as GraphLink[] }
    const maxNodes = lowPower ? 28 : 40
    const keep = localCluster(focusId, adj, quranNodes, maxNodes)
    return connectedSubgraph(
      quranNodes.filter((n) => keep.has(n.id)).map((n) => ({ ...n })),
      graph.links.filter((l) => keep.has(l.source) && keep.has(l.target)).map((l) => ({ ...l })),
      focusId,
    )
  }, [graph.links, focusId, mode, quranNodes, adj, lowPower])

  const paint = useCallback(
    (node: SimNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0
      const y = node.y ?? 0
      const scale = Math.max(globalScale, 0.05)
      const color = nodeColor(node.type)
      const isFocus = node.id === focusId

      // Fixed world size → canvas zoom grows/shrinks circles and text on screen.
      const r = worldRadius(node.type, isFocus)

      if (isFocus) {
        ctx.beginPath()
        ctx.arc(x, y, r + 3, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(248,205,55,0.28)'
        ctx.fill()
      }

      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()

      if (isFocus) {
        ctx.strokeStyle = 'rgba(250,242,214,0.9)'
        ctx.lineWidth = 1.5 / scale
        ctx.stroke()
      }

      if (!shouldShowLabel(node, isFocus, scale, mode, lowPower)) return

      // World-space font — gets larger on screen as you zoom in.
      const fontSize = isFocus ? 5.2 : mode === 'local' ? 4.4 : 3.8
      const label = labelText(node, scale)
      ctx.font = `${fontSize}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const tw = ctx.measureText(label).width
      const ly = y + r + 2
      ctx.fillStyle = 'rgba(25,25,25,0.55)'
      ctx.fillRect(x - tw / 2 - 1.2, ly - 0.6, tw + 2.4, fontSize + 1.8)
      ctx.fillStyle = 'rgba(250,242,214,0.94)'
      ctx.fillText(label, x, ly)
    },
    [focusId, lowPower, mode],
  )

  useEffect(() => {
    fittedFor.current = null
  }, [focusId, mode])

  useEffect(() => {
    let cancelled = false
    const timers: number[] = []
    const raf = requestAnimationFrame(() => {
      const fg = fgRef.current
      if (!fg || cancelled) return

      // Stronger separation in Local so labels don’t pile into blobs.
      const charge = mode === 'global' ? (lowPower ? -28 : -55) : lowPower ? -110 : -140
      fg.d3Force('charge')?.strength(charge)

      const byId = new Map(data.nodes.map((n) => [n.id, n]))
      const endpointType = (end: unknown): GraphNode['type'] | undefined => {
        if (end && typeof end === 'object' && 'type' in end) return (end as GraphNode).type
        return byId.get(String(end))?.type
      }
      const linkForce = fg.d3Force('link') as
        | {
            distance?: (fn: (l: { source: unknown; target: unknown }) => number) => unknown
            strength?: (fn: (l: { source: unknown; target: unknown }) => number) => unknown
          }
        | undefined

      if (mode === 'local') {
        linkForce?.distance?.((l) => {
          const types = [endpointType(l.source), endpointType(l.target)].filter(Boolean).sort().join('-')
          if (types === 'root-word') return lowPower ? 48 : 56
          if (types.includes('surah')) return lowPower ? 62 : 72
          return lowPower ? 52 : 60
        })
        linkForce?.strength?.((l) => {
          const types = [endpointType(l.source), endpointType(l.target)].filter(Boolean).sort().join('-')
          return types === 'root-word' ? 0.85 : 0.55
        })
      } else {
        linkForce?.distance?.(() => (lowPower ? 28 : 36))
        linkForce?.strength?.(() => (lowPower ? 0.35 : 0.55))
      }

      const center = fg.d3Force('center') as { strength?: (n: number) => void } | undefined
      center?.strength?.(mode === 'global' ? (lowPower ? 0.08 : 0.05) : 0.12)
      fg.d3ReheatSimulation()

      // Explore-all leaves the camera extremely zoomed out — Local then looks like a black speck.
      if (mode === 'local' && focusId) {
        fg.centerAt(0, 0, 0)
        fg.zoom(2.4, 0)
      }

      const fitMs = lowPower ? 280 : mode === 'global' ? 900 : 500
      const pad = lowPower ? 36 : mode === 'global' ? 40 : 64
      const fitDelay = lowPower ? 160 : mode === 'global' ? 500 : 200

      if (!data.nodes.length) return

      const fit = () => {
        if (cancelled) return
        try {
          fgRef.current?.zoomToFit(fitMs, pad)
        } catch {
          /* ignore */
        }
      }
      timers.push(window.setTimeout(fit, fitDelay))
      timers.push(window.setTimeout(fit, fitDelay + fitMs + 100))
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      for (const t of timers) clearTimeout(t)
    }
  }, [focusId, data, mode, lowPower])

  return (
    <div className="graph-pane" ref={containerRef}>
      {!focusId && mode === 'local' && (
        <div className="hint">Search or tap a meaning to open its local graph and verses.</div>
      )}
      <ForceGraph2D
        key={`${mode}:${focusId ?? 'none'}`}
        ref={fgRef}
        graphData={data}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={paint as never}
        nodeCanvasObjectMode={() => 'replace'}
        nodePointerAreaPaint={(node, color, ctx, globalScale) => {
          const n = node as SimNode
          const scale = Math.max(globalScale, 0.05)
          const hit = (lowPower ? 18 : 16) / scale
          ctx.beginPath()
          ctx.arc(n.x ?? 0, n.y ?? 0, hit, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
        }}
        // Thin in world space so zoom-in doesn’t turn links into fat bars.
        linkColor={() => (lowPower ? 'rgba(248,205,55,0.22)' : 'rgba(248,205,55,0.26)')}
        linkWidth={0.35}
        linkDirectionalParticles={0}
        cooldownTicks={lowPower ? (mode === 'global' ? 45 : 55) : mode === 'local' ? 80 : 120}
        d3AlphaDecay={lowPower ? 0.06 : mode === 'local' ? 0.04 : 0.022}
        d3VelocityDecay={lowPower ? 0.45 : 0.4}
        warmupTicks={lowPower ? 0 : mode === 'local' ? 10 : 20}
        onEngineStop={() => {
          if (mode !== 'local' || !focusId || !data.nodes.length) return
          const token = `${mode}:${focusId}`
          if (fittedFor.current === token) return
          fittedFor.current = token
          try {
            fgRef.current?.zoomToFit(300, 56)
          } catch {
            /* ignore */
          }
        }}
        onNodeClick={(node) => onSelect((node as GraphNode).id)}
        onNodeDragEnd={(node) => {
          const n = node as SimNode & { fx?: number; fy?: number }
          n.fx = n.x
          n.fy = n.y
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
