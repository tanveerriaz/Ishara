import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import MiniSearch from 'minisearch'
import { displaySlug, trailLabel } from './display'
import { GraphView } from './GraphView'
import { NotePanel } from './NotePanel'
import { ResizeHandle } from './ResizeHandle'
import { TouchGuide } from './TouchGuide'
import type { GraphData, GraphNode, NoteData, SearchDoc } from './types'
import { useFocusHistory, type FocusSnap } from './useFocusHistory'

const STACK_MQ = '(max-width: 860px)'
const LS_NOTE_WIDTH = 'ishara-note-width'
const LS_NOTE_HEIGHT = 'ishara-note-height-v8'
const LS_TOUCH_GUIDE = 'ishara-touch-guide-v2'
const LS_RECENT = 'ishara-recent-searches'
const MIN_NOTE_PX = 160
const MAX_NOTE_FRAC = 0.82
const DEFAULT_NOTE_WIDTH = 380
const DEFAULT_NOTE_HEIGHT_FRAC = 0.64
const MOBILE_SHEET_PEEK_PX = 52
const MOBILE_SHEET_TOP_GAP_PX = 104
const MAX_RECENT = 8

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
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return narrow || coarse || saveData || reduceMotion
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

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(LS_RECENT)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

function clampNoteSize(size: number, containerSize: number, minFrac = 0): number {
  if (containerSize <= 0) return size
  const max = Math.min(containerSize * MAX_NOTE_FRAC, containerSize - containerSize * 0.3)
  const min = Math.max(MIN_NOTE_PX, containerSize * minFrac)
  return Math.round(Math.min(Math.max(size, min), Math.max(min, max)))
}

function mobileSheetMax(containerHeight: number): number {
  return Math.max(MOBILE_SHEET_PEEK_PX, Math.round(containerHeight - MOBILE_SHEET_TOP_GAP_PX))
}

function clampMobileSheet(size: number, containerHeight: number): number {
  return Math.round(Math.min(Math.max(size, MOBILE_SHEET_PEEK_PX), mobileSheetMax(containerHeight)))
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
  const [mode, setMode] = useState<'local' | 'global'>('global')
  const [resultsOpen, setResultsOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetDragging, setSheetDragging] = useState(false)
  const [touchGuideVisible, setTouchGuideVisible] = useState(false)
  const [graphMenuOpen, setGraphMenuOpen] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>(readRecent)
  const [stacked, setStacked] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(STACK_MQ).matches : false,
  )
  const [noteWidth, setNoteWidth] = useState(() => readStoredPx(LS_NOTE_WIDTH, DEFAULT_NOTE_WIDTH))
  const [noteHeight, setNoteHeight] = useState(() => {
    if (typeof window === 'undefined') return 280
    const fallback = Math.round(window.innerHeight * DEFAULT_NOTE_HEIGHT_FRAC)
    return readStoredPx(LS_NOTE_HEIGHT, fallback)
  })
  const [noteMaxHeight, setNoteMaxHeight] = useState(() =>
    typeof window === 'undefined' ? 640 : mobileSheetMax(window.innerHeight),
  )
  const mainRef = useRef<HTMLDivElement>(null)
  const searchWrapRef = useRef<HTMLDivElement>(null)
  const noteWidthRef = useRef(noteWidth)
  const noteHeightRef = useRef(noteHeight)
  noteWidthRef.current = noteWidth
  noteHeightRef.current = noteHeight
  const applyNoteWidth = useCallback((next: number) => {
    noteWidthRef.current = next
    setNoteWidth(next)
  }, [])
  const applyNoteHeight = useCallback((next: number) => {
    noteHeightRef.current = next
    setNoteHeight(next)
  }, [])
  const focusIdRef = useRef(focusId)
  const modeRef = useRef(mode)
  const queryRef = useRef(query)
  const noteRef = useRef(note)
  focusIdRef.current = focusId
  modeRef.current = mode
  queryRef.current = query
  noteRef.current = note
  const localGraphCache = useRef(new Map<string, GraphData>())
  const localGraphRequest = useRef(0)
  const fullGraphRequest = useRef<Promise<GraphData | null> | null>(null)
  const initialUrlHandled = useRef(false)
  const ignoreNextGraphClick = useRef(false)
  const graphTapRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const lastOpenHeightRef = useRef(noteHeight)
  const byIdRef = useRef(new Map<string, SearchDoc | GraphNode>())
  const heightInitialized = useRef(
    (() => {
      try {
        return localStorage.getItem(LS_NOTE_HEIGHT) != null
      } catch {
        return false
      }
    })(),
  )

  const rememberRecent = useCallback((q: string) => {
    const trimmed = q.trim()
    if (trimmed.length < 2) return
    setRecentSearches((prev) => {
      const next = [trimmed, ...prev.filter((x) => x.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_RECENT)
      try {
        localStorage.setItem(LS_RECENT, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px), (pointer: coarse), (prefers-reduced-motion: reduce)')
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
      if (stacked && height > 0) {
        const max = mobileSheetMax(height)
        setNoteMaxHeight(max)
        if (!heightInitialized.current) {
          heightInitialized.current = true
          const initial = clampMobileSheet(height * DEFAULT_NOTE_HEIGHT_FRAC, height)
          lastOpenHeightRef.current = initial
          applyNoteHeight(sheetOpen ? initial : MOBILE_SHEET_PEEK_PX)
        } else {
          const next = sheetOpen ? clampMobileSheet(noteHeightRef.current, height) : MOBILE_SHEET_PEEK_PX
          if (sheetOpen) lastOpenHeightRef.current = next
          applyNoteHeight(next)
        }
      } else if (!heightInitialized.current && height > 0) {
        heightInitialized.current = true
        applyNoteHeight(clampNoteSize(height * DEFAULT_NOTE_HEIGHT_FRAC, height))
      } else {
        applyNoteHeight(clampNoteSize(noteHeightRef.current, height))
      }
      applyNoteWidth(clampNoteSize(noteWidthRef.current, width))
    }

    applyClamp()
    const ro = new ResizeObserver(applyClamp)
    ro.observe(el)
    return () => ro.disconnect()
  }, [applyNoteHeight, applyNoteWidth, fullGraph, localGraph, sheetOpen, stacked])

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
        setSheetOpen(true)
        applyNoteHeight(clampMobileSheet(noteHeightRef.current + deltaPx, height))
      } else {
        applyNoteWidth(clampNoteSize(noteWidthRef.current + deltaPx, width))
      }
    },
    [applyNoteHeight, applyNoteWidth, stacked],
  )

  const collapseSheet = useCallback(() => {
    if (noteHeightRef.current > MOBILE_SHEET_PEEK_PX) {
      lastOpenHeightRef.current = noteHeightRef.current
    }
    setSheetOpen(false)
    applyNoteHeight(MOBILE_SHEET_PEEK_PX)
  }, [applyNoteHeight])

  const openSheet = useCallback(() => {
    const el = mainRef.current
    if (!stacked || !el) return
    const { height } = el.getBoundingClientRect()
    const readingHeight = clampMobileSheet(
      Math.max(lastOpenHeightRef.current, height * DEFAULT_NOTE_HEIGHT_FRAC),
      height,
    )
    lastOpenHeightRef.current = readingHeight
    applyNoteHeight(readingHeight)
    setSheetOpen(true)
  }, [applyNoteHeight, stacked])

  const onNoteResizeEnd = useCallback(() => {
    setSheetDragging(false)
    const el = mainRef.current
    if (!stacked || !el) {
      persistNoteSize()
      return
    }
    const { height } = el.getBoundingClientRect()
    const max = mobileSheetMax(height)
    const reading = clampMobileSheet(height * DEFAULT_NOTE_HEIGHT_FRAC, height)
    const current = noteHeightRef.current
    const snaps = [MOBILE_SHEET_PEEK_PX, reading, max]
    const target = snaps.reduce((best, value) =>
      Math.abs(value - current) < Math.abs(best - current) ? value : best,
    )
    if (target === MOBILE_SHEET_PEEK_PX) {
      collapseSheet()
      return
    }
    setSheetOpen(true)
    applyNoteHeight(target)
    lastOpenHeightRef.current = target
    window.setTimeout(persistNoteSize, 340)
  }, [applyNoteHeight, collapseSheet, persistNoteSize, stacked])

  const onNoteHandleActivate = useCallback(() => {
    if (!stacked) return
    if (!sheetOpen) {
      openSheet()
      return
    }
    const el = mainRef.current
    if (!el) return
    const { height } = el.getBoundingClientRect()
    const max = mobileSheetMax(height)
    const reading = clampMobileSheet(height * DEFAULT_NOTE_HEIGHT_FRAC, height)
    const target = noteHeightRef.current > max * 0.82 ? reading : max
    applyNoteHeight(target)
    lastOpenHeightRef.current = target
  }, [applyNoteHeight, openSheet, sheetOpen, stacked])

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
    byIdRef.current = m
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

  const loadFullGraph = useCallback((): Promise<GraphData | null> => {
    if (fullGraph) return Promise.resolve(fullGraph)
    if (fullGraphRequest.current) return fullGraphRequest.current
    setGraphLoading(true)
    setGraphError(null)
    const request = fetch(`${import.meta.env.BASE_URL}data/graph.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`graph.json ${r.status}`)
        return r.json() as Promise<GraphData>
      })
      .then((payload) => {
        const g = normalizeGraph(payload)
        setFullGraph(g)
        return g
      })
      .catch((e: unknown) => {
        console.error(e)
        setGraphError(e instanceof Error ? e.message : 'Failed to load full graph')
        return null
      })
      .finally(() => {
        fullGraphRequest.current = null
        setGraphLoading(false)
      })
    fullGraphRequest.current = request
    return request
  }, [fullGraph])

  useEffect(() => {
    void loadFullGraph()
  }, [loadFullGraph])

  const applyFocus = useCallback(
    async (snap: FocusSnap, opts?: { openSheet?: boolean }) => {
      setFocusId(snap.focusId)
      setMode(snap.mode)
      if (snap.query != null) setQuery(snap.query)
      setResultsOpen(false)
      if (snap.focusId) {
        if (stacked && (opts?.openSheet ?? true)) openSheet()
        await Promise.all([
          loadNote(snap.focusId),
          snap.mode === 'local' ? loadLocalGraph(snap.focusId) : Promise.resolve(),
        ])
      } else {
        setNote(null)
        setNoteLoading(false)
        if (stacked) collapseSheet()
        if (snap.mode === 'global') void loadFullGraph()
      }
    },
    [collapseSheet, loadFullGraph, loadLocalGraph, loadNote, openSheet, stacked],
  )

  const {
    canGoBack,
    prevTrail,
    pushFocus,
    replaceFocus,
    seedInitial,
    goBack: historyGoBack,
  } = useFocusHistory({
    onRestore: (snap) => {
      void applyFocus(snap, { openSheet: Boolean(snap.focusId) })
    },
    getSlug: (id) => byIdRef.current.get(id)?.slug,
  })

  const selectId = useCallback(
    async (id: string, opts?: { skipHistory?: boolean; mode?: 'local' | 'global'; openSheet?: boolean }) => {
      const nextMode = opts?.mode ?? 'local'
      const cur = focusIdRef.current
      const curMode = modeRef.current
      if (!opts?.skipHistory && (cur !== id || curMode !== nextMode)) {
        const doc = cur ? byIdRef.current.get(cur) : null
        const label = doc
          ? trailLabel(doc.slug || doc.title, 'label' in doc ? doc.label : undefined)
          : noteRef.current
            ? trailLabel(noteRef.current.slug, noteRef.current.meaning)
            : undefined
        pushFocus(
          { focusId: id, mode: nextMode, query: queryRef.current },
          label || undefined,
        )
      } else if (opts?.skipHistory) {
        replaceFocus({ focusId: id, mode: nextMode, query: queryRef.current })
      }
      rememberRecent(queryRef.current)
      setQuery('')
      await applyFocus({ focusId: id, mode: nextMode }, { openSheet: opts?.openSheet ?? !opts?.skipHistory })
    },
    [applyFocus, pushFocus, rememberRecent, replaceFocus],
  )

  // Deep links work as soon as the compact search index is ready.
  useEffect(() => {
    if (initialUrlHandled.current) return
    if (!searchDocs.length && !fullGraph) return
    const params = new URLSearchParams(window.location.search)
    const focus = params.get('focus')
    const idParam = params.get('id')
    const id = (focus && bySlug.get(focus)) || idParam || null
    initialUrlHandled.current = true
    if (id && byId.has(id)) {
      seedInitial({ focusId: id, mode: 'local' })
      void applyFocus({ focusId: id, mode: 'local' }, { openSheet: true })
    } else {
      seedInitial({ focusId: null, mode: 'global' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on first data ready
  }, [searchDocs.length, fullGraph])

  const goBack = useCallback(() => {
    historyGoBack()
  }, [historyGoBack])

  const setExploreAll = useCallback(() => {
    setGraphMenuOpen(false)
    const leavingFocus = Boolean(focusIdRef.current) || modeRef.current !== 'global'
    if (leavingFocus) {
      const doc = focusIdRef.current ? byIdRef.current.get(focusIdRef.current) : null
      pushFocus(
        { focusId: null, mode: 'global' },
        doc ? trailLabel(doc.slug || doc.title, doc.label) : undefined,
      )
    } else {
      replaceFocus({ focusId: null, mode: 'global' })
    }
    setFocusId(null)
    setMode('global')
    setNote(null)
    collapseSheet()
    void loadFullGraph()
  }, [collapseSheet, loadFullGraph, pushFocus, replaceFocus])

  const setLocalMode = useCallback(() => {
    setGraphMenuOpen(false)
    if (modeRef.current !== 'local') {
      pushFocus({ focusId: focusIdRef.current, mode: 'local' })
    } else {
      replaceFocus({ focusId: focusIdRef.current, mode: 'local' })
    }
    setMode('local')
    if (focusIdRef.current) void loadLocalGraph(focusIdRef.current)
  }, [loadLocalGraph, pushFocus, replaceFocus])

  const shouldIgnoreGraphTap = (target: EventTarget | null) => {
    const el = target as HTMLElement | null
    return Boolean(el?.closest('.search-wrap') || el?.closest('.sheet-dimmer') || el?.closest('.note-pane'))
  }

  const displayGraph = mode === 'global' ? fullGraph : localGraph
  const nodeCount = fullGraph?.meta.nodeCount ?? searchDocs.length
  const mobileSheetVisible = stacked && sheetOpen && (noteLoading || !!note)
  const mobileSheetReady = stacked && (noteLoading || !!note)
  const trimmedQuery = deferredQuery.trim()
  const showEmptySearch = resultsOpen && trimmedQuery.length >= 2 && results.length === 0
  const showRecent = resultsOpen && !trimmedQuery && recentSearches.length > 0

  const onGraphPointerDownCapture = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (touchGuideVisible) {
        setTouchGuideVisible(false)
        try {
          localStorage.setItem(LS_TOUCH_GUIDE, '1')
        } catch {
          /* ignore */
        }
      }
      if (!stacked || !sheetOpen || shouldIgnoreGraphTap(e.target)) return
      graphTapRef.current = { x: e.clientX, y: e.clientY, moved: false }
    },
    [sheetOpen, stacked, touchGuideVisible],
  )

  const onGraphPointerMoveCapture = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const tap = graphTapRef.current
    if (!tap) return
    if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 12) tap.moved = true
  }, [])

  const onGraphClickCapture = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!stacked || !sheetOpen || shouldIgnoreGraphTap(e.target)) return
      const tap = graphTapRef.current
      graphTapRef.current = null
      if (tap?.moved) return
      if (ignoreNextGraphClick.current) {
        ignoreNextGraphClick.current = false
        return
      }
      collapseSheet()
    },
    [collapseSheet, sheetOpen, stacked],
  )

  useEffect(() => {
    if (!stacked || !displayGraph || mobileSheetVisible) return
    try {
      if (localStorage.getItem(LS_TOUCH_GUIDE) === '1') return
    } catch {
      /* show the guide when storage is unavailable */
    }
    const showTimer = window.setTimeout(() => setTouchGuideVisible(true), 550)
    const hideTimer = window.setTimeout(() => {
      setTouchGuideVisible(false)
      try {
        localStorage.setItem(LS_TOUCH_GUIDE, '1')
      } catch {
        /* ignore */
      }
    }, 7200)
    return () => {
      window.clearTimeout(showTimer)
      window.clearTimeout(hideTimer)
    }
  }, [displayGraph, mobileSheetVisible, stacked])

  // Dismiss search on outside click / Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setResultsOpen(false)
        setGraphMenuOpen(false)
      }
    }
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (searchWrapRef.current && t && !searchWrapRef.current.contains(t)) {
        setResultsOpen(false)
      }
      const menu = document.querySelector('.graph-menu')
      const toggle = document.querySelector('.graph-menu-toggle')
      if (graphMenuOpen && menu && toggle && t && !menu.contains(t) && !toggle.contains(t)) {
        setGraphMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [graphMenuOpen])

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

  const resultLabel = (r: SearchDoc) => displaySlug(r.label || r.title || r.slug)

  if (loadError) {
    return <div className="loading">Could not load graph: {loadError}</div>
  }

  const graphControls = (
    <>
      <button
        type="button"
        className={animate ? 'active' : ''}
        onClick={toggleAnimate}
        title="Obsidian-style Animate"
        aria-pressed={animate}
      >
        Animate
      </button>
      <button
        type="button"
        className={mode === 'local' ? 'active' : ''}
        onClick={setLocalMode}
        aria-pressed={mode === 'local'}
      >
        Local graph
      </button>
      <button
        type="button"
        className={mode === 'global' ? 'active' : ''}
        onClick={setExploreAll}
        aria-pressed={mode === 'global'}
      >
        Explore all
      </button>
    </>
  )

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          Ishara
          <span>Qur’anic meaning graph · {nodeCount.toLocaleString()} words/roots/surahs</span>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="back-btn"
            disabled={!canGoBack}
            onClick={goBack}
            title={prevTrail ? `Back to ${prevTrail}` : 'Go back'}
            aria-label={prevTrail ? `Back to ${prevTrail}` : 'Go back'}
          >
            ← Back
            {prevTrail ? <span className="back-trail">{prevTrail}</span> : null}
          </button>
          <div className="header-actions-desktop">{graphControls}</div>
          <div className="header-actions-mobile">
            <button
              type="button"
              className={`graph-menu-toggle${graphMenuOpen ? ' active' : ''}`}
              aria-expanded={graphMenuOpen}
              aria-haspopup="menu"
              onClick={() => setGraphMenuOpen((o) => !o)}
            >
              Graph
            </button>
            {graphMenuOpen && (
              <div className="graph-menu" role="menu">
                {graphControls}
              </div>
            )}
          </div>
        </div>
      </header>

      <div
        className={`main${stacked ? ' main--stacked' : ' main--side'}${mobileSheetReady ? ' main--sheet-ready' : ''}${mobileSheetVisible ? ' main--sheet-open' : ''}${sheetDragging ? ' main--sheet-dragging' : ''}`}
        ref={mainRef}
        style={
          {
            '--note-width': `${noteWidth}px`,
            '--note-height': `${noteHeight}px`,
            '--note-max-height': `${noteMaxHeight}px`,
          } as CSSProperties
        }
      >
        <div
          className="graph-host"
          onPointerDownCapture={onGraphPointerDownCapture}
          onPointerMoveCapture={onGraphPointerMoveCapture}
          onClickCapture={onGraphClickCapture}
        >
          <div className="search-wrap" ref={searchWrapRef}>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setResultsOpen(true)
              }}
              onFocus={() => setResultsOpen(true)}
              placeholder="Search word, root, surah, meaning…"
              aria-label="Search Qur’anic meanings"
              aria-autocomplete="list"
              aria-expanded={resultsOpen}
              autoComplete="off"
              enterKeyHint="search"
            />
            {resultsOpen && results.length > 0 && (
              <ul className="results" role="listbox">
                {results.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => void selectId(r.id)}>
                      <span className={`badge ${r.type}`}>{r.type}</span>
                      <span>{resultLabel(r)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showEmptySearch && (
              <div className="results results-empty" role="status">
                <p>
                  No word, root, or surah matched <strong>{trimmedQuery}</strong>.
                </p>
                <p className="muted">
                  Ishara links lemmas that appear in 3+ surahs. Particles and many proper names (e.g. Musa,
                  Pharaoh) are not separate hubs — try a meaning like <em>mercy</em>, <em>believe</em>, or a
                  surah name.
                </p>
              </div>
            )}
            {showRecent && (
              <ul className="results results-recent" role="listbox" aria-label="Recent searches">
                {recentSearches.map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery(q)
                        setResultsOpen(true)
                      }}
                    >
                      <span className="badge">recent</span>
                      <span>{q}</span>
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
              onSelect={(id) => {
                ignoreNextGraphClick.current = true
                window.setTimeout(() => {
                  ignoreNextGraphClick.current = false
                }, 0)
                void selectId(id, { openSheet: true })
              }}
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
          {touchGuideVisible && <TouchGuide />}
          {mobileSheetVisible && (
            <button
              type="button"
              className="sheet-dimmer"
              aria-label="Close details"
              onClick={collapseSheet}
            />
          )}
        </div>
        <ResizeHandle
          orientation={stacked ? 'horizontal' : 'vertical'}
          onResize={onNoteResize}
          onResizeStart={() => setSheetDragging(true)}
          onResizeEnd={onNoteResizeEnd}
          onActivate={onNoteHandleActivate}
          expanded={mobileSheetVisible}
        />
        <NotePanel
          note={note}
          loading={noteLoading}
          versesLoading={versesLoading}
          onNavigate={navigateSlug}
          onNeedAllVerses={loadAllVersesNow}
          onClose={stacked ? collapseSheet : undefined}
          onBack={canGoBack ? goBack : undefined}
          backTrail={prevTrail}
          showSheetChrome={stacked}
        />
      </div>

      <footer className="footer">
        Sources: Arabic (Quran.com / Tanzil), Sahih International, Abdullah Yusuf Ali, Quranic Arabic Corpus,
        Lane lexicon. Study tool — not a fatwa source. · Curious mind. Builder mode! 🇸🇬
      </footer>
    </div>
  )
}
