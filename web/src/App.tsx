import { useCallback, useEffect, useMemo, useState } from 'react'
import MiniSearch from 'minisearch'
import { GraphView } from './GraphView'
import { NotePanel } from './NotePanel'
import type { GraphData, GraphNode, NoteData } from './types'

function isQuranNode(n: GraphNode): boolean {
  return n.type === 'word' || n.type === 'root' || n.type === 'surah'
}

export default function App() {
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [note, setNote] = useState<NoteData | null>(null)
  const [noteLoading, setNoteLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'local' | 'global'>('global')
  const [resultsOpen, setResultsOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

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
      // ids are already URL-safe (typed + percent-encoded slug); don't double-encode
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

      <div className="main">
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
          <GraphView graph={graph} focusId={focusId} mode={mode} onSelect={(id) => void selectId(id)} />
        </div>
        <NotePanel note={note} loading={noteLoading} onNavigate={navigateSlug} />
      </div>

      <footer className="footer">
        Sources: Arabic (Quran.com / Tanzil), Sahih International, Abdullah Yusuf Ali, Quranic Arabic Corpus,
        Lane lexicon. Study tool — not a fatwa source. · Curious mind. Builder mode! 🇸🇬
      </footer>
    </div>
  )
}
