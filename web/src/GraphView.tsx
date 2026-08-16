import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import type { GraphData, GraphLink, GraphNode } from './types'

const NODE_COLORS = {
  word: '#e15a2b',
  root: '#f6c945',
  surah: '#3fa7d6',
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
  __ring?: 0 | 1 | 2 | 9
}

type LabelBox = {
  x1: number
  y1: number
  x2: number
  y2: number
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
  return NODE_COLORS[type] ?? NODE_COLORS.word
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
    .slice(0, 180)
  const roots = nodes
    .filter((n) => n.type === 'root')
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
    .slice(0, 100)
  const surahs = nodes.filter((n) => n.type === 'surah')
  const keep = new Set<string>()
  for (const n of words) keep.add(n.id)
  for (const n of roots) keep.add(n.id)
  for (const n of surahs) keep.add(n.id)
  return keep
}

function prioritizeMobileLinks(
  links: GraphLink[],
  degree: Map<string, number>,
  maxLinks: number,
): GraphLink[] {
  const ranked = [...links].sort((a, b) => {
    const aScore = (degree.get(a.source) ?? 0) + (degree.get(a.target) ?? 0)
    const bScore = (degree.get(b.source) ?? 0) + (degree.get(b.target) ?? 0)
    return bScore - aScore
  })
  const selected: GraphLink[] = []
  const selectedKeys = new Set<string>()
  const covered = new Set<string>()
  const add = (link: GraphLink) => {
    const key = `${link.source}\u0000${link.target}`
    if (selectedKeys.has(key)) return
    selectedKeys.add(key)
    selected.push({ ...link })
    covered.add(link.source)
    covered.add(link.target)
  }

  for (const link of ranked) {
    if (!covered.has(link.source) || !covered.has(link.target)) add(link)
  }
  for (const link of ranked) {
    if (selected.length >= maxLinks) break
    add(link)
  }
  return selected
}

function unpadSurah(text: string): string {
  const m = text.match(/^0*(\d{1,3})\s+(.+)$/)
  if (!m) return text
  return `${Number(m[1])} ${m[2]}`
}

function displayLabel(node: GraphNode): string {
  if (node.type === 'surah') {
    return unpadSurah((node.label || node.title || node.slug || '').trim())
  }
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
  const hoverIdRef = useRef<string | null>(null)
  const labelBoxesRef = useRef<{ firstId: string | null; scale: number; boxes: LabelBox[] }>({
    firstId: null,
    scale: 0,
    boxes: [],
  })
  const fittedFor = useRef<string | null>(null)
  const lastBackgroundTap = useRef<{ at: number; x: number; y: number } | null>(null)
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
    const ringFor = (id: string): 0 | 1 | 2 | 9 => {
      if (mode !== 'local' || !focusId) return 9
      if (id === focusId) return 0
      if (adj.get(focusId)?.has(id)) return 1
      return 2
    }

    const withCachedPos = (nodes: GraphNode[]): SimNode[] =>
      nodes.map((n) => {
        const cached = posCache.current.get(n.id)
        const seed = seedXY(n.id)
        return {
          ...n,
          color: nodeColor(n.type),
          x: cached?.x ?? seed.x,
          y: cached?.y ?? seed.y,
          __ring: ringFor(n.id),
        }
      })

    if (mode === 'global') {
      const keep = globalKeepIds(quranNodes, graph.links, lowPower)
      const degree = degreeMap(graph.links)
      const eligibleLinks = graph.links.filter((l) => keep.has(l.source) && keep.has(l.target))
      const links = lowPower
        ? prioritizeMobileLinks(eligibleLinks, degree, 1800)
        : eligibleLinks.map((l) => ({ ...l }))
      return connectedSubgraph(
        withCachedPos(quranNodes.filter((n) => keep.has(n.id))),
        links,
        null,
      )
    }

    if (!focusId) return { nodes: [] as SimNode[], links: [] as GraphLink[] }
    const maxNodes = lowPower ? 110 : 120
    const keep = localCluster(focusId, adj, quranNodes, maxNodes)
    return connectedSubgraph(
      withCachedPos(quranNodes.filter((n) => keep.has(n.id))),
      graph.links.filter((l) => keep.has(l.source) && keep.has(l.target)).map((l) => ({ ...l })),
      focusId,
    )
  }, [graph.links, focusId, mode, quranNodes, adj, lowPower])

  const firstNodeId = (data.nodes[0] as SimNode | undefined)?.id ?? null

  // Persist positions so clicking another node doesn’t explode the layout.
  useEffect(() => {
    for (const n of data.nodes as SimNode[]) {
      if (n.x != null && n.y != null) posCache.current.set(n.id, { x: n.x, y: n.y })
    }
  })

  const onNodeHover = useCallback(
    (node: object | null) => {
      const n = node as SimNode | null
      hoverIdRef.current = n?.id ?? null
      refreshGraph(fgRef.current)
    },
    [],
  )

  const paint = useCallback(
    (node: SimNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const scale = Math.max(globalScale, 0.05)
      if (node.id === firstNodeId || Math.abs(labelBoxesRef.current.scale - scale) > 0.03) {
        labelBoxesRef.current = { firstId: firstNodeId, scale, boxes: [] }
      }
      const x = node.x ?? 0
      const y = node.y ?? 0
      const color = nodeColor(node.type)
      const isFocus = node.id === focusId
      const isHover = node.id === hoverIdRef.current
      const ring = node.__ring ?? 9
      const sizeFactor = lowPower ? 0.76 : 1
      const screenR =
        ring === 0
          ? node.type === 'root'
            ? 18 * sizeFactor
            : node.type === 'word'
              ? 16 * sizeFactor
              : 15 * sizeFactor
          : ring === 1
            ? node.type === 'root'
              ? 11 * sizeFactor
              : node.type === 'word'
                ? 9.5 * sizeFactor
                : 8.5 * sizeFactor
            : node.type === 'root'
              ? 7 * sizeFactor
              : node.type === 'word'
                ? 6 * sizeFactor
                : 6.5 * sizeFactor
      const baseR = screenR / scale
      const h = hashId(node.id)
      const t = performance.now() / 1000
      const pulse = liveAnimate ? 0.5 + 0.5 * Math.sin(t * 1.05 + (h % 360) * 0.017) : 0
      const r = isFocus || isHover ? baseR + (2.4 + pulse * 0.5) / scale : baseR

      if (liveAnimate) {
        const aura = r + (isFocus || isHover ? 14 + pulse * 8 : 4.5 + pulse * 1.6) / scale
        const grad = ctx.createRadialGradient(x, y, 0, x, y, aura)
        grad.addColorStop(0, hexToRgba(color, isFocus || isHover ? 0.36 : 0.18 + pulse * 0.04))
        grad.addColorStop(0.55, hexToRgba(color, isFocus || isHover ? 0.1 : 0.055))
        grad.addColorStop(1, hexToRgba(color, 0))
        ctx.beginPath()
        ctx.arc(x, y, aura, 0, Math.PI * 2)
        ctx.fillStyle = grad
        ctx.fill()
      }

      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = hexToRgba(color, ring >= 2 && !isHover ? 0.78 : 1)
      ctx.fill()

      if (isFocus || isHover) {
        ctx.strokeStyle = 'rgba(244,244,240,0.92)'
        ctx.lineWidth = 1.8 / scale
        ctx.stroke()
      }

      const zoomRevealsLabel =
        mode === 'global' && lowPower
          ? globalScale > (node.type === 'surah' ? 0.78 : 1.42)
          : globalScale > (mode === 'local' ? (lowPower ? 0.82 : 0.72) : 1.05)
      const showLabel =
        isFocus ||
        isHover ||
        (ring <= 1 && (!lowPower || globalScale > 0.34)) ||
        zoomRevealsLabel
      if (!showLabel) return

      const label = displayLabel(node)
      const fontSize = Math.max(((ring === 0 ? 14 : 11.5) * (lowPower ? 0.82 : 1)) / scale, 2.8)
      ctx.font = `${ring === 0 ? 600 : 500} ${fontSize}px "DM Sans", system-ui, sans-serif`
      const width = ctx.measureText(label).width
      const pad = 4.5 / scale
      const box: LabelBox = {
        x1: x - width / 2 - pad,
        y1: y + r + 6 / scale,
        x2: x + width / 2 + pad,
        y2: y + r + 6 / scale + fontSize * 1.25,
      }
      const overlaps = labelBoxesRef.current.boxes.some(
        (b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1,
      )
      if (overlaps && !isFocus && !isHover) return
      labelBoxesRef.current.boxes.push(box)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = 'rgba(25,25,25,0.62)'
      ctx.fillRect(box.x1, box.y1 - 2 / scale, box.x2 - box.x1, box.y2 - box.y1)
      ctx.fillStyle = `rgba(250,242,214,${isFocus || isHover ? 0.96 : ring <= 1 ? 0.82 : 0.56})`
      ctx.fillText(label, x, y + r + 6 / scale)

      if ((isFocus || isHover) && node.lemma) {
        ctx.font = `${17 / scale}px Amiri, "Noto Naskh Arabic", serif`
        ctx.fillStyle = 'rgba(232,212,154,0.9)'
        ctx.textBaseline = 'bottom'
        ctx.fillText(node.lemma, x, y - r - 8 / scale)
      }
    },
    [firstNodeId, focusId, liveAnimate, lowPower, mode],
  )

  // Obsidian-like forces (mapped from graph.json) + one soft zoom fit.
  useEffect(() => {
    hoverIdRef.current = null
    const fg = fgRef.current
    if (!fg || !data.nodes.length) return

    // Obsidian: repelStrength 12, linkDistance 250, centerStrength 0.4, linkStrength 1
    // Canvas units are smaller — scale into a comfortable web range.
    const charge = mode === 'global' ? (lowPower ? -38 : -56) : lowPower ? -130 : -165
    const dist = mode === 'global' ? (lowPower ? 38 : 48) : lowPower ? 74 : 92
    fg.d3Force('charge')?.strength(charge)
    fg.d3Force('link')?.distance(dist)?.strength(mode === 'local' ? 0.62 : 0.5)
    const center = fg.d3Force('center') as { strength?: (n: number) => void } | undefined
    center?.strength?.(mode === 'global' ? 0.05 : 0.08)

    const fgExt = fg as ForceGraphMethods & {
      d3ReheatSimulation?: () => void
      d3AlphaTarget?: (n: number) => void
    }
    fgExt.d3AlphaTarget?.(0)
    fgExt.d3ReheatSimulation?.()

    const token = `${mode}:${focusId ?? 'none'}:${data.nodes.length}`
    const fitDelay = mode === 'local' ? 180 : 360
    const fitMs = mode === 'local' ? 720 : 860
    const t = window.setTimeout(() => {
      try {
        fg.zoomToFit(fitMs, mode === 'local' ? 52 : 40)
        fittedFor.current = token
        if (liveAnimate) fgExt.d3AlphaTarget?.(0.006)
      } catch {
        /* ignore */
      }
    }, fitDelay)

    return () => {
      clearTimeout(t)
      fgExt.d3AlphaTarget?.(0)
    }
  }, [focusId, mode, data.nodes.length, lowPower, liveAnimate])

  const onBackgroundClick = useCallback((event: MouseEvent) => {
    const now = performance.now()
    const x = event.offsetX
    const y = event.offsetY
    const last = lastBackgroundTap.current
    lastBackgroundTap.current = { at: now, x, y }
    if (!last || now - last.at > 340 || Math.hypot(x - last.x, y - last.y) > 42) return
    const fg = fgRef.current as (ForceGraphMethods & {
      screen2GraphCoords?: (screenX: number, screenY: number) => { x: number; y: number }
    }) | undefined
    if (!fg?.screen2GraphCoords) return
    const point = fg.screen2GraphCoords(x, y)
    const nextZoom = Math.min(Math.max(fg.zoom() * 1.65, 1.15), 8)
    fg.centerAt(point.x, point.y, 360)
    fg.zoom(nextZoom, 360)
    lastBackgroundTap.current = null
  }, [])

  return (
    <div
      className="graph-pane"
      ref={containerRef}
      role="application"
      aria-label={`Meaning graph with ${data.nodes.length} nodes. Pinch or double-tap to zoom; drag to move.`}
      data-node-count={data.nodes.length}
    >
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
        nodePointerAreaPaint={(node, color, ctx, globalScale) => {
          const n = node as SimNode
          const hitR = (lowPower ? 23 : 18) / Math.max(globalScale, 0.05)
          ctx.beginPath()
          ctx.arc(n.x ?? 0, n.y ?? 0, hitR, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
        }}
        linkColor={(link) => {
          const source = typeof link.source === 'object' ? (link.source as GraphNode).id : String(link.source)
          const target = typeof link.target === 'object' ? (link.target as GraphNode).id : String(link.target)
          return source === focusId || target === focusId ? 'rgba(244,244,240,0.34)' : 'rgba(246,201,69,0.16)'
        }}
        linkWidth={(link) => {
          const source = typeof link.source === 'object' ? (link.source as GraphNode).id : String(link.source)
          const target = typeof link.target === 'object' ? (link.target as GraphNode).id : String(link.target)
          return source === focusId || target === focusId ? 1.25 : 0.75
        }}
        linkDirectionalArrowLength={mode === 'local' ? 3.2 : 0}
        linkDirectionalArrowRelPos={1}
        linkDirectionalParticles={mode === 'local' && focusId && liveAnimate ? 1 : 0}
        linkDirectionalParticleSpeed={0.0028}
        linkDirectionalParticleWidth={1.35}
        linkDirectionalParticleColor={() => NODE_COLORS.root}
        cooldownTicks={lowPower ? 45 : mode === 'local' ? 80 : 90}
        d3AlphaDecay={lowPower ? 0.055 : 0.035}
        d3VelocityDecay={0.48}
        warmupTicks={lowPower ? 0 : 12}
        onNodeHover={onNodeHover as never}
        onNodeClick={(node) => onSelect((node as GraphNode).id)}
        onBackgroundClick={onBackgroundClick}
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
