import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import MiniSearch from 'minisearch'
import { GraphView } from './GraphView'
import { NotePanel } from './NotePanel'
import { ResizeHandle } from './ResizeHandle'
import type { GraphData, GraphNode, NoteData, SearchDoc } from './types'

const STACK_MQ = '(max-width: 860px)'
const LS_NOTE_WIDTH = 'ishara-note-width'
const LS_NOTE_HEIGHT = 'ishara-note-height'
const MIN_NOTE_PX = 160
const MAX_NOTE_FRAC = 0.7
const DEFAULT_NOTE_WIDTH = 380
const DEFAULT_NOTE_HEIGHT_FRAC = 0.58
const MAX_HISTORY = 24

type ViewSnap = {
  focusId: string | null
  mode: 'local' | 'global'
}

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

function normalizeGraph(g: GraphData): GraphData {
  const seen = new Set<string>()
  const nodes = g.nodes.filter((n) => {
    if (!isQuranNode(n)) return false
    if (seen.has(n.id)) return false
    seen.add(n.id)
    return true
  })
  const ids = new Set(nodes.map((n) => n.id))
  const links = g.links.filter((l) => ids.has(l.source) && ids.has(l.target))
  return {
    ...g,
    nodes,
    links,
    meta: { ...g.meta, nodeCount: nodes.length, linkCount: links.length },
  }
}

function querySurahIntent(query: string): number | null {
  const q = query.trim().toLowerCase()
  const ayah = q.match(/\b(?:ayah|ayat|aya|verse)?\s*0*(\d{1,3})\s*:\s*\d{1,3}\b/)
  if (ayah) return Number(ayah[1])
  const surah = q.match(/\b(?:surah|sura|sude|chapter)\s+0*(\d{1,3})\b/)
  if (surah) return Number(surah[1])
  return null
}

function rankResults(results: SearchDoc[], query: string, docs: SearchDoc[]): SearchDoc[] {
  const surahIntent = querySurahIntent(query)
  if (!surahIntent) return results
  const exact = docs.find((d) => d.type === 'surah' && d.slug.startsWith(String(surahIntent).padStart(3, '0')))
  const withExact = exact ? [exact, ...results.filter((r) => r.id !== exact.id)] : results
  return withExact.sort((a, b) => {
    const aExact = a.type === 'surah' && a.slug.startsWith(String(surahIntent).padStart(3, '0')) ? 0 : 1
    const bExact = b.type === 'surah' && b.slug.startsWith(String(surahIntent).padStart(3, '0')) ? 0 : 1
    return aExact - bExact
  })
}

export default function App() {
  const [fullGraph, setFullGraph] = useState<GraphData | null>(null)
  const [localGraph, setLocalGraph] = useState<GraphData | null>(null)
  const [searchDocs, setSearchDocs] = useState<SearchDoc[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [note, setNote] = useState<NoteData | null>(null)
  const [noteLoading, setNoteLoading] = useState(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [lowPower, setLowPower] = useState(detectLowPower)
  const [mode, setMode] = useState<'local' | 'global'>(() => (detectLowPower() ? 'local' : 'global'))
  const [resultsOpen, setResultsOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
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
  const focusIdRef = useRef(focusId)
  const modeRef = useRef(mode)
  focusIdRef.current = focusId
  modeRef.current = mode
  const historyRef = useRef<ViewSnap[]>([])
  const localGraphCache = useRef(new Map<string, GraphData>())
  const localGraphRequest = useRef(0)
  const initialUrlHandled = useRef(false)
  const heightInitialized = useRef(
    (() => {
      try {
        return localStorage.getItem(LS_NOTE_HEIGHT) != null
      } catch {
        return false
      }
    })(),
  )

  const pushHistory = useCallback(() => {
    const snap: ViewSnap = { focusId: focusIdRef.current, mode: modeRef.current }
    const last = historyRef.current[historyRef.current.length - 1]
    if (last && last.focusId === snap.focusId && last.mode === snap.mode) return
    historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 1)), snap]
    setCanGoBack(historyRef.current.length > 0)
  }, [])

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
  }, [fullGraph, localGraph])

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
    let cancelled = false

    fetch(`${import.meta.env.BASE_URL}data/search.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`search.json ${r.status}`)
        return r.json()
      })
      .then((docs: SearchDoc[]) => {
        if (cancelled) return
        setSearchDocs(docs.filter((n) => isQuranNode(n as GraphNode)))
      })
      .catch((e: unknown) => {
        console.error(e)
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load search index')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const mini = useMemo(() => {
    const docs = searchDocs.length
      ? searchDocs
      : fullGraph?.nodes.map(({ id, slug, type, label, title, searchText }) => ({
          id,
          slug,
          type,
          label,
          title,
          searchText: searchText ?? '',
        })) ?? []
    if (!docs.length) return null
    const ms = new MiniSearch<SearchDoc>({
      fields: ['searchText', 'label', 'title', 'slug'],
      storeFields: ['id', 'slug', 'type', 'label', 'title'],
      searchOptions: { boost: { label: 3, slug: 2 }, fuzzy: 0.15, prefix: true },
    })
    try {
      ms.addAll(docs)
    } catch (e) {
      console.error(e)
      for (const n of docs) {
        try {
          ms.add(n)
        } catch {
          /* skip duplicate ids */
        }
      }
    }
    return ms
  }, [fullGraph, searchDocs])

  const results = useMemo(() => {
    if (!mini || !deferredQuery.trim()) return []
    return rankResults(mini.search(deferredQuery.trim()).slice(0, 12) as unknown as SearchDoc[], deferredQuery, searchDocs)
  }, [mini, deferredQuery, searchDocs])

  const byId = useMemo(() => {
    const m = new Map<string, SearchDoc | GraphNode>()
    for (const n of searchDocs) m.set(n.id, n)
    if (fullGraph) {
      for (const n of fullGraph.nodes) m.set(n.id, n)
    }
    return m
  }, [fullGraph, searchDocs])

  const bySlug = useMemo(() => {
    const m = new Map<string, string>()
    for (const n of searchDocs) m.set(n.slug, n.id)
    if (fullGraph) {
      for (const n of fullGraph.nodes) m.set(n.slug, n.id)
    }
    return m
  }, [fullGraph, searchDocs])

  const [animate, setAnimate] = useState(() => {
    try {
      const v = localStorage.getItem('ishara-animate')
      if (v === '0') return false
      if (v === '1') return true
    } catch {
      /* ignore */
    }
    return !detectLowPower()
  })
  const [versesLoading, setVersesLoading] = useState(false)

  const syncUrl = useCallback((id: string | null, slug?: string) => {
    try {
      const url = new URL(window.location.href)
      if (id && slug) {
        url.searchParams.set('focus', slug)
        url.searchParams.delete('id')
      } else if (id) {
        url.searchParams.set('id', id)
        url.searchParams.delete('focus')
      } else {
        url.searchParams.delete('focus')
        url.searchParams.delete('id')
      }
      window.history.replaceState({}, '', url.toString())
    } catch {
      /* ignore */
    }
  }, [])

  const loadNote = useCallback(async (id: string | null) => {
    if (!id) {
      setNote(null)
      setNoteLoading(false)
      setVersesLoading(false)
      return
    }
    setNoteLoading(true)
    setVersesLoading(false)
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}data/notes/${id}.json`)
      if (!r.ok) throw new Error('note missing')
      const data = (await r.json()) as NoteData
      setNote({ ...data, versesLoaded: !data.versesFile })
    } catch {
      setNote(null)
    } finally {
      setNoteLoading(false)
    }
  }, [])

  const loadAllVersesNow = useCallback(() => {
    if (!note?.versesFile || note.versesLoaded) return
    setVersesLoading(true)
    void fetch(`${import.meta.env.BASE_URL}data/notes/${note.versesFile}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((verses: NoteData['verses']) => {
        if (!verses) return
        setNote((prev) =>
          prev
            ? {
                ...prev,
                verses,
                versesTotal: verses.length,
                versesLoaded: true,
              }
            : prev,
        )
      })
      .finally(() => setVersesLoading(false))
  }, [note])

  const loadLocalGraph = useCallback(async (id: string) => {
    const cached = localGraphCache.current.get(id)
    const requestId = ++localGraphRequest.current
    if (cached) {
      setLocalGraph(cached)
      setGraphError(null)
      return
    }
    setGraphLoading(true)
    setGraphError(null)
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}data/neighborhoods/${id}.json`)
      if (!r.ok) throw new Error(`neighborhood ${r.status}`)
      const g = normalizeGraph((await r.json()) as GraphData)
      localGraphCache.current.set(id, g)
      if (localGraphRequest.current === requestId) setLocalGraph(g)
    } catch (e) {
      console.error(e)
      if (localGraphRequest.current === requestId) {
        setGraphError(e instanceof Error ? e.message : 'Failed to load local graph')
      }
    } finally {
      if (localGraphRequest.current === requestId) setGraphLoading(false)
    }
  }, [])

  const loadFullGraph = useCallback(async () => {
    if (fullGraph) return fullGraph
    setGraphLoading(true)
    setGraphError(null)
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}data/graph.json`)
      if (!r.ok) throw new Error(`graph.json ${r.status}`)
      const g = normalizeGraph((await r.json()) as GraphData)
      setFullGraph(g)
      return g
    } catch (e) {
      console.error(e)
      setGraphError(e instanceof Error ? e.message : 'Failed to load full graph')
      return null
    } finally {
      setGraphLoading(false)
    }
  }, [fullGraph])

  const selectId = useCallback(
    async (id: string, opts?: { skipHistory?: boolean; mode?: 'local' | 'global' }) => {
      const nextMode = opts?.mode ?? 'local'
      if (!opts?.skipHistory) {
        const cur = focusIdRef.current
        const curMode = modeRef.current
        if (cur !== id || curMode !== nextMode) pushHistory()
      }
      setFocusId(id)
      setMode(nextMode)
      setResultsOpen(false)
      setQuery('')
      syncUrl(id, byId.get(id)?.slug)
      await Promise.all([loadNote(id), nextMode === 'local' ? loadLocalGraph(id) : Promise.resolve()])
    },
    [byId, loadLocalGraph, loadNote, pushHistory, syncUrl],
  )

  // Deep links work as soon as the compact search index is ready.
  useEffect(() => {
    if (initialUrlHandled.current) return
    if (!searchDocs.length && !fullGraph) return
    const params = new URLSearchParams(window.location.search)
    const focus = params.get('focus')
    const idParam = params.get('id')
    const id = (focus && bySlug.get(focus)) || idParam || null
    if (id && byId.has(id)) {
      initialUrlHandled.current = true
      void selectId(id, { skipHistory: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on first data ready
  }, [searchDocs.length, fullGraph])

  const goBack = useCallback(async () => {
    const prev = historyRef.current.pop()
    setCanGoBack(historyRef.current.length > 0)
    if (!prev) return
    if (prev.focusId) {
      await selectId(prev.focusId, { skipHistory: true, mode: prev.mode })
    } else {
      setFocusId(null)
      setMode(prev.mode)
      setNote(null)
      setNoteLoading(false)
      syncUrl(null)
    }
  }, [selectId, syncUrl])

  const setExploreAll = useCallback(() => {
    if (modeRef.current !== 'global') pushHistory()
    setMode('global')
    void loadFullGraph()
  }, [loadFullGraph, pushHistory])

  const setLocalMode = useCallback(() => {
    if (modeRef.current !== 'local') pushHistory()
    setMode('local')
    if (focusIdRef.current) void loadLocalGraph(focusIdRef.current)
  }, [loadLocalGraph, pushHistory])

  const toggleAnimate = useCallback(() => {
    setAnimate((a) => {
      const next = !a
      try {
        localStorage.setItem('ishara-animate', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
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

  const displayGraph = mode === 'global' ? fullGraph : localGraph
  const nodeCount = fullGraph?.meta.nodeCount ?? searchDocs.length

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          Ishara
          <span>Qur’anic meaning graph · {nodeCount.toLocaleString()} words/roots/surahs</span>
        </div>
        <div className="header-actions">
          <button type="button" className="back-btn" disabled={!canGoBack} onClick={() => void goBack()} title="Go back">
            ← Back
          </button>
          <button
            type="button"
            className={animate ? 'active' : ''}
            onClick={toggleAnimate}
            title="Obsidian-style Animate"
          >
            Animate
          </button>
          <button type="button" className={mode === 'local' ? 'active' : ''} onClick={setLocalMode}>
            Local graph
          </button>
          <button type="button" className={mode === 'global' ? 'active' : ''} onClick={setExploreAll}>
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
                      <span>{r.label || r.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {displayGraph ? (
            <GraphView
              graph={displayGraph}
              focusId={focusId}
              mode={mode}
              lowPower={lowPower}
              animate={animate}
              onSelect={(id) => void selectId(id)}
            />
          ) : (
            <div className="graph-pane graph-loading">
              <div>
                <strong>{graphError ? 'Graph unavailable' : graphLoading ? 'Graph loading' : 'Search ready'}</strong>
                <span>
                  {graphError ??
                    (focusId
                      ? 'Opening the local meaning map for this selection.'
                      : 'Search a word, root, or surah to open its local map.')}
                </span>
              </div>
            </div>
          )}
        </div>
        <ResizeHandle
          orientation={stacked ? 'horizontal' : 'vertical'}
          onResize={onNoteResize}
          onResizeEnd={persistNoteSize}
        />
        <NotePanel
          note={note}
          loading={noteLoading}
          versesLoading={versesLoading}
          onNavigate={navigateSlug}
          onNeedAllVerses={loadAllVersesNow}
        />
      </div>

      <footer className="footer">
        Sources: Arabic (Quran.com / Tanzil), Sahih International, Abdullah Yusuf Ali, Quranic Arabic Corpus,
        Lane lexicon. Study tool — not a fatwa source. · Curious mind. Builder mode! 🇸🇬
      </footer>
    </div>
  )
}
