#!/usr/bin/env python3
"""
Audit word/root English sense mismatches in the Ishara vault (read-only).

Flags pairs where the word gloss and its root sense share no content token.
Useful after rebuilds to spot Lane/WBW drift.

Usage:
  python3 scripts/audit_word_root_senses.py
  python3 scripts/audit_word_root_senses.py --limit 40
"""

from __future__ import annotations

import argparse
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VAULT = ROOT / "vault"
WORD_DIR = VAULT / "Words"
ROOT_DIR = VAULT / "Roots"

STOP = {
    "the", "a", "an", "of", "to", "for", "and", "or", "in", "on", "be", "is", "are",
    "this", "that", "those", "who", "whom", "which", "most", "their", "his", "her",
    "your", "our", "with", "from", "into", "upon", "over", "under", "not", "no",
    "word", "root", "any", "something", "someone", "being",
}


def stem(w: str) -> str:
    if len(w) > 5 and w.endswith("ing"):
        return w[:-3]
    if len(w) > 4 and w.endswith("ed"):
        return w[:-2]
    if len(w) > 4 and w.endswith("es"):
        return w[:-2]
    if len(w) > 3 and w.endswith("s"):
        return w[:-1]
    return w


def tokens(text: str) -> set[str]:
    out: set[str] = set()
    for raw in re.findall(r"[a-z]{3,}", (text or "").lower()):
        if raw in STOP:
            continue
        out.add(stem(raw))
    return out


def sense_from_slug(stem_name: str) -> str:
    if " - " in stem_name:
        return stem_name.split(" - ", 1)[1].strip()
    return stem_name.strip()


def parse_root_link(body: str) -> str | None:
    m = re.search(r"###\s*Root\s*\n-\s*\[\[([^\]]+)\]\]", body)
    return m.group(1).strip() if m else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=50, help="Max mismatches to print")
    args = ap.parse_args()

    root_senses: dict[str, str] = {}
    for path in ROOT_DIR.glob("*.md"):
        root_senses[path.stem] = sense_from_slug(path.stem)

    mismatches: list[tuple[int, str, str, str, str]] = []
    by_root: dict[str, list[str]] = defaultdict(list)

    for path in WORD_DIR.glob("*.md"):
        text = path.read_text(encoding="utf-8")
        word_sense = sense_from_slug(path.stem)
        root_slug = parse_root_link(text)
        if not root_slug:
            continue
        root_sense = root_senses.get(root_slug, sense_from_slug(root_slug))
        wt, rt = tokens(word_sense), tokens(root_sense)
        if not wt or not rt:
            continue
        if wt & rt:
            continue
        overlap_score = 0
        mismatches.append((overlap_score, path.stem, word_sense, root_slug, root_sense))
        by_root[root_slug].append(path.stem)

    mismatches.sort(key=lambda row: (-len(by_root[row[3]]), row[1]))
    print(f"Word notes scanned under {WORD_DIR}")
    print(f"Mismatches (no shared gloss token): {len(mismatches)}")
    print()
    for i, (_, word, ws, root, rs) in enumerate(mismatches[: args.limit], 1):
        print(f"{i:3}. {word}")
        print(f"     word: {ws}")
        print(f"     root: {root} → {rs}")
    if len(mismatches) > args.limit:
        print(f"\n… {len(mismatches) - args.limit} more")


if __name__ == "__main__":
    main()
