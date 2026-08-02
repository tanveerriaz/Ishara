# Ishara

Public **meaning graph** of Qur’anic words linked across surahs (and roots) — open in the browser or as an Obsidian vault.

**Repo:** [github.com/tanveerriaz/Ishara](https://github.com/tanveerriaz/Ishara)

*Ishara* (إشارة) — signpost through the Qur’an’s connected meanings.

**Nothing in the Qur’an text is “mine.”** See [ATTRIBUTION.md](ATTRIBUTION.md) for sources (Quran.com / Tanzil, Sahih International, Fatah Muhammad Jalandhari, Quranic Arabic Corpus, Lane lexicon).

## Try online (Cloudflare Pages — free)

Connect this GitHub repo in the [Cloudflare Pages dashboard](https://dash.cloudflare.com/?to=/:account/pages):

| Setting | Value |
|--------|--------|
| Production branch | `main` |
| Root directory | `web` |
| Build command | `npm run build` |
| Build output directory | `dist` |

After the first deploy, open **https://ishara-5kc.pages.dev**.

On the site: search a meaning → animated **local graph** (Obsidian colors: Words / Roots / Surahs) → click a node → full verse in **Arabic + English + Urdu**. Works on phones. No LLM.

## Use locally in Obsidian

**Open only `vault/`** — never the repo root.

| Open this | Not this |
|-----------|----------|
| `…/Ishara/vault/` (Words, Roots, surah hubs) | `…/Ishara/` (includes `web/`, `data/`, `scripts/`) |

1. Clone this repo.
2. Obsidian → **Open folder as vault** → choose `vault/` (contains `Welcome.md`, `Words/`, `Roots/`).
3. **Graph view** filter (saved in `vault/.obsidian/graph.json`):

```text
path:Words OR path:Roots OR tag:#surah
```

4. Color groups:

- `path:Words` — teal (`#416464`)
- `path:Roots` — gold (`#e0b352`)
- `tag:#surah` — amber (`#ffbf00`)

5. Prefer **Local graph** on a Word note for the cleanest experience.

## Contribute

PRs welcome for vault labels, web UX/mobile, and build scripts.

### Rebuild vault (optional)

Cached API data lives in `/data` (gitignored). If you have the cache:

```bash
python3 scripts/build_full_quran_vault.py
python3 scripts/export_web_graph.py
cd web && npm ci && npm run build
```

## Stack

- Obsidian vault: `vault/`
- Static viewer: `web/` (Vite + React + force-graph + MiniSearch)
- Host: Cloudflare Pages (free)

## License

Project scripts and UI: MIT (see [LICENSE](LICENSE)). Third-party Qur’an text and translations remain under their own terms — see [ATTRIBUTION.md](ATTRIBUTION.md).
