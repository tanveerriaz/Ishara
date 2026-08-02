#!/usr/bin/env python3
"""Export Ishara vault → web/public/data for the static graph viewer."""

from __future__ import annotations

import json
import re
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
    "word": "#416464",   # 4287076
    "root": "#e0b352",   # 14725458
    "surah": "#ffbf00",  # 16760576
}


def safe_id(slug: str, kind: str = "") -> str:
    """URL-safe node id. Prefix by kind so word/root collisions can't share an id."""
    body = quote(slug.strip(), safe="")
    # Use "__" (not ":") so note filenames stay valid path segments in browsers.
    return f"{kind}__{body}" if kind else body


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
    # Keep readable text for note panel; drop instructions about Obsidian local graph
    body = re.sub(r"^Open \*\*Local graph\*\*.*$", "", body, flags=re.M)
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
        meaning_m = re.search(r"\*\*([^*]+)\*\*\s*·\s*Lemma", body)
        meaning = meaning_m.group(1).strip() if meaning_m else slug.split(" - ")[-1]
        search = " ".join([slug, lemma, meaning, meta.get("lemma", "")])
        nodes.append(
            {
                "id": nid,
                "slug": slug,
                "type": "word",
                "label": meaning if len(meaning) < 28 else slug.split(" - ")[-1],
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
        }
        (NOTES / f"{nid}.json").write_text(json.dumps(note, ensure_ascii=False), encoding="utf-8")

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
        # Prefer word id when resolving bare wikilinks that collide; keep root under typed keys.
        title_to_id[f"Roots/{path.stem}"] = nid
        title_to_id[f"root:{slug}"] = nid
        if slug not in title_to_id:
            title_to_id[slug] = nid
        if path.stem not in title_to_id:
            title_to_id[path.stem] = nid
        arabic = meta.get("arabic_root", "")
        sense_m = re.search(r"\*\*Sense:\*\*\s*([^\s·]+)", body)
        sense = sense_m.group(1) if sense_m else slug.split(" - ")[-1]
        nodes.append(
            {
                "id": nid,
                "slug": slug,
                "type": "root",
                "label": sense,
                "title": slug,
                "color": COLORS["root"],
                "searchText": f"{slug} {arabic} {sense}",
            }
        )
        note = {
            "id": nid,
            "slug": slug,
            "type": "root",
            "title": slug,
            "html": md_to_simple_html(strip_md_noise(body)),
        }
        (NOTES / f"{nid}.json").write_text(json.dumps(note, ensure_ascii=False), encoding="utf-8")

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
        note = {
            "id": nid,
            "slug": slug,
            "type": "surah",
            "title": slug,
            "html": md_to_simple_html(strip_md_noise(body)),
        }
        (NOTES / f"{nid}.json").write_text(json.dumps(note, ensure_ascii=False), encoding="utf-8")

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
