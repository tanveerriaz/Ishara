#!/usr/bin/env python3
"""Spot-check build-time Urdu verse hits (precision over coverage)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from gloss_urdu import normalize_urdu, slug_sense, urdu_hits_for_verse  # noqa: E402

VERSES_PATH = ROOT / "data" / "word_verses_full.json"
MAP_PATH = ROOT / "data" / "gloss_urdu_map.json"

# gloss substring → at least one of these surface forms must appear in urduHits
EXPECT_ANY = [
    ("easy", ("آسان", "اسان")),
    ("quran", ("قرآن", "قران")),
    ("mercy", ("رحمت", "مہربانی", "مهرباني", "رحم")),
    ("provision", ("رزق", "روزی", "روزي")),
]

FP_NEEDLES = ("کا", "ہاں", "هاں")


def main() -> int:
    if not VERSES_PATH.exists() or not MAP_PATH.exists():
        print(f"Missing {VERSES_PATH.name} or {MAP_PATH.name} — run vault build first", file=sys.stderr)
        return 2

    data = json.loads(VERSES_PATH.read_text(encoding="utf-8"))
    gloss_map = json.loads(MAP_PATH.read_text(encoding="utf-8"))
    errors: list[str] = []

    for needle, allowed in EXPECT_ANY:
        found = False
        sample_hits: list[str] = []
        for slug, verses in data.items():
            sense = slug_sense(slug)
            for v in verses:
                g = (v.get("gloss") or "").lower()
                if needle not in g:
                    continue
                hits = v.get("urduHits") or urdu_hits_for_verse(
                    str(v.get("gloss") or ""),
                    str(v.get("urdu") or ""),
                    str(v.get("wordForm") or ""),
                    gloss_map,
                    sense,
                )
                if not hits:
                    continue
                sample_hits.append(f"{v.get('ref')} {hits}")
                norms = {normalize_urdu(h) for h in hits}
                if any(normalize_urdu(a) in norms for a in allowed):
                    found = True
                    print(f"OK {needle}: {v.get('ref')} → {hits}")
                    break
            if found:
                break
        if not found:
            errors.append(f"no hit for gloss containing {needle!r} among {allowed} (saw {sample_hits[:3]})")

    # False-positive guard on a known easy verse
    easy_fp_ok = False
    for slug, verses in data.items():
        if "ysyr" not in slug and "ysr" not in slug:
            continue
        sense = slug_sense(slug)
        for v in verses:
            if "easy" not in (v.get("gloss") or "").lower():
                continue
            hits = v.get("urduHits") or urdu_hits_for_verse(
                str(v.get("gloss") or ""),
                str(v.get("urdu") or ""),
                str(v.get("wordForm") or ""),
                gloss_map,
                sense,
            )
            hit_norms = {normalize_urdu(h) for h in hits}
            bad = [fp for fp in FP_NEEDLES if normalize_urdu(fp) in hit_norms]
            if bad:
                errors.append(f"false positive on {v.get('ref')}: {bad} in {hits}")
            else:
                easy_fp_ok = True
                print(f"OK no FP on easy {v.get('ref')}: {hits}")
            break
        if easy_fp_ok or errors:
            break
    if not easy_fp_ok and not any("false positive" in e for e in errors):
        errors.append("could not find an easy verse for FP check")

    if errors:
        print("FAIL:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print("All spot-checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
