import { useEffect, useRef } from 'react'
import type { NoteData } from './types'

type Props = {
  note: NoteData | null
  loading: boolean
  onNavigate: (slug: string) => void
}

export function NotePanel({ note, loading, onNavigate }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
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

  if (loading) {
    return <aside className="note-pane">Loading…</aside>
  }

  if (!note) {
    return (
      <aside className="note-pane empty">
        <div>
          <h2>Ishara</h2>
          <p>Meaning graph of Qur’anic words across surahs — search, click a node, read the full verse in Arabic, English, and Urdu.</p>
          <p>No AI answers — only vault-indexed text from attributed sources.</p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="note-pane">
      <div className="note-meta">
        <span className={`badge ${note.type}`}>{note.type}</span>
      </div>
      <h1>{note.title}</h1>
      <div className="note-body" ref={ref} dangerouslySetInnerHTML={{ __html: note.html }} />
    </aside>
  )
}
