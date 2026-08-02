import { useEffect, useRef } from 'react'
import type { NoteData, NoteVerse } from './types'

type Props = {
  note: NoteData | null
  loading: boolean
  onNavigate: (slug: string) => void
}

/** Prefer English gloss from `bw - meaning` slugs for link buttons. */
function displaySlug(slug: string): string {
  const i = slug.indexOf(' - ')
  if (i < 0) return slug
  const meaning = slug.slice(i + 3).trim()
  return meaning || slug
}

function VerseCard({ v }: { v: NoteVerse }) {
  return (
    <article className="verse-card">
      <header className="verse-ref">
        <span>
          {v.ref} · {displaySlug(v.surah)}
          {v.fromWord ? ` · ${displaySlug(v.fromWord)}` : ''}
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
          <strong>Word here:</strong> <code dir="rtl" lang="ar">{v.wordForm}</code>
          {v.gloss ? ` — ${v.gloss}` : ''}
        </p>
      )}
      {v.sahihInternational && (
        <p className="tr">
          <span className="tr-label">English (Sahih International)</span>
          {v.sahihInternational}
        </p>
      )}
      {v.urdu && (
        <p className="tr" dir="rtl" lang="ur">
          <span className="tr-label">Urdu (Jalandhari)</span>
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
            Click a <strong>word</strong>, <strong>root</strong>, or <strong>surah</strong> to open meaning,
            how often it appears, and verses with English and Urdu.
          </p>
        </div>
      </aside>
    )
  }

  const verses = note.verses ?? []
  const showVerses = note.type === 'word' || note.type === 'root'
  const hasStructured = showVerses && (note.meaning || verses.length > 0)
  const heading =
    note.meaning && note.meaning !== note.title ? note.meaning : displaySlug(note.title || note.slug)

  return (
    <aside className="note-pane" ref={paneRef}>
      <div className="note-sticky">
        <div className="note-meta">
          <span className={`badge ${note.type}`}>{note.type}</span>
        </div>
        <h1>{heading}</h1>
        {note.lemma && (
          <p className="note-lemma" dir="rtl" lang="ar">
            {note.lemma}
          </p>
        )}
      </div>

      {hasStructured ? (
        <div className="note-structured">
          <section className="note-summary">
            <p>
              <strong>Meaning:</strong> {note.meaning || heading}
              {note.lemma ? (
                <>
                  {' '}
                  · <span dir="rtl" lang="ar">{note.lemma}</span>
                </>
              ) : null}
            </p>
            <ul className="note-stats">
              <li>
                <strong>{note.ayahCount ?? verses.length}</strong> ayahs
              </li>
              <li>
                <strong>{note.surahCount ?? 0}</strong> surahs
              </li>
            </ul>
            {note.type === 'word' && note.root && (
              <p>
                <strong>Root:</strong>{' '}
                <button type="button" className="linkish" onClick={() => onNavigate(note.root!)}>
                  {displaySlug(note.root)}
                </button>
              </p>
            )}
            {!!note.words?.length && (
              <div className="note-surahs">
                <strong>Words from this root</strong>
                <ul>
                  {note.words.slice(0, 24).map((w) => (
                    <li key={w}>
                      <button type="button" className="linkish" onClick={() => onNavigate(w)}>
                        {displaySlug(w)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
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
            {verses.length === 0 ? (
              <p className="muted">No verses exported for this note yet.</p>
            ) : (
              <>
                <p className="muted">
                  All {verses.length} verse{verses.length === 1 ? '' : 's'} for this selection — Sahih International and
                  Urdu.
                </p>
                {verses.map((v) => (
                  <VerseCard key={`${v.ref}-${v.wordForm}-${v.fromWord ?? ''}`} v={v} />
                ))}
              </>
            )}
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
