import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import MiniSearch from 'minisearch'
import { GraphView } from './GraphView'
import { NotePanel } from './NotePanel'
import { ResizeHandle } from './ResizeHandle'
import type { GraphData, GraphNode, NoteData } from './types'

const STACK_MQ = '(max-width: 860px)'
const LS_NOTE_WIDTH = 'ishara-note-width'
const LS_NOTE_HEIGHT = 'ishara-note-height'
const MIN_NOTE_PX = 160
const MAX_NOTE_FRAC = 0.7
const DEFAULT_NOTE_WIDTH = 340
const DEFAULT_NOTE_HEIGHT_FRAC = 0.4

function isQuranNode(n: GraphNode): boolean {
  return n.type === 'word' || n.type === 'root' || n.type === 'surah'
}

function detectLowPower(): boolean {
  if (typeof window === 'undefined') return false
  const narrow = window.matchMedia('(max-width: 900px)').matches
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const saveData =
    'connection' in navigator &&
    Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData)
  return narrow || coarse || saveData
}

function readStoredPx(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

function clampNoteSize(size: number, containerSize: number): number {
  if (containerSize <= 0) return size
  const max = Math.min(containerSize * MAX_NOTE_FRAC, containerSize - containerSize * 0.3)
  return Math.round(Math.min(Math.max(size, MIN_NOTE_PX), Math.max(MIN_NOTE_PX, max)))
}

export default function App() {
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [note, setNote] = useState<NoteData | null>(null)
  const [noteLoading, setNoteLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [lowPower, setLowPower] = useState(detectLowPower)
  const [mode, setMode] = useState<'local' | 'global'>(() => (detectLowPower() ? 'local' : 'global'))
  const [resultsOpen, setResultsOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [stacked, setStacked] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(STACK_MQ).matches : false,
  )
  const [noteWidth, setNoteWidth] = useState(() => readStoredPx(LS_NOTE_WIDTH, DEFAULT_NOTE_WIDTH))
  const [noteHeight, setNoteHeight] = useState(() => {
    if (typeof window === 'undefined') return 280
    const fallback = Math.round(window.innerHeight * DEFAULT_NOTE_HEIGHT_FRAC)
    return readStoredPx(LS_NOTE_HEIGHT, fallback)
  })
  const mainRef = useRef<HTMLDivElement>(null)
  const noteWidthRef = useRef(noteWidth)
  const noteHeightRef = useRef(noteHeight)
  noteWidthRef.current = noteWidth
  noteHeightRef.current = noteHeight
  const heightInitialized = useRef(
    (() => {
      try {
        return localStorage.getItem(LS_NOTE_HEIGHT) != null
      } catch {
        return false
      }
    })(),
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px), (pointer: coarse)')
    const sync = () => setLowPower(detectLowPower())
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia(STACK_MQ)
    const sync = () => setStacked(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const el = mainRef.current
    if (!el) return

    const applyClamp = () => {
      const { width, height } = el.getBoundingClientRect()
      if (!heightInitialized.current && height > 0) {
        heightInitialized.current = true
        setNoteHeight(clampNoteSize(height * DEFAULT_NOTE_HEIGHT_FRAC, height))
      } else {
        setNoteHeight((h) => clampNoteSize(h, height))
      }
      setNoteWidth((w) => clampNoteSize(w, width))
    }

    applyClamp()
    const ro = new ResizeObserver(applyClamp)
    ro.observe(el)
    return () => ro.disconnect()
  }, [graph])

  const persistNoteSize = useCallback(() => {
    try {
      localStorage.setItem(LS_NOTE_WIDTH, String(noteWidthRef.current))
      localStorage.setItem(LS_NOTE_HEIGHT, String(noteHeightRef.current))
    } catch {
      /* ignore quota / private mode */
    }
  }, [])

  const onNoteResize = useCallback(
    (deltaPx: number) => {
      const el = mainRef.current
      if (!el) return
      const { width, height } = el.getBoundingClientRect()
      if (stacked) {
        setNoteHeight((h) => clampNoteSize(h + deltaPx, height))
      } else {
        setNoteWidth((w) => clampNoteSize(w + deltaPx, width))
      }
    },
    [stacked],
  )

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/graph.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`graph.json ${r.status}`)
        return r.json()
      })
      .then((g: GraphData) => {
        const seen = new Set<string>()
        const nodes = g.nodes.filter((n) => {
          if (!isQuranNode(n)) return false
          if (seen.has(n.id)) return false
          seen.add(n.id)
          return true
        })
        const ids = new Set(nodes.map((n) => n.id))
        const links = g.links.filter((l) => ids.has(l.source) && ids.has(l.target))
        setGraph({
          ...g,
          nodes,
          links,
          meta: { ...g.meta, nodeCount: nodes.length, linkCount: links.length },
        })
      })
      .catch((e: unknown) => {
        console.error(e)
        setLoadError(e instanceof Error ? e.message : 'Failed to load graph')
      })
  }, [])

  const mini = useMemo(() => {
    if (!graph) return null
    const ms = new MiniSearch<GraphNode>({
      fields: ['searchText', 'label', 'title', 'slug'],
      storeFields: ['id', 'slug', 'type', 'label', 'title'],
      searchOptions: { boost: { label: 3, slug: 2 }, fuzzy: 0.15, prefix: true },
    })
    try {
      ms.addAll(graph.nodes)
    } catch (e) {
      console.error(e)
      for (const n of graph.nodes) {
        try {
          ms.add(n)
        } catch {
          /* skip duplicate ids */
        }
      }
    }
    return ms
  }, [graph])

  const results = useMemo(() => {
    if (!mini || !query.trim()) return []
    return mini.search(query.trim()).slice(0, 12) as unknown as GraphNode[]
  }, [mini, query])

  const bySlug = useMemo(() => {
    const m = new Map<string, string>()
    if (!graph) return m
    for (const n of graph.nodes) m.set(n.slug, n.id)
    return m
  }, [graph])

  const selectId = useCallback(async (id: string) => {
    setFocusId(id)
    setMode('local')
    setResultsOpen(false)
    setQuery('')
    setNoteLoading(true)
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}data/notes/${id}.json`)
      if (!r.ok) throw new Error('note missing')
      setNote(await r.json())
    } catch {
      setNote(null)
    } finally {
      setNoteLoading(false)
    }
  }, [])

  const navigateSlug = useCallback(
    (slug: string) => {
      const id = bySlug.get(slug)
      if (id) void selectId(id)
    },
    [bySlug, selectId],
  )

  if (loadError) {
    return <div className="loading">Could not load graph: {loadError}</div>
  }

  if (!graph) {
    return <div className="loading">Loading Qur’an meaning graph…</div>
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          Ishara
          <span>Qur’anic meaning graph · {graph.meta.nodeCount.toLocaleString()} words/roots/surahs</span>
        </div>
        <div className="header-actions">
          <button type="button" className={mode === 'local' ? 'active' : ''} onClick={() => setMode('local')}>
            Local graph
          </button>
          <button type="button" className={mode === 'global' ? 'active' : ''} onClick={() => setMode('global')}>
            Explore all
          </button>
        </div>
      </header>

      <div
        className={`main${stacked ? ' main--stacked' : ' main--side'}`}
        ref={mainRef}
        style={
          {
            '--note-width': `${noteWidth}px`,
            '--note-height': `${noteHeight}px`,
          } as CSSProperties
        }
      >
        <div className="graph-host">
          <div className="search-wrap">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setResultsOpen(true)
              }}
              onFocus={() => setResultsOpen(true)}
              placeholder="Search word, root, surah, meaning…"
              aria-label="Search Qur’anic meanings"
            />
            {resultsOpen && results.length > 0 && (
              <ul className="results">
                {results.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => void selectId(r.id)}>
                      <span className={`badge ${r.type}`}>{r.type}</span>
                      <span>{r.title || r.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <GraphView
            graph={graph}
            focusId={focusId}
            mode={mode}
            lowPower={lowPower}
            onSelect={(id) => void selectId(id)}
          />
        </div>
        <ResizeHandle
          orientation={stacked ? 'horizontal' : 'vertical'}
          onResize={onNoteResize}
          onResizeEnd={persistNoteSize}
        />
        <NotePanel note={note} loading={noteLoading} onNavigate={navigateSlug} />
      </div>

      <footer className="footer">
        Sources: Arabic (Quran.com / Tanzil), Sahih International, Abdullah Yusuf Ali, Quranic Arabic Corpus,
        Lane lexicon. Study tool — not a fatwa source. · Curious mind. Builder mode! 🇸🇬
      </footer>
    </div>
  )
}
