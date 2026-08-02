# Ishara Study UX + Speed Ship

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Ship a release that is both faster on click and richer for study — Obsidian-like graph controls, fuller surah notes, lazy verses, SI/Urdu toggle, and deep links — then deploy and push to GitHub.

**Architecture:** Keep the static Cloudflare Pages model. Slim note JSON (metadata + first-page verses); full verse bodies live in sibling `*.verses.json` files loaded on demand. Surah notes gain structured fields from the export. Graph stays Obsidian-colored with an Animate toggle. App reads/writes URL query for shareable focus.

**Tech Stack:** React + Vite + react-force-graph-2d, Python export scripts, Cloudflare Pages, Obsidian vault markdown.

## Global Constraints

- Open Obsidian on `vault/` only — never repo root.
- English-first graph labels; Arabic shown in the note panel after click.
- Sahih International + Urdu Jalandhari on verses (YA kept in data when present).
- No full mushaf text in Obsidian vault; web may show verse text from export cache.
- Tagline when used: **Curious mind. Builder mode! 🇸🇬**
- Do not commit secrets; `data/` stays gitignored.

## File map

| File | Responsibility |
|------|----------------|
| `scripts/export_web_graph.py` | Surah structured export; slim notes + `*.verses.json` |
| `scripts/build_full_quran_vault.py` | Optional surah hub text enrichment (if needed for markdown) |
| `web/src/types.ts` | Note / prefs / surah fields |
| `web/src/NotePanel.tsx` | Surah structured UI, SI/Urdu toggle, lazy verses, word jump |
| `web/src/GraphView.tsx` | `animate` prop wired to glow/particles/drift |
| `web/src/App.tsx` | Animate toggle, deep links, lazy verse fetch plumbing |
| `web/src/index.css` | Toggle + surah list styles |
| `docs/superpowers/plans/2026-08-02-ishara-study-speed-ship.md` | This plan |

---

### Task 1: Slim notes + full verses sidecar (speed)

**Files:** `scripts/export_web_graph.py`

- [x] After building each word/root note, write full verse list to `NOTES / f"{nid}.verses.json"`.
- [x] Keep only the first `VERSE_PAGE = 12` verses inside `{nid}.json`, plus `ayahCount`, `surahCount`, `versesTotal`, `versesFile: "{nid}.verses.json"`.
- [x] Surah notes: no huge verse dumps yet (see Task 2).
- [x] Run export and confirm a large root note JSON is much smaller than before while `.verses.json` holds all ayahs.

### Task 2: Richer surah structured export (study)

**Files:** `scripts/export_web_graph.py`

- [x] For each surah hub, parse Word / Root wikilinks and sample block (Arabic + SI + YA if present).
- [x] Emit structured fields: `meaning` (surah name), `words: string[]`, `roots: string[]`, `verses: NoteVerse[]` (ayah 1 sample at minimum; add up to 3 samples if present in body).
- [x] Set `surahCount` / `ayahCount` from frontmatter / chapter meta when available.

### Task 3: Types + App lazy verse loading

**Files:** `web/src/types.ts`, `web/src/App.tsx`

- [x] Extend `NoteData` with `versesTotal?`, `versesFile?`, `words?`, `roots?`.
- [x] In `selectId` / `loadNote`, after loading note, if `versesFile` exists and user expands, fetch `${BASE}data/notes/${versesFile}` (or always prefetch full verses in background after first paint).
- [x] Prefer: first paint with slim note; background `fetch(versesFile)` merge into note state when arriving so “Show more” is instant after a beat.

### Task 4: NotePanel study UX

**Files:** `web/src/NotePanel.tsx`, `web/src/index.css`

- [x] SI / Urdu toggle (localStorage `ishara-tr-mode`: `both` \| `en` \| `ur`).
- [x] Surah structured view: word/root link lists + sample verse cards (not raw HTML only).
- [x] Verse “Word here” / `fromWord` clickable → `onNavigate`.
- [x] Keep paginated “Show more” using full in-memory verses once loaded; show loading state for expand if still fetching.

### Task 5: Obsidian Animate toggle

**Files:** `web/src/GraphView.tsx`, `web/src/App.tsx`, `web/src/index.css`

- [x] Add prop `animate: boolean` (default true on desktop, false when `lowPower`).
- [x] When `animate` false: no glow RAF, no link particles, `d3AlphaTarget(0)`.
- [x] When true: soft glow refresh + particles in Local + gentle alphaTarget (current Obsidian-like behavior).
- [x] Header toggle button persisted in `localStorage` (`ishara-animate`).

### Task 6: Deep links

**Files:** `web/src/App.tsx`

- [x] On load, read `?focus=` (slug) or `?id=` (node id) → `selectId`.
- [x] On successful select, `history.replaceState` update query to `?focus=${encodeURIComponent(slug)}`.
- [x] Back button integration: don’t fight browser history; keep in-app Back as primary.

### Task 7: Verify, deploy, commit, push

- [x] `python3 scripts/export_web_graph.py`
- [x] `cd web && npm run build`
- [x] `npx wrangler pages deploy dist --project-name=ishara --commit-dirty=true`
- [x] Commit all ship changes with a clear message.
- [x] `git push -u origin HEAD`

## Test plan

- [x] Open a busy root (e.g. good/حسن): first paint fast; sidebar counts correct; Show more loads remaining verses.
- [x] Open a surah: see meaning words/roots lists + sample ayah, not empty HTML blob only.
- [x] Toggle EN / UR / both on a verse card.
- [x] Click “Word here” / fromWord navigates.
- [x] Animate off → quieter CPU; Animate on → particles/glow in Local.
- [x] Share `?focus=Hsn%20-%20good` opens that node.
- [x] Mobile stacked layout + resize handle still works.

## Out of scope (next ships)

- GBrain indexing
- Offline PWA
- Splitting `graph.json` into explore vs full (can follow if first paint still slow)
