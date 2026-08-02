#!/usr/bin/env python3
"""Export Ishara vault → web/public/data for the static graph viewer."""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
VAULT = ROOT / "vault"
OUT = ROOT / "web" / "public" / "data"
NOTES = OUT / "notes"

WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]")
FM = re.compile(r"^---\n(.*?)\n---\n", re.S)

# Obsidian graph.json rgb integers → hex
COLORS = {
    "word": "#c95e27",   # Obsidian Words — rgb 13196839
    "root": "#f8cd37",   # Obsidian Roots — rgb 16305463
    "surah": "#ffbf00",  # Obsidian Surahs — rgb 16760576
}

VERSE_PAGE = 12

BW_STUB_CHARS = re.compile(r"^[a-z$'>]{2,8}$", re.I)
BW_HYPHEN = re.compile(r"^[a-z](?:-[a-z]){1,6}$", re.I)


def _norm_rom(s: str) -> str:
    t = (s or "").lower()
    for a, b in (
        ("$", "sh"),
        ("*", "dh"),
        ("v", "th"),
        (">", "a"),
        ("<", "i"),
        ("&", "w"),
        ("'", "a"),
        ("}", "i"),
        ("{", "a"),
    ):
        t = t.replace(a, b)
    return re.sub(r"[^a-z0-9]", "", t)


def looks_like_bw_stub(text: str, root_bw: str | None = None) -> bool:
    t = (text or "").strip().lower()
    if not t:
        return True
    if BW_HYPHEN.fullmatch(t):
        return True
    if " " in t:
        return False
    cleaned = re.sub(r"[^a-z0-9$'>]", "", t)
    if root_bw:
        rb = re.sub(r"[^a-z0-9$'>]", "", root_bw.lower())
        if cleaned == rb or _norm_rom(cleaned) == _norm_rom(rb):
            return True
    if BW_STUB_CHARS.fullmatch(cleaned) and not any(c in "aeiou" for c in cleaned):
        return True
    return False


def slug_parts(slug: str) -> tuple[str, str]:
    if " - " in slug:
        bw, rest = slug.split(" - ", 1)
        return bw.strip(), rest.strip()
    return slug.strip(), ""


def english_meaning(*candidates: str, root_bw: str | None = None, fallback: str = "root") -> str:
    for c in candidates:
        c = (c or "").strip()
        if not c:
            continue
        if looks_like_bw_stub(c, root_bw):
            continue
        return c
    return fallback


def write_note_disk(nid: str, note: dict) -> None:
    """Write slim note JSON; park full verses in a sidecar for lazy web loading."""
    verses = note.get("verses") or []
    if verses and note.get("type") in ("word", "root"):
        verses_name = f"{nid}.verses.json"
        (NOTES / verses_name).write_text(json.dumps(verses, ensure_ascii=False), encoding="utf-8")
        slim = {
            **note,
            "verses": verses[:VERSE_PAGE],
            "versesTotal": len(verses),
            "versesFile": verses_name,
        }
        (NOTES / f"{nid}.json").write_text(json.dumps(slim, ensure_ascii=False), encoding="utf-8")
        return
    (NOTES / f"{nid}.json").write_text(json.dumps(note, ensure_ascii=False), encoding="utf-8")


SURAH_SAMPLE = re.compile(
    r"## Sample[^\n]*\n+"
    r".*?<div[^>]*>\s*(?P<arabic>.*?)\s*</div>\s*"
    r"\*\*Sahih International:\*\*\s*(?P<si>[^\n]+)\s*"
    r"(?:\*\*Yusuf Ali:\*\*\s*(?P<ya>[^\n]+)\s*)?",
    re.S,
)


def parse_surah_hub(body: str, slug: str, surah_n: str) -> dict:
    words_block = re.search(r"## Words in this surah[^\n]*\n+((?:- \[\[[^\]]+\]\][^\n]*\n?)+)", body)
    roots_block = re.search(r"## Roots\s*\n+((?:- \[\[[^\]]+\]\]\n?)+)", body)
    words = WIKILINK.findall(words_block.group(1)) if words_block else []
    roots = WIKILINK.findall(roots_block.group(1)) if roots_block else []
    verses: list[dict] = []
    m = SURAH_SAMPLE.search(body)
    if m:
        s_num = surah_n if str(surah_n).isdigit() else slug[:3]
        verses.append(
            {
                "ref": f"{int(s_num)}:1",
                "surah": slug,
                "arabic": re.sub(r"\s+", " ", m.group("arabic")).strip(),
                "wordForm": "",
                "gloss": "Opening ayah",
                "sahihInternational": m.group("si").strip(),
                "yusufAli": (m.group("ya") or "").strip(),
                "urdu": "",
                "url": f"https://quran.com/{int(s_num)}/1",
            }
        )
    opener = re.search(r"^The .+ · (\d+) ayahs", body, re.M)
    ayah_count = int(opener.group(1)) if opener else 0
    return {
        "words": words,
        "roots": roots,
        "verses": verses,
        "ayahCount": ayah_count,
        "surahCount": 1,
        "meaning": slug.split(" ", 1)[-1] if " " in slug else slug,
    }


def safe_id(slug: str, kind: str = "") -> str:
    """Path + URL safe id. Avoid raw '%' so browsers don't mis-decode filenames."""
    body = quote(slug.strip(), safe="").replace("%", ".")
    return f"{kind}__{body}" if kind else body


VERSE_BLOCK = re.compile(
    r"####\s*(?P<ref>\d+:\d+)\s*·\s*\[\[(?P<surah>[^\]]+)\]\]\s*"
    r".*?<div[^>]*>\s*(?P<arabic>.*?)\s*</div>\s*"
    r"\*\*Word in this verse:\*\*\s*`(?P<form>[^`]+)`\s*—\s*(?P<gloss>[^\n]+)\s*"
    r"\*\*English \(Sahih International\):\*\*\s*(?P<si>[^\n]+)\s*"
    r"(?:\*\*English \(Yusuf Ali\):\*\*\s*(?P<ya>[^\n]+)\s*)?"
    r"(?:\*\*Urdu[^*]*:\*\*\s*(?P<urdu>[^\n]+)\s*)?"
    r"(?:\[Open on Quran\.com\]\((?P<url>https?://[^)]+)\))?",
    re.S,
)


def parse_verses(body: str) -> list[dict]:
    out = []
    for m in VERSE_BLOCK.finditer(body):
        ref = m.group("ref")
        s, a = ref.split(":")
        out.append(
            {
                "ref": ref,
                "surah": m.group("surah").strip(),
                "arabic": re.sub(r"\s+", " ", m.group("arabic")).strip(),
                "wordForm": m.group("form").strip(),
                "gloss": m.group("gloss").strip(),
                "sahihInternational": m.group("si").strip(),
                "yusufAli": (m.group("ya") or "").strip(),
                "urdu": (m.group("urdu") or "").strip(),
                "url": (m.group("url") or f"https://quran.com/{s}/{a}").strip(),
            }
        )
    return out


def word_summary(meta: dict, body: str, slug: str, full_verses: dict[str, list] | None = None) -> dict:
    meaning_m = re.search(r"\*\*([^*]+)\*\*\s*·\s*Lemma\s*\*\*([^*]+)\*\*", body)
    root_m = re.search(r"### Root\s*\n-\s*\[\[([^\]]+)\]\]", body)
    surahs = re.findall(r"### Surahs[^\n]*\n((?:- \[\[[^\]]+\]\]\n?)+)", body)
    surah_list = WIKILINK.findall(surahs[0]) if surahs else []
    verses = (full_verses or {}).get(slug) or parse_verses(body)
    ayah_count = int(meta.get("ayah_count") or 0) or len(verses)
    return {
        "meaning": meaning_m.group(1).strip() if meaning_m else slug.split(" - ")[-1],
        "lemma": (meaning_m.group(2).strip() if meaning_m else meta.get("lemma", "")),
        "root": root_m.group(1).strip() if root_m else "",
        "surahCount": int(meta.get("surah_count") or len(surah_list) or 0),
        "ayahCount": ayah_count,
        "surahs": surah_list,
        "verses": verses,
    }


def parse_frontmatter(text: str) -> tuple[dict, str]:
    m = FM.match(text)
    if not m:
        return {}, text
    meta: dict = {}
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta, text[m.end() :]


def wikilinks(body: str) -> list[str]:
    out = []
    for m in WIKILINK.finditer(body):
        target = m.group(1).strip()
        if target.startswith("http") or target in ("Welcome", "Word Index", "Surah Index", "Meta/Sources"):
            continue
        out.append(target)
    return out


def strip_md_noise(body: str) -> str:
    # Keep readable Qur’an content; drop vault/tooling chrome
    body = re.sub(r"^Open \*\*Local graph\*\*.*$", "", body, flags=re.M)
    body = re.sub(r"(?i)obsidian", "", body)
    body = re.sub(r"(?im)^.*(github\.com|quran-gbrain|OPEN-IN-OBSIDIAN).*$", "", body)
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body.strip()


def md_to_simple_html(body: str) -> str:
    """Lightweight markdown → HTML for the note panel (no external deps)."""
    lines = body.splitlines()
    html_parts: list[str] = []
    in_rtl = False
    buf: list[str] = []

    def flush_p():
        nonlocal buf
        if not buf:
            return
        text = " ".join(buf).strip()
        buf = []
        if not text:
            return
        text = WIKILINK.sub(
            lambda m: f'<a href="#" data-slug="{m.group(1).strip()}">{m.group(1).strip()}</a>',
            text,
        )
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
        text = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r'<a href="\2" target="_blank" rel="noopener">\1</a>', text)
        html_parts.append(f"<p>{text}</p>")

    i = 0
    while i < len(lines):
        line = lines[i]
        if line.strip().startswith('<div dir="rtl"'):
            flush_p()
            i += 1
            ar = []
            while i < len(lines) and "</div>" not in lines[i]:
                if lines[i].strip():
                    ar.append(lines[i].strip())
                i += 1
            html_parts.append(
                f'<div class="arabic" dir="rtl" lang="ar">{"".join(ar)}</div>'
            )
            while i < len(lines) and "</div>" not in lines[i]:
                i += 1
            i += 1
            continue
        if line.startswith("#### "):
            flush_p()
            title = line[5:].strip()
            title = WIKILINK.sub(lambda m: m.group(1).strip(), title)
            html_parts.append(f"<h4>{title}</h4>")
            i += 1
            continue
        if line.startswith("### "):
            flush_p()
            html_parts.append(f"<h3>{line[4:].strip()}</h3>")
            i += 1
            continue
        if line.startswith("## "):
            flush_p()
            html_parts.append(f"<h2>{line[3:].strip()}</h2>")
            i += 1
            continue
        if line.startswith("# "):
            flush_p()
            i += 1
            continue
        if line.startswith("- "):
            flush_p()
            items = []
            while i < len(lines) and lines[i].startswith("- "):
                item = lines[i][2:].strip()
                item = WIKILINK.sub(
                    lambda m: f'<a href="#" data-slug="{m.group(1).strip()}">{m.group(1).strip()}</a>',
                    item,
                )
                item = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", item)
                item = re.sub(r"`([^`]+)`", r"<code>\1</code>", item)
                items.append(f"<li>{item}</li>")
                i += 1
            html_parts.append("<ul>" + "".join(items) + "</ul>")
            continue
        if not line.strip():
            flush_p()
            i += 1
            continue
        if line.startswith(">"):
            flush_p()
            i += 1
            continue
        buf.append(line.strip())
        i += 1
    flush_p()
    return "\n".join(html_parts)


def main() -> None:
    if OUT.exists():
        import shutil

        shutil.rmtree(OUT)
    NOTES.mkdir(parents=True)

    nodes: list[dict] = []
    links: list[dict] = []
    title_to_id: dict[str, str] = {}
    edge_set: set[tuple[str, str]] = set()

    def add_edge(a: str, b: str) -> None:
        if a == b:
            return
        key = (a, b) if a < b else (b, a)
        if key in edge_set:
            return
        edge_set.add(key)
        links.append({"source": a, "target": b})

    word_notes_by_slug: dict[str, dict] = {}
    full_verses_path = ROOT / "data" / "word_verses_full.json"
    full_verses: dict[str, list] = {}
    if full_verses_path.exists():
        full_verses = json.loads(full_verses_path.read_text(encoding="utf-8"))
        print(f"Loaded full verses for {len(full_verses)} words")
    else:
        print("WARNING: data/word_verses_full.json missing — falling back to vault samples")

    # --- Words ---
    for path in sorted((VAULT / "Words").glob("*.md")):
        text = path.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(text)
        slug = meta.get("slug") or path.stem
        nid = safe_id(slug, "word")
        title_to_id[slug] = nid
        title_to_id[path.stem] = nid
        title_to_id[f"Words/{path.stem}"] = nid
        lemma = meta.get("lemma", "")
        bw_part, slug_gloss = slug_parts(slug)
        meaning_m = re.search(r"\*\*([^*]+)\*\*\s*·\s*Lemma", body)
        raw_meaning = meaning_m.group(1).strip() if meaning_m else slug_gloss
        meaning = english_meaning(raw_meaning, slug_gloss, root_bw=bw_part, fallback="word")
        label = meaning if len(meaning) < 28 else " ".join(meaning.split()[:3])
        search = " ".join([slug, lemma, meaning, bw_part, meta.get("lemma", "")])
        summary = word_summary(meta, body, slug, full_verses)
        summary["meaning"] = meaning
        nodes.append(
            {
                "id": nid,
                "slug": slug,
                "type": "word",
                "label": label,
                "title": slug,
                "color": COLORS["word"],
                "searchText": search,
                "surahCount": int(meta.get("surah_count") or 0),
                "ayahCount": int(meta.get("ayah_count") or 0),
            }
        )
        note = {
            "id": nid,
            "slug": slug,
            "type": "word",
            "title": slug,
            "html": md_to_simple_html(strip_md_noise(body)),
            **summary,
        }
        word_notes_by_slug[slug] = note
        word_notes_by_slug[path.stem] = note
        write_note_disk(nid, note)

    word_targets: dict[str, list[str]] = {}
    for path in sorted((VAULT / "Words").glob("*.md")):
        text = path.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(text)
        slug = meta.get("slug") or path.stem
        word_targets[slug] = wikilinks(body)

    # --- Roots ---
    for path in sorted((VAULT / "Roots").glob("*.md")):
        text = path.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(text)
        slug = meta.get("slug") or path.stem
        nid = safe_id(slug, "root")
        title_to_id[f"Roots/{path.stem}"] = nid
        title_to_id[f"root:{slug}"] = nid
        if slug not in title_to_id:
            title_to_id[slug] = nid
        if path.stem not in title_to_id:
            title_to_id[path.stem] = nid
        arabic = meta.get("arabic_root", "")
        bw_part, slug_gloss = slug_parts(slug)
        sense_m = re.search(r"\*\*Sense:\*\*\s*([^\n·]+)", body)
        raw_sense = sense_m.group(1).strip() if sense_m else slug_gloss
        linked = wikilinks(body)
        linked_words = [w for w in linked if w in word_notes_by_slug]
        # Prefer common English senses from linked lemmas when Sense is a BW stub.
        word_meanings = [
            word_notes_by_slug[w].get("meaning", "")
            for w in linked_words
            if word_notes_by_slug[w].get("meaning")
        ]
        ranked_meanings = [g for g, _ in Counter(word_meanings).most_common()]
        sense = english_meaning(
            raw_sense,
            slug_gloss,
            *ranked_meanings,
            root_bw=bw_part,
            fallback="root",
        )
        label = sense if len(sense) < 28 else " ".join(sense.split()[:3])
        verses: list[dict] = []
        seen_refs: set[str] = set()
        surah_set: set[str] = set()
        ayah_set: set[str] = set()
        for wslug in linked_words:
            wn = word_notes_by_slug[wslug]
            for s in wn.get("surahs") or []:
                surah_set.add(s)
            for v in wn.get("verses") or []:
                if v.get("surah"):
                    surah_set.add(v["surah"])
                if v.get("ref"):
                    ayah_set.add(v["ref"])
                key = f"{v['ref']}|{v.get('wordForm', '')}"
                if key in seen_refs:
                    continue
                seen_refs.add(key)
                verses.append({**v, "fromWord": wslug})
        # Prefer corpus coverage via linked words — not the truncated `001, 002…` preview on the root note.
        surah_from_verse = sorted(surah_set)
        surah_count = len(surah_set)
        ayah_count = len(ayah_set)
        nodes.append(
            {
                "id": nid,
                "slug": slug,
                "type": "root",
                "label": label,
                "title": slug,
                "color": COLORS["root"],
                "searchText": f"{slug} {arabic} {sense} {bw_part}",
                "surahCount": surah_count,
                "ayahCount": ayah_count,
            }
        )
        note = {
            "id": nid,
            "slug": slug,
            "type": "root",
            "title": slug,
            "html": md_to_simple_html(strip_md_noise(body)),
            "meaning": sense,
            "lemma": arabic,
            "surahCount": surah_count,
            "ayahCount": ayah_count,
            "surahs": surah_from_verse,
            "verses": verses,
            "root": slug,
            "words": linked_words,
        }
        write_note_disk(nid, note)

    root_targets: dict[str, list[str]] = {}
    for path in sorted((VAULT / "Roots").glob("*.md")):
        text = path.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(text)
        slug = meta.get("slug") or path.stem
        root_targets[slug] = wikilinks(body)

    # --- Surah hubs ---
    for path in sorted(VAULT.glob("[0-9][0-9][0-9] *.md")):
        text = path.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(text)
        slug = path.stem
        nid = safe_id(slug, "surah")
        title_to_id[slug] = nid
        surah_n = meta.get("surah", slug[:3])
        nodes.append(
            {
                "id": nid,
                "slug": slug,
                "type": "surah",
                "label": slug,
                "title": slug,
                "color": COLORS["surah"],
                "searchText": f"{slug} surah {surah_n}",
                "surah": int(surah_n) if str(surah_n).isdigit() else 0,
            }
        )
        hub = parse_surah_hub(body, slug, str(surah_n))
        note = {
            "id": nid,
            "slug": slug,
            "type": "surah",
            "title": slug,
            "html": md_to_simple_html(strip_md_noise(body)),
            "meaning": hub["meaning"],
            "words": hub["words"],
            "roots": hub["roots"],
            "verses": hub["verses"],
            "ayahCount": hub["ayahCount"],
            "surahCount": 1,
            "lemma": "",
        }
        write_note_disk(nid, note)

    surah_targets: dict[str, list[str]] = {}
    for path in sorted(VAULT.glob("[0-9][0-9][0-9] *.md")):
        text = path.read_text(encoding="utf-8")
        _, body = parse_frontmatter(text)
        surah_targets[path.stem] = wikilinks(body)

    def resolve(name: str) -> str | None:
        if name in title_to_id:
            return title_to_id[name]
        # try without path prefixes
        for k, v in title_to_id.items():
            if k.endswith(name) or name.endswith(k):
                return v
        return None

    for slug, targets in word_targets.items():
        src = safe_id(slug, "word")
        for t in targets:
            dst = resolve(t)
            if dst:
                add_edge(src, dst)

    for slug, targets in root_targets.items():
        src = safe_id(slug, "root")
        for t in targets:
            dst = resolve(t)
            if dst:
                add_edge(src, dst)

    for slug, targets in surah_targets.items():
        src = title_to_id[slug]
        for t in targets:
            dst = resolve(t)
            if dst:
                add_edge(src, dst)

    graph = {
        "nodes": nodes,
        "links": links,
        "colors": COLORS,
        "meta": {
            "nodeCount": len(nodes),
            "linkCount": len(links),
            "attribution": "See /ATTRIBUTION.md — data from Quran.com, Sahih International, Jalandhari, Quranic Arabic Corpus, Lane lexicon.",
        },
    }
    (OUT / "graph.json").write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")

    # Compact search index (ids + searchText only) — full graph also works
    search_docs = [
        {"id": n["id"], "slug": n["slug"], "type": n["type"], "label": n["label"], "searchText": n["searchText"]}
        for n in nodes
    ]
    (OUT / "search.json").write_text(json.dumps(search_docs, ensure_ascii=False), encoding="utf-8")

    print(f"Exported {len(nodes)} nodes, {len(links)} links → {OUT}")


if __name__ == "__main__":
    main()
