# Quran Gbrain

Public **meaning graph** of Qur’anic words linked across surahs (and roots) — open in the browser or as an Obsidian vault.

**Nothing in the Qur’an text is “mine.”** See [ATTRIBUTION.md](ATTRIBUTION.md) for sources (Quran.com / Tanzil, Sahih International, Fatah Muhammad Jalandhari, Quranic Arabic Corpus, Lane lexicon).

## Try online

After deploy: Cloudflare Pages URL (connected to this repo’s `web/` app).

Search a meaning → animated **local graph** (Obsidian-style colors: Words / Roots / Surahs) → click a node → full verse in **Arabic + English + Urdu**. No LLM.

## Use locally in Obsidian

1. Clone this repo.
2. Open the folder `Quran-Gbrain/` as an Obsidian vault.
3. Open **Graph view** and set the filter to:

```text
path:Words OR path:Roots OR tag:#surah
```

4. Color groups (already in `.obsidian/graph.json`):

- `path:Words` — teal
- `path:Roots` — gold
- `tag:#surah` — amber

5. Prefer **Local graph** on a Word note for the cleanest experience.

## Contribute

PRs welcome for:

- Vault content improvements (labels, packing, sources clarity)
- Web viewer UX / mobile
- Export / build scripts

### Rebuild vault (optional)

Cached API data lives in `data/` (gitignored). If you have the cache:

```bash
python3 scripts/build_full_quran_vault.py
python3 scripts/export_web_graph.py
```

Then in `web/`:

```bash
npm ci
npm run build
```

## Stack

- Obsidian vault: `Quran-Gbrain/`
- Static viewer: `web/` (Vite + React + force-graph + MiniSearch)
- Host: Cloudflare Pages (`web` root, build `npm run build`, output `dist`)

## License

Project scripts and UI: MIT (see [LICENSE](LICENSE)). Third-party Qur’an text and translations remain under their own terms — see [ATTRIBUTION.md](ATTRIBUTION.md).
