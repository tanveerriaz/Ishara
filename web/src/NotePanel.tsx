import { useEffect, useMemo, useRef } from 'react'
import type { NoteData } from './types'

type Props = {
  note: NoteData | null
  loading: boolean
  onNavigate: (slug: string) => void
}

/** Put Meaning / Surahs / Verses before Graph connections so ayahs aren't buried. */
function prioritizeReadingHtml(html: string): string {
  let cleaned = html
    .replace(/Open\s*<strong>Local graph<\/strong>[\s\S]*?(?=<h[1-4]|<p><strong>|$)/gi, '')
    .replace(/obsidian/gi, '')

  const graphBlock = cleaned.match(/<h2>\s*Graph connections\s*<\/h2>[\s\S]*?(?=<h2>|$)/i)
  if (!graphBlock) return cleaned

  const withoutGraph = cleaned.replace(graphBlock[0], '').trim()
  return `${withoutGraph}\n${graphBlock[0]}`
}

export function NotePanel({ note, loading, onNavigate }: Props) {
  const paneRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const html = useMemo(() => (note ? prioritizeReadingHtml(note.html) : ''), [note])

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      const a = t.closest('a[data-slug]') as HTMLAnchorElement | null
      if (a) {
        e.preventDefault()
        onNavigate(a.dataset.slug!)
      }
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [onNavigate, note])

  useEffect(() => {
    if (!note || loading) return
    paneRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [note?.id, loading, note])

  if (loading) {
    return (
      <aside className="note-pane" ref={paneRef}>
        Loading note…
      </aside>
    )
  }

  if (!note) {
    return (
      <aside className="note-pane empty" ref={paneRef}>
        <div>
          <h2>Ishara</h2>
          <p>
            Click a <strong>word</strong>, <strong>root</strong>, or <strong>surah</strong> on the graph to open its
            note here — meaning, linked surahs, and full ayahs (Arabic + English + Urdu).
          </p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="note-pane" ref={paneRef}>
      <div className="note-sticky">
        <div className="note-meta">
          <span className={`badge ${note.type}`}>{note.type}</span>
        </div>
        <h1>{note.title}</h1>
      </div>
      <div className="note-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: html }} />
    </aside>
  )
}
