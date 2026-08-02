import { useCallback, useEffect, useMemo, useState } from 'react'
import MiniSearch from 'minisearch'
import { GraphView } from './GraphView'
import { NotePanel } from './NotePanel'
import type { GraphData, GraphNode, NoteData } from './types'

const GITHUB_REPO = 'https://github.com/tanveerriaz/Ishara'

export default function App() {
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [note, setNote] = useState<NoteData | null>(null)
  const [noteLoading, setNoteLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'local' | 'global'>('local')
  const [resultsOpen, setResultsOpen] = useState(false)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/graph.json`)
      .then((r) => r.json())
      .then((g: GraphData) => setGraph(g))
      .catch(console.error)
  }, [])

  const mini = useMemo(() => {
    if (!graph) return null
    const ms = new MiniSearch<GraphNode>({
      fields: ['searchText', 'label', 'title', 'slug'],
      storeFields: ['id', 'slug', 'type', 'label', 'title'],
      searchOptions: { boost: { label: 3, slug: 2 }, fuzzy: 0.15, prefix: true },
    })
    ms.addAll(graph.nodes)
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

  if (!graph) {
    return <div className="loading">Loading graph…</div>
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          Ishara
          <span>
            {graph.meta.nodeCount.toLocaleString()} nodes · {graph.meta.linkCount.toLocaleString()} links
          </span>
        </div>
        <div className="header-actions">
          <button type="button" className={mode === 'local' ? 'active' : ''} onClick={() => setMode('local')}>
            Local graph
          </button>
          <button type="button" className={mode === 'global' ? 'active' : ''} onClick={() => setMode('global')}>
            Explore all
          </button>
          <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer">
            Vault on GitHub
          </a>
          <a href={`${GITHUB_REPO}#use-locally-in-obsidian`}>Open in Obsidian</a>
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
              aria-label="Search graph"
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
        Data is not original: Arabic (Quran.com / Tanzil), English Sahih International, Urdu Fatah Muhammad
        Jalandhari, morphology Quranic Arabic Corpus, root labels Lane lexicon.{' '}
        <a href={`${GITHUB_REPO}/blob/main/ATTRIBUTION.md`} target="_blank" rel="noopener noreferrer">
          Full attribution
        </a>
        . Graph UI inspired by Obsidian Local Graph (not affiliated). · Curious mind. Builder mode! 🇸🇬
      </footer>
    </div>
  )
}
