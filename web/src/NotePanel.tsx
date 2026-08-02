import { useEffect, useRef } from 'react'
import type { NoteData, NoteVerse } from './types'

type Props = {
  note: NoteData | null
  loading: boolean
  onNavigate: (slug: string) => void
}

function VerseCard({ v }: { v: NoteVerse }) {
  return (
    <article className="verse-card">
      <header className="verse-ref">
        <span>
          {v.ref} · {v.surah}
        </span>
        <a href={v.url} target="_blank" rel="noopener noreferrer">
          Quran.com
        </a>
      </header>
      <div className="arabic" dir="rtl" lang="ar">
        {v.arabic}
      </div>
      {(v.wordForm || v.gloss) && (
        <p className="verse-word">
          <strong>Word here:</strong> <code>{v.wordForm}</code>
          {v.gloss ? ` — ${v.gloss}` : ''}
        </p>
      )}
      {v.sahihInternational && (
        <p className="tr">
          <span className="tr-label">Sahih International</span>
          {v.sahihInternational}
        </p>
      )}
      {v.yusufAli && (
        <p className="tr">
          <span className="tr-label">Yusuf Ali</span>
          {v.yusufAli}
        </p>
      )}
      {!v.yusufAli && v.urdu && (
        <p className="tr">
          <span className="tr-label">Urdu</span>
          {v.urdu}
        </p>
      )}
    </article>
  )
}

export function NotePanel({ note, loading, onNavigate }: Props) {
  const paneRef = useRef<HTMLElement>(null)

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
            Click a <strong>word</strong>, <strong>root</strong>, or <strong>surah</strong> to open its note —
            meaning, how often it appears, and full verses with both English translations.
          </p>
        </div>
      </aside>
    )
  }

  const verses = note.verses ?? []
  const hasStructured = note.type === 'word' && (note.meaning || verses.length > 0)

  return (
    <aside className="note-pane" ref={paneRef}>
      <div className="note-sticky">
        <div className="note-meta">
          <span className={`badge ${note.type}`}>{note.type}</span>
        </div>
        <h1>{note.meaning || note.title}</h1>
        {note.lemma && <p className="note-lemma" dir="rtl" lang="ar">{note.lemma}</p>}
      </div>

      {hasStructured ? (
        <div className="note-structured">
          <section className="note-summary">
            <p>
              <strong>About:</strong> {note.meaning}
              {note.lemma ? ` (${note.lemma})` : ''}
            </p>
            <ul className="note-stats">
              <li>
                <strong>{note.ayahCount ?? 0}</strong> ayahs
              </li>
              <li>
                <strong>{note.surahCount ?? 0}</strong> surahs
              </li>
            </ul>
            {note.root && (
              <p>
                <strong>Root:</strong>{' '}
                <button type="button" className="linkish" onClick={() => onNavigate(note.root!)}>
                  {note.root}
                </button>
              </p>
            )}
            {!!note.surahs?.length && (
              <div className="note-surahs">
                <strong>Appears in</strong>
                <ul>
                  {note.surahs.slice(0, 20).map((s) => (
                    <li key={s}>
                      <button type="button" className="linkish" onClick={() => onNavigate(s)}>
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="note-verses">
            <h2>Verses</h2>
            <p className="muted">
              Showing {verses.length} sample verse{verses.length === 1 ? '' : 's'} with Sahih International and Yusuf
              Ali.
            </p>
            {verses.map((v) => (
              <VerseCard key={v.ref + v.wordForm} v={v} />
            ))}
          </section>
        </div>
      ) : (
        <div
          className="note-body"
          dangerouslySetInnerHTML={{
            __html: (note.html || '')
              .replace(/Open\s*<strong>Local graph<\/strong>[\s\S]*?(?=<h[1-4]|$)/gi, '')
              .replace(/obsidian/gi, ''),
          }}
          onClick={(e) => {
            const a = (e.target as HTMLElement).closest('a[data-slug]') as HTMLAnchorElement | null
            if (a) {
              e.preventDefault()
              onNavigate(a.dataset.slug!)
            }
          }}
        />
      )}
    </aside>
  )
}
