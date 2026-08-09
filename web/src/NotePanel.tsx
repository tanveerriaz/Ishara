import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { NoteData, NoteVerse, TrMode } from './types'

type Props = {
  note: NoteData | null
  loading: boolean
  versesLoading?: boolean
  onNavigate: (slug: string) => void
  onNeedAllVerses?: () => void
}

const VERSE_PAGE = 12
const LS_TR = 'ishara-tr-mode'

function readTrMode(): TrMode {
  try {
    const v = localStorage.getItem(LS_TR)
    if (v === 'en' || v === 'ur' || v === 'all') return v
    if (v === 'both') return 'all'
  } catch {
    /* ignore */
  }
  return 'all'
}

/** Prefer English gloss from `bw - meaning` slugs for link buttons. */
function displaySlug(slug: string): string {
  const i = slug.indexOf(' - ')
  if (i < 0) return slug
  const meaning = slug.slice(i + 3).trim()
  return meaning || slug
}

const EN_STOP = new Set([
  'a',
  'an',
  'and',
  'are',
  'be',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'or',
  'the',
  'their',
  'this',
  'to',
  'with',
  'your',
])

function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[^\u0621-\u064A\u0660-\u0669]/g, '')
}

function highlightArabic(text: string, wordForm: string): ReactNode[] {
  const target = normalizeArabic(wordForm)
  if (!target) return [text]
  return text.split(/(\s+)/).map((part, i) => {
    const normalized = normalizeArabic(part)
    if (!normalized || normalized !== target) return part
    return (
      <mark className="hit hit-ar" key={`${part}-${i}`}>
        {part}
      </mark>
    )
  })
}

function stemEn(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1)
  return word
}

function glossTerms(gloss: string): Set<string> {
  const terms = new Set<string>()
  for (const raw of gloss.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []) {
    const word = raw.replace(/^'+|'+$/g, '')
    if (word.length < 3 || EN_STOP.has(word)) continue
    terms.add(word)
    terms.add(stemEn(word))
  }
  return terms
}

function highlightEnglish(text: string, gloss: string): ReactNode[] {
  const terms = glossTerms(gloss)
  if (!terms.size) return [text]
  return text.split(/(\b[a-z][a-z'-]*\b)/gi).map((part, i) => {
    const word = part.toLowerCase().replace(/^'+|'+$/g, '')
    if (!word || (!terms.has(word) && !terms.has(stemEn(word)))) return part
    return (
      <mark className="hit hit-tr" key={`${part}-${i}`}>
        {part}
      </mark>
    )
  })
}

function VerseCard({
  v,
  trMode,
  onNavigate,
}: {
  v: NoteVerse
  trMode: TrMode
  onNavigate: (slug: string) => void
}) {
  const showEn = trMode === 'all' || trMode === 'en'
  const showUr = trMode === 'all' || trMode === 'ur'
  return (
    <article className="verse-card">
      <header className="verse-ref">
        <span>
          {v.ref} · {displaySlug(v.surah)}
          {v.fromWord ? (
            <>
              {' · '}
              <button type="button" className="linkish inline" onClick={() => onNavigate(v.fromWord!)}>
                {displaySlug(v.fromWord)}
              </button>
            </>
          ) : null}
        </span>
        <a href={v.url} target="_blank" rel="noopener noreferrer">
          Quran.com
        </a>
      </header>
      <dl className="verse-evidence">
        <div>
          <dt>Where is this ayah?</dt>
          <dd>{v.ref} in {displaySlug(v.surah)}</dd>
        </div>
        <div>
          <dt>Word in this ayah</dt>
          <dd>
            <code dir="rtl" lang="ar">{v.wordForm || '—'}</code>
            {v.fromWord ? (
              <>
                {' · '}
                <button type="button" className="linkish inline" onClick={() => onNavigate(v.fromWord!)}>
                  {displaySlug(v.fromWord)}
                </button>
              </>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Literal meaning</dt>
          <dd>{v.gloss || '—'}</dd>
        </div>
      </dl>
      <div className="arabic" dir="rtl" lang="ar">
        {highlightArabic(v.arabic, v.wordForm)}
      </div>
      {(v.wordForm || v.gloss) && (
        <p className="verse-word">
          <strong>Form and sense:</strong> <code dir="rtl" lang="ar">{v.wordForm}</code>
          {v.gloss ? ` — ${v.gloss}` : ''}
          {v.fromWord ? (
            <>
              {' '}
              <button type="button" className="linkish inline" onClick={() => onNavigate(v.fromWord!)}>
                Open word
              </button>
            </>
          ) : null}
        </p>
      )}
      {showEn && v.sahihInternational && (
        <p className="tr">
          <span className="tr-label">Narrative translation · Sahih International</span>
          {highlightEnglish(v.sahihInternational, v.gloss)}
        </p>
      )}
      {showEn && v.yusufAli && (
        <p className="tr">
          <span className="tr-label">Narrative translation · Abdullah Yusuf Ali</span>
          {highlightEnglish(v.yusufAli, v.gloss)}
        </p>
      )}
      {showUr && v.urdu && (
        <p className="tr" dir="rtl" lang="ur">
          <span className="tr-label">Urdu · Fatah Muhammad Jalandhari</span>
          {v.urdu}
        </p>
      )}
    </article>
  )
}

export function NotePanel({ note, loading, versesLoading, onNavigate, onNeedAllVerses }: Props) {
  const paneRef = useRef<HTMLElement>(null)
  const [verseLimit, setVerseLimit] = useState(VERSE_PAGE)
  const [trMode, setTrMode] = useState<TrMode>(readTrMode)

  useEffect(() => {
    if (!note || loading) return
    paneRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    setVerseLimit(VERSE_PAGE)
  }, [note?.id, loading, note])

  const setTr = (mode: TrMode) => {
    setTrMode(mode)
    try {
      localStorage.setItem(LS_TR, mode)
    } catch {
      /* ignore */
    }
  }

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
  const total = note.versesTotal ?? verses.length
  const isSurah = note.type === 'surah'
  const showVerses = note.type === 'word' || note.type === 'root' || (isSurah && verses.length > 0)
  const hasStructured =
    (showVerses && (note.meaning || verses.length > 0)) ||
    (isSurah && (!!note.words?.length || !!note.roots?.length || verses.length > 0))
  const heading =
    note.meaning && note.meaning !== note.title ? note.meaning : displaySlug(note.title || note.slug)

  const askMore = () => {
    if (!note.versesLoaded && note.versesFile) onNeedAllVerses?.()
    setVerseLimit((n) => n + VERSE_PAGE)
  }

  return (
    <aside className="note-pane" ref={paneRef}>
      <div className="note-sticky">
        <div className="note-meta">
          <span className={`badge ${note.type}`}>{note.type}</span>
          <div className="tr-toggle" role="group" aria-label="Translation">
            {(
              [
                ['all', 'ALL'],
                ['en', 'EN'],
                ['ur', 'UR'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={trMode === id ? 'active' : ''}
                onClick={() => setTr(id)}
              >
                {label}
              </button>
            ))}
          </div>
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
              <strong>About:</strong> {note.meaning || heading}
              {note.lemma ? ` (${note.lemma})` : ''}
            </p>
            {note.type === 'word' && (
              <p className="evidence-lede">
                This word is connected across <strong>{note.surahCount ?? 0}</strong> surahs and{' '}
                <strong>{note.ayahCount ?? total}</strong> ayahs. Open each ayah below for the Arabic form,
                literal gloss, English translations, Urdu, and source link.
              </p>
            )}
            {!isSurah && (
              <ul className="note-stats">
                <li>
                  <strong>{note.ayahCount ?? total}</strong> ayahs
                </li>
                <li>
                  <strong>{note.surahCount ?? 0}</strong> surahs
                </li>
              </ul>
            )}
            {isSurah && (
              <ul className="note-stats">
                <li>
                  <strong>{note.ayahCount ?? 0}</strong> ayahs
                </li>
                <li>
                  <strong>{note.words?.length ?? 0}</strong> words
                </li>
              </ul>
            )}
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
                <strong>{isSurah ? 'Words in this surah' : 'Words from this root'}</strong>
                <ul>
                  {note.words.slice(0, 40).map((w) => (
                    <li key={w}>
                      <button type="button" className="linkish" onClick={() => onNavigate(w)}>
                        {displaySlug(w)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!!note.roots?.length && (
              <div className="note-surahs">
                <strong>Roots</strong>
                <ul>
                  {note.roots.slice(0, 40).map((r) => (
                    <li key={r}>
                      <button type="button" className="linkish" onClick={() => onNavigate(r)}>
                        {displaySlug(r)}
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
                  {note.surahs.slice(0, 40).map((s) => (
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

          {showVerses && (
            <section className="note-verses">
              <h2>Verses</h2>
              {verses.length === 0 ? (
                <p className="muted">No verses exported for this note yet.</p>
              ) : (
                <>
                  <p className="muted">
                    Showing {Math.min(verseLimit, verses.length)} of {total}
                    {versesLoading ? ' · loading full set…' : ''}
                  </p>
                  {verses.slice(0, verseLimit).map((v) => (
                    <VerseCard
                      key={`${v.ref}-${v.wordForm}-${v.fromWord ?? ''}`}
                      v={v}
                      trMode={trMode}
                      onNavigate={onNavigate}
                    />
                  ))}
                  {verseLimit < total && (
                    <button type="button" className="linkish verse-more" onClick={askMore}>
                      Show more verses ({total - Math.min(verseLimit, verses.length)} left)
                    </button>
                  )}
                </>
              )}
            </section>
          )}
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
