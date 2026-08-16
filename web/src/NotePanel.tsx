import { useEffect, useRef, useState, type ReactNode } from 'react'
import { displaySlug, formatSurahLabel, formatVerseRef } from './display'
import type { NoteData, NoteVerse, TrMode } from './types'

type Props = {
  note: NoteData | null
  loading: boolean
  versesLoading?: boolean
  onNavigate: (slug: string) => void
  onNeedAllVerses?: () => void
  onClose?: () => void
  onBack?: () => void
  backTrail?: string | null
  showSheetChrome?: boolean
}

const VERSE_PAGE = 12
const LS_TR = 'ishara-tr-mode'
const MOBILE_MQ = '(max-width: 860px)'

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

/** Fold curly quotes and strip marks so Qur'an ≈ Quran ≈ quran. */
function foldLatin(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u201A\u2032`]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .toLowerCase()
}

function normalizeEnToken(word: string): string {
  return foldLatin(word)
    .replace(/^'+|'+$/g, '')
    .replace(/'/g, '')
}

function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\u0621-\u064A\u0660-\u0669]/g, '')
}

/** Drop leading ال for looser Arabic form matching (Arabic ayah text only). */
function arabicCore(text: string): string {
  const n = normalizeArabic(text)
  return n.startsWith('ال') && n.length > 3 ? n.slice(2) : n
}

/**
 * Normalize Urdu/Arabic script for comparison while keeping Urdu letters
 * (ی ک ہ ے ں) mapped onto comparable Arabic forms.
 */
function normalizeUrdu(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/[یى]/g, 'ي')
    .replace(/ے/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/ہ/g, 'ه')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ں/g, 'ن')
    .replace(/[^\u0621-\u064A\u0660-\u0669]/g, '')
}

function highlightArabic(text: string, wordForm: string): ReactNode[] {
  const target = arabicCore(wordForm)
  if (!target || target.length < 2) return [text]
  return text.split(/(\s+)/).map((part, i) => {
    const core = arabicCore(part)
    if (!core) return part
    const tight =
      core === target ||
      (target.length >= 3 && (core.endsWith(target) || target.endsWith(core) || core.includes(target)))
    if (!tight) return part
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

function glossTerms(...sources: Array<string | undefined>): Set<string> {
  const terms = new Set<string>()
  for (const source of sources) {
    if (!source) continue
    for (const raw of foldLatin(source).match(/[a-z][a-z']*/g) ?? []) {
      const word = normalizeEnToken(raw)
      if (word.length < 3 || EN_STOP.has(word)) continue
      terms.add(word)
      terms.add(stemEn(word))
    }
  }
  return terms
}

function highlightEnglish(text: string, ...termSources: Array<string | undefined>): ReactNode[] {
  const terms = glossTerms(...termSources)
  if (!terms.size) return [text]
  // Keep apostrophe variants (Qur'an) as single tokens, including curly quotes.
  return text.split(/([A-Za-z\u00C0-\u024F]+(?:['\u2018\u2019\u201A\u2032`][A-Za-z\u00C0-\u024F]+)*)/).map((part, i) => {
    const word = normalizeEnToken(part)
    if (!word || (!terms.has(word) && !terms.has(stemEn(word)))) return part
    return (
      <mark className="hit hit-tr" key={`${part}-${i}`}>
        {part}
      </mark>
    )
  })
}

/**
 * Highlight Urdu from build-time `urduHits` (PMI gloss→token alignment).
 * Loanword fallback: Arabic wordForm equals an Urdu token (e.g. قرآن).
 */
function highlightUrdu(
  text: string,
  hits: string[] | undefined,
  wordForm?: string,
): ReactNode[] {
  const needles = [...new Set((hits ?? []).map(normalizeUrdu).filter((n) => n.length >= 2))]
  const loan = normalizeUrdu(wordForm ?? '')
  const loanCore = loan.startsWith('ال') && loan.length > 4 ? loan.slice(2) : loan
  if (loanCore.length >= 4 && !needles.includes(loanCore)) needles.push(loanCore)
  if (!needles.length) return [text]

  return text.split(/([\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+)/).map((part, i) => {
    if (!/[\u0600-\u06FF]/.test(part)) return part
    const core = normalizeUrdu(part)
    if (core.length < 2) return part
    const hit = needles.some((n) => {
      if (core === n) return true
      if (n.length >= 3 && (core.startsWith(n) || core.endsWith(n))) return true
      return false
    })
    if (!hit) return part
    return (
      <mark className="hit hit-ur" key={`${part}-${i}`}>
        {part}
      </mark>
    )
  })
}

/** Space Arabic root letters for display: عذب → ع ذ ب */
function spacedRoot(arabic: string): string {
  const letters = [...arabic.replace(/\s+/g, '')].filter((ch) => /[\u0621-\u064A]/.test(ch))
  return letters.join(' ')
}

function glossTokens(text: string): Set<string> {
  return new Set(
    [...glossTerms(text)].filter((w) => !EN_STOP.has(w)),
  )
}

function sensesDiverge(a?: string, b?: string): boolean {
  if (!a || !b) return false
  const ta = glossTokens(a)
  const tb = glossTokens(b)
  if (!ta.size || !tb.size) return false
  for (const t of ta) if (tb.has(t)) return false
  return true
}

function VerseCard({
  v,
  trMode,
  onNavigate,
  focusMeaning,
}: {
  v: NoteVerse
  trMode: TrMode
  onNavigate: (slug: string) => void
  focusMeaning?: string
}) {
  const showEn = trMode === 'all' || trMode === 'en'
  const showUr = trMode === 'all' || trMode === 'ur'
  const ref = formatVerseRef(v.ref)
  const surah = formatSurahLabel(v.surah)
  const enTerms = [v.gloss, focusMeaning, displaySlug(v.fromWord ?? '')]
  return (
    <article className="verse-card">
      <header className="verse-ref">
        <span>
          {ref} · {surah}
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
          <dd>
            {ref} in {surah}
          </dd>
        </div>
        <div>
          <dt>Word in this ayah</dt>
          <dd>
            <code dir="rtl" lang="ar">
              {v.wordForm || '—'}
            </code>
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
          <strong>Form and sense:</strong>{' '}
          <code dir="rtl" lang="ar">
            {v.wordForm}
          </code>
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
          {highlightEnglish(v.sahihInternational, ...enTerms)}
        </p>
      )}
      {showEn && v.yusufAli && (
        <p className="tr">
          <span className="tr-label">Narrative translation · Abdullah Yusuf Ali</span>
          {highlightEnglish(v.yusufAli, ...enTerms)}
        </p>
      )}
      {showUr && v.urdu && (
        <p className="tr" dir="rtl" lang="ur">
          <span className="tr-label">Urdu · Fatah Muhammad Jalandhari</span>
          {highlightUrdu(v.urdu, v.urduHits, v.wordForm)}
        </p>
      )}
    </article>
  )
}

export function NotePanel({
  note,
  loading,
  versesLoading,
  onNavigate,
  onNeedAllVerses,
  onClose,
  onBack,
  backTrail,
  showSheetChrome,
}: Props) {
  const paneRef = useRef<HTMLElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const [verseLimit, setVerseLimit] = useState(VERSE_PAGE)
  const [trMode, setTrMode] = useState<TrMode>(readTrMode)
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MQ).matches : false,
  )

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ)
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!note?.id || loading) return
    paneRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    setVerseLimit(VERSE_PAGE)
    // Move focus into the note for screen readers / keyboard after navigation
    const heading = paneRef.current?.querySelector('h1, h2')
    if (heading instanceof HTMLElement) {
      heading.setAttribute('tabindex', '-1')
      heading.focus({ preventScroll: true })
    }
  }, [note?.id, loading])

  useEffect(() => {
    const pane = paneRef.current
    const target = loadMoreRef.current
    if (!isMobile || loading || !note || !pane || !target) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        if (!note.versesLoaded && note.versesFile) {
          if (!versesLoading) onNeedAllVerses?.()
          return
        }
        setVerseLimit((limit) => Math.min(limit + VERSE_PAGE, note.verses?.length ?? limit))
      },
      { root: pane, rootMargin: '420px 0px', threshold: 0.01 },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [isMobile, loading, note, onNeedAllVerses, versesLoading, verseLimit])

  const setTr = (mode: TrMode) => {
    setTrMode(mode)
    try {
      localStorage.setItem(LS_TR, mode)
    } catch {
      /* ignore */
    }
  }

  const sheetBar =
    showSheetChrome && (onBack || onClose) ? (
      <div className="sheet-chrome">
        {onBack ? (
          <button type="button" className="sheet-chrome-btn" onClick={onBack} aria-label="Go back">
            ← {backTrail ? backTrail : 'Back'}
          </button>
        ) : (
          <span className="sheet-chrome-spacer" />
        )}
        {onClose ? (
          <button type="button" className="sheet-chrome-btn sheet-chrome-close" onClick={onClose} aria-label="Close">
            Close
          </button>
        ) : null}
      </div>
    ) : null

  if (loading) {
    return (
      <aside className="note-pane" ref={paneRef}>
        {sheetBar}
        Loading note…
      </aside>
    )
  }

  if (!note) {
    return (
      <aside className="note-pane empty" ref={paneRef}>
        {sheetBar}
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
  const visibleVerses = verses.slice(0, verseLimit)
  const visibleVerseCount = Math.min(verseLimit, verses.length)
  const visibleWords = isMobile ? note.words : note.words?.slice(0, 40)
  const visibleRoots = isMobile ? note.roots : note.roots?.slice(0, 40)
  const visibleSurahs = isMobile ? note.surahs : note.surahs?.slice(0, 40)
  const hasStructured =
    (showVerses && (note.meaning || verses.length > 0)) ||
    (isSurah && (!!note.words?.length || !!note.roots?.length || verses.length > 0))
  const heading =
    note.meaning && note.meaning !== note.title ? note.meaning : displaySlug(note.title || note.slug)

  const rootSense = note.type === 'word' && note.root ? displaySlug(note.root) : null
  const wordSense = note.type === 'word' ? note.meaning || heading : null
  const showSenseSplit = Boolean(wordSense && rootSense && sensesDiverge(wordSense, rootSense))
  const arabicRootDisplay =
    note.type === 'root' && note.lemma
      ? spacedRoot(note.lemma)
      : note.type === 'word' && note.lemma && note.root
        ? null
        : null

  const askMore = () => {
    if (!note.versesLoaded && note.versesFile) onNeedAllVerses?.()
    setVerseLimit((n) => n + VERSE_PAGE)
  }

  return (
    <aside className="note-pane" ref={paneRef}>
      {sheetBar}
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
            {note.type === 'root' ? spacedRoot(note.lemma) || note.lemma : note.lemma}
            {note.type === 'root' && note.meaning ? (
              <span className="note-root-sense"> · {note.meaning}</span>
            ) : null}
          </p>
        )}
        {arabicRootDisplay && note.meaning ? (
          <p className="note-root-line">
            <span dir="rtl" lang="ar">
              {arabicRootDisplay}
            </span>
            <span> · {note.meaning}</span>
          </p>
        ) : null}
      </div>

      {hasStructured ? (
        <div className="note-structured">
          <section className="note-summary">
            <p>
              <strong>About:</strong> {note.meaning || heading}
              {note.lemma && note.type !== 'root' ? ` (${note.lemma})` : ''}
            </p>
            {showSenseSplit && (
              <p className="sense-split" role="note">
                This form: <strong>{wordSense}</strong>
                {' · '}
                root sense: <strong>{rootSense}</strong>
              </p>
            )}
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
                  {visibleWords?.map((w) => (
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
                  {visibleRoots?.map((r) => (
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
                  {visibleSurahs?.map((s) => (
                    <li key={s}>
                      <button type="button" className="linkish" onClick={() => onNavigate(s)}>
                        {formatSurahLabel(s)}
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
                    Showing {visibleVerseCount} of {total}
                    {versesLoading ? ' · loading full set…' : ''}
                  </p>
                  {visibleVerses.map((v) => (
                    <VerseCard
                      key={`${v.ref}-${v.wordForm}-${v.fromWord ?? ''}`}
                      v={v}
                      trMode={trMode}
                      onNavigate={onNavigate}
                      focusMeaning={note.meaning || heading}
                    />
                  ))}
                  {isMobile && visibleVerseCount < total && (
                    <div
                      className={`verse-sentinel${versesLoading ? ' is-loading' : ''}`}
                      ref={loadMoreRef}
                      role="status"
                      aria-label={versesLoading ? 'Loading more verses' : 'More verses load automatically'}
                    >
                      <span aria-hidden />
                    </div>
                  )}
                  {!isMobile && verseLimit < total && (
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
