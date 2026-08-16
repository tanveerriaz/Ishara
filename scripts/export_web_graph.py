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
NEIGHBORHOODS = OUT / "neighborhoods"

WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]")
FM = re.compile(r"^---\n(.*?)\n---\n", re.S)

# Obsidian graph.json rgb integers → hex
COLORS = {
    "word": "#c95e27",   # Obsidian Words — rgb 13196839
    "root": "#f8cd37",   # Obsidian Roots — rgb 16305463
    "surah": "#ffbf00",  # Obsidian Surahs — rgb 16760576
}

VERSE_PAGE = 12
NEIGHBORHOOD_MAX_NODES = 120
NEIGHBORHOOD_SURAH_BUDGET = 36
WORD_SEARCH_TERMS = "word words meaning literal gloss arabic english urdu translation ayah ayat verse reference"
ROOT_SEARCH_TERMS = "root roots meaning words arabic english urdu translation ayah ayat verse reference"
SURAH_SEARCH_TERMS = "surah sura surahs suwar sude chapter chapters ayah ayat verse quran qur'an quranic"

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
    # Vocalized romanization posing as English (qawala, walaja)
    if root_bw:
        rb = re.sub(r"[^a-z]", "", root_bw.lower())
        stripped = re.sub(r"[aeiou]", "", re.sub(r"[^a-z]", "", t))
        rb_stripped = re.sub(r"[aeiou]", "", rb)
        if rb_stripped and stripped == rb_stripped and t != rb:
            return True
    if re.fullmatch(r"[a-z]{3,10}", t):
        consonants = re.sub(r"[aeiou]", "", t)
        if 2 <= len(consonants) <= 4 and t.count("a") >= 2 and t.endswith("a"):
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


def search_refs(verses: list[dict], limit: int = 80) -> str:
    refs: list[str] = []
    seen: set[str] = set()
    for v in verses:
        ref = str(v.get("ref") or "").strip()
        if not ref or ref in seen:
            continue
        seen.add(ref)
        refs.append(ref)
        if ":" in ref:
            s, a = ref.split(":", 1)
            refs.extend(
                [
                    f"{s} {a}",
                    f"{int(s)}:{int(a)}" if s.isdigit() and a.isdigit() else ref,
                    f"ayah {ref}",
                f"ayat {ref}",
                f"aya {ref}",
                f"verse {s}:{a}",
            ]
            )
        if len(seen) >= limit:
            break
    return " ".join(refs)


def search_surahs(surahs: list[str], limit: int = 60) -> str:
    out: list[str] = []
    for s in surahs[:limit]:
        out.append(s)
        m = re.match(r"^0*(\d+)\s+(.+)$", s)
        if m:
            out.extend(
                [
                    m.group(1),
                    m.group(2),
                    f"surah {m.group(1)}",
                    f"sura {m.group(1)}",
                    f"sude {m.group(1)}",
                    f"chapter {m.group(1)}",
                ]
            )
    return " ".join(out)


def surah_ayah_terms(surah_n: str, ayah_count: int) -> str:
    if not str(surah_n).isdigit() or ayah_count <= 0:
        return ""
    s = int(surah_n)
    terms: list[str] = []
    for a in range(1, ayah_count + 1):
        ref = f"{s}:{a}"
        padded = f"{s:03d}:{a}"
        terms.extend(
            [
                ref,
                padded,
                f"ayah {ref}",
                f"ayat {ref}",
                f"aya {ref}",
                f"verse {ref}",
            ]
        )
    return " ".join(terms)


def semantic_aliases(*texts: str) -> str:
    joined = " ".join(t.lower() for t in texts if t)
    aliases: list[str] = []
    groups = [
        (("kindred", "relative", "relatives", "kinship", "near of kin"), "family families kin household relations"),
        (("wife", "wives", "spouse", "mate", "mates"), "family marriage spouse household"),
        (("children", "child", "sons", "daughters", "offspring"), "family children offspring descendants"),
        (("mother", "father", "parents", "brother", "sister"), "family parents siblings household"),
        (("people", "tribe", "nation", "community"), "community people nation tribe group"),
    ]
    for needles, words in groups:
        if any(n in joined for n in needles):
            aliases.append(words)
    return " ".join(aliases)


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


def build_adj(links: list[dict]) -> dict[str, set[str]]:
    adj: dict[str, set[str]] = {}
    for link in links:
        s = str(link["source"])
        t = str(link["target"])
        adj.setdefault(s, set()).add(t)
        adj.setdefault(t, set()).add(s)
    return adj


def neighborhood_ids(
    focus_id: str,
    nodes_by_id: dict[str, dict],
    adj: dict[str, set[str]],
    max_nodes: int = NEIGHBORHOOD_MAX_NODES,
) -> set[str]:
    """Precompute the same evidence-first local graph shape the UI prefers."""
    keep: set[str] = {focus_id}
    direct = adj.get(focus_id, set())

    def node_type(nid: str) -> str:
        return str(nodes_by_id.get(nid, {}).get("type", ""))

    for nid in direct:
        if node_type(nid) in {"word", "root"}:
            keep.add(nid)

    roots = {nid for nid in keep if node_type(nid) == "root"}
    if node_type(focus_id) == "root":
        roots.add(focus_id)
    for root_id in roots:
        keep.add(root_id)
        for nid in adj.get(root_id, set()):
            if node_type(nid) == "word":
                keep.add(nid)

    if node_type(focus_id) == "surah":
        for nid in sorted(direct, key=lambda x: (node_type(x), x)):
            if node_type(nid) in {"word", "root"}:
                keep.add(nid)
            if len(keep) >= max_nodes:
                break

    surahs: list[str] = []

    def add_surah(nid: str) -> None:
        if node_type(nid) == "surah" and nid not in surahs:
            surahs.append(nid)

    for nid in direct:
        add_surah(nid)
    if len(surahs) < NEIGHBORHOOD_SURAH_BUDGET:
        for kept_id in list(keep):
            if node_type(kept_id) != "word":
                continue
            for nid in adj.get(kept_id, set()):
                add_surah(nid)
                if len(surahs) >= NEIGHBORHOOD_SURAH_BUDGET:
                    break
            if len(surahs) >= NEIGHBORHOOD_SURAH_BUDGET:
                break

    for nid in surahs[:NEIGHBORHOOD_SURAH_BUDGET]:
        keep.add(nid)

    if len(keep) <= max_nodes:
        return keep

    def rank(nid: str) -> tuple[int, int, str]:
        if nid == focus_id:
            return (0, 0, nid)
        type_rank = {"root": 0, "word": 1, "surah": 2}.get(node_type(nid), 3)
        direct_rank = 0 if nid in direct else 1
        return (direct_rank, type_rank, nid)

    return set(sorted(keep, key=rank)[:max_nodes])


def write_neighborhoods(nodes: list[dict], links: list[dict], meta: dict) -> None:
    NEIGHBORHOODS.mkdir(parents=True, exist_ok=True)
    nodes_by_id = {str(n["id"]): n for n in nodes}
    adj = build_adj(links)
    for node_id in nodes_by_id:
        keep = neighborhood_ids(node_id, nodes_by_id, adj)
        n_links = [
            link
            for link in links
            if str(link["source"]) in keep and str(link["target"]) in keep
        ]
        data = {
            "nodes": [slim_node(nodes_by_id[nid]) for nid in sorted(keep)],
            "links": n_links,
            "colors": COLORS,
            "meta": {
                **meta,
                "nodeCount": len(keep),
                "linkCount": len(n_links),
                "focusId": node_id,
                "scope": "neighborhood",
            },
        }
        (NEIGHBORHOODS / f"{node_id}.json").write_text(
            json.dumps(data, ensure_ascii=False),
            encoding="utf-8",
        )


def slim_node(node: dict) -> dict:
    return {k: v for k, v in node.items() if k != "searchText"}


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
    NEIGHBORHOODS.mkdir(parents=True)

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
        summary = word_summary(meta, body, slug, full_verses)
        summary["meaning"] = meaning
        search = " ".join(
            [
                WORD_SEARCH_TERMS,
                slug,
                lemma,
                meaning,
                bw_part,
                meta.get("lemma", ""),
                semantic_aliases(slug, lemma, meaning),
            ]
        )
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
                "searchText": " ".join(
                    [
                        ROOT_SEARCH_TERMS,
                        slug,
                        arabic,
                        sense,
                        bw_part,
                        semantic_aliases(slug, arabic, sense),
                    ]
                ),
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
        hub = parse_surah_hub(body, slug, str(surah_n))
        ayah_terms = surah_ayah_terms(str(surah_n), int(hub.get("ayahCount") or 0))
        nodes.append(
            {
                "id": nid,
                "slug": slug,
                "type": "surah",
                "label": slug,
                "title": slug,
                "color": COLORS["surah"],
                "searchText": " ".join(
                    [
                        SURAH_SEARCH_TERMS,
                        slug,
                        f"surah {surah_n}",
                        f"sura {surah_n}",
                        f"sude {surah_n}",
                        f"chapter {surah_n}",
                        f"{int(surah_n)}" if str(surah_n).isdigit() else str(surah_n),
                        ayah_terms,
                    ]
                ),
                "surah": int(surah_n) if str(surah_n).isdigit() else 0,
            }
        )
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

    graph_meta = {
        "nodeCount": len(nodes),
        "linkCount": len(links),
        "attribution": "See /ATTRIBUTION.md — data from Quran.com, Sahih International, Jalandhari, Quranic Arabic Corpus, Lane lexicon.",
    }
    graph = {
        "nodes": [slim_node(n) for n in nodes],
        "links": links,
        "colors": COLORS,
        "meta": graph_meta,
    }
    (OUT / "graph.json").write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    write_neighborhoods(nodes, links, graph_meta)

    # Compact search index (ids + searchText only) — full graph also works
    search_docs = [
        {
            "id": n["id"],
            "slug": n["slug"],
            "type": n["type"],
            "label": n["label"],
            "title": n["title"],
            "searchText": n["searchText"],
        }
        for n in nodes
    ]
    (OUT / "search.json").write_text(json.dumps(search_docs, ensure_ascii=False), encoding="utf-8")

    print(f"Exported {len(nodes)} nodes, {len(links)} links → {OUT}")


if __name__ == "__main__":
    main()
