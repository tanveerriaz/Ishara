#!/usr/bin/env python3
"""Build-time English WBW gloss → Urdu token alignment (PMI) for verse highlighting."""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict

EN_STOP = {
    "the", "a", "an", "of", "to", "for", "and", "or", "in", "on", "be", "is", "are",
    "this", "that", "those", "who", "whom", "which", "most", "their", "his", "her",
    "your", "our", "with", "from", "into", "upon", "over", "under", "not", "no",
    "was", "were", "been", "being", "have", "has", "had", "will", "would", "shall",
    "should", "may", "might", "can", "could", "do", "does", "did", "its", "as", "at",
    "by", "if", "so", "than", "then", "too", "very", "just", "also", "only", "into",
}

UR_STOP_RAW = """
كا كي كے كو سے میں ميں پر اور جو وہ یہ يہ نه نہ اگر تو ہی هي بھی بهي ہے ہيں ہيں
تھا تھی تھے گے گي گا ہو ایک ايک سب بعد لے ليے لیے طرف ساتھ اپنے اپني اس ان
كيوں كيا کیا والے والا والي والے كرتے كرتا كرتی كرنا الے الے ہی تو پر وہ جو
گئے گئي گئے گئي ہوگا ہوگي ہوں ہونگا ہونگي مگر ليكن لیکن جب تك تک پھر پھر
اپنا اپنى اب ہی كچھ کچھ تمام بہت زياده زیادہ كسي كسى كسى كسی انھيں انہیں
اسے اسے انہوں انہوں نے نے دي ديے دیا ديا كر كے ہوئى ہوئي ہوئے ہوا ہوے
تاكه تاکہ جائي جائے جائيں جائیں گيا گیا گئي گئی كريں كريں
اپني اپنی تمہاري تمہاری تمہارا ہمارے ہمارا كويي کوئی يها یہاں
كرديا كردی كردے هوي ہوئی
"""

_DIAC = re.compile(r"[\u064B-\u065F\u0670\u06D6-\u06ED]")
_UR_WORD = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+")
_PUNCT_TAIL = re.compile(r"[؟۔،؛:!!\.?؟]+$")


def stem_en(word: str) -> str:
    if len(word) > 5 and word.endswith("ing"):
        return word[:-3]
    if len(word) > 4 and word.endswith("ed"):
        return word[:-2]
    if len(word) > 4 and word.endswith("es"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s"):
        return word[:-1]
    return word


def gloss_stems(gloss: str) -> list[str]:
    low = re.sub(r"[^a-z\s']", " ", (gloss or "").lower())
    out: list[str] = []
    seen: set[str] = set()
    for raw in low.split():
        w = raw.strip("'")
        if len(w) < 3 or w in EN_STOP:
            continue
        for t in (w, stem_en(w)):
            if t not in seen and t not in EN_STOP and len(t) >= 3:
                seen.add(t)
                out.append(t)
    return out


def normalize_urdu(text: str) -> str:
    t = _DIAC.sub("", text or "")
    t = (
        t.replace("آ", "ا")
        .replace("أ", "ا")
        .replace("إ", "ا")
        .replace("ٱ", "ا")
        .replace("ی", "ي")
        .replace("ى", "ي")
        .replace("ے", "ي")
        .replace("ک", "ك")
        .replace("ہ", "ه")
        .replace("ة", "ه")
        .replace("ؤ", "و")
        .replace("ئ", "ي")
        .replace("ں", "ن")
    )
    t = _PUNCT_TAIL.sub("", t)
    return re.sub(r"[^\u0621-\u064A\u0660-\u0669]", "", t)


def urdu_tokens(text: str) -> list[tuple[str, str]]:
    """Return (surface, normalized) tokens from Urdu verse text."""
    out: list[tuple[str, str]] = []
    for m in _UR_WORD.finditer(text or ""):
        surface = _PUNCT_TAIL.sub("", m.group(0))
        norm = normalize_urdu(surface)
        if len(norm) >= 2:
            out.append((surface, norm))
    return out


def _build_ur_stop() -> set[str]:
    stop: set[str] = set()
    for w in UR_STOP_RAW.split():
        n = normalize_urdu(w)
        if n:
            stop.add(n)
    # Extra frequent particles
    for w in (
        "كا", "كي", "كے", "كو", "سے", "میں", "پر", "اور", "جو", "وہ", "يہ", "یہ",
        "نه", "نہ", "اگر", "تو", "هي", "ہی", "بهي", "بھی", "ہے", "ہيں", "ہیں",
        "تھا", "تھی", "تھے", "گا", "گي", "گے", "هو", "ہو", "ايک", "ایک", "سب",
    ):
        n = normalize_urdu(w)
        if n:
            stop.add(n)
    return stop


UR_STOP = _build_ur_stop()


def normalize_arabic_form(text: str) -> str:
    t = normalize_urdu(text)
    if t.startswith("ال") and len(t) > 4:
        return t[2:]
    return t


def slug_sense(slug: str) -> str:
    """English sense from `bw - meaning` slug (empty if none)."""
    if " - " not in (slug or ""):
        return ""
    return slug.split(" - ", 1)[1].strip()


def build_gloss_urdu_map(
    verses_by_word: dict[str, list[dict]],
    *,
    min_cooc: int = 5,
    top_k: int = 4,
    max_df_ratio: float = 0.12,
    min_pmi: float = 1.8,
    min_support_frac: float = 0.15,
) -> dict[str, list[str]]:
    """
    PMI map: English gloss stem → top Urdu normalized tokens.
    `verses_by_word` keys are word slugs (`bw - meaning`); values have `gloss` + `urdu`.
    """
    df_tok: Counter[str] = Counter()
    pair: Counter[tuple[str, str]] = Counter()
    gloss_df: Counter[str] = Counter()
    n_docs = 0

    for slug, verses in verses_by_word.items():
        sense = slug_sense(slug)
        for v in verses:
            stems = gloss_stems(str(v.get("gloss") or ""))
            for st in gloss_stems(sense):
                if st not in stems:
                    stems.append(st)
            if not stems:
                continue
            toks = [
                norm
                for _surf, norm in urdu_tokens(str(v.get("urdu") or ""))
                if norm not in UR_STOP and len(norm) >= 2
            ]
            if not toks:
                continue
            n_docs += 1
            uniq = set(toks)
            for t in uniq:
                df_tok[t] += 1
            stem_set = set(stems)
            for st in stem_set:
                gloss_df[st] += 1
                for t in uniq:
                    pair[(st, t)] += 1

    if n_docs == 0:
        return {}

    by_stem: dict[str, list[tuple[float, int, str]]] = defaultdict(list)
    for (st, tok), c in pair.items():
        gdf = gloss_df[st]
        tdf = df_tok[tok]
        need = max(min_cooc, int(math.ceil(min_support_frac * gdf)))
        if c < need:
            continue
        if tdf / n_docs > max_df_ratio:
            continue
        # PMI with +1 smoothing; boost by log(count) for support
        pmi = math.log((c * n_docs) / (gdf * tdf + 1e-9) + 1e-12)
        if pmi < min_pmi:
            continue
        score = pmi + 0.45 * math.log(c + 1) + 0.15 * len(tok)
        by_stem[st].append((score, c, tok))

    out: dict[str, list[str]] = {}
    for st, rows in by_stem.items():
        rows.sort(key=lambda r: (-r[0], -r[1], r[2]))
        chosen: list[str] = []
        for _score, _c, tok in rows:
            if tok in chosen:
                continue
            if len(tok) < 2:
                continue
            chosen.append(tok)
            if len(chosen) >= top_k:
                break
        if chosen:
            out[st] = chosen
    return out


def urdu_hits_for_verse(
    gloss: str,
    urdu: str,
    word_form: str,
    gloss_map: dict[str, list[str]],
    *extra_senses: str,
) -> list[str]:
    """Surface-form Urdu tokens to highlight in this verse."""
    tokens = urdu_tokens(urdu)
    if not tokens:
        return []

    by_norm: dict[str, str] = {}
    for surface, norm in tokens:
        prev = by_norm.get(norm)
        if prev is None or len(surface) > len(prev):
            by_norm[norm] = surface

    candidates: list[str] = []
    seen: set[str] = set()

    def add_norm(norm: str) -> None:
        if norm in seen or norm in UR_STOP:
            return
        surface = by_norm.get(norm)
        if surface:
            seen.add(norm)
            candidates.append(surface)
            return
        if len(norm) < 3:
            return
        # Only allow light inflection that extends the map token (آسان → آسانوں)
        for n2, surf2 in by_norm.items():
            if n2 in seen or n2 in UR_STOP:
                continue
            if not n2.startswith(norm):
                continue
            if len(n2) - len(norm) > 4:
                continue
            seen.add(n2)
            candidates.append(surf2)
            return

    stems_gloss = gloss_stems(gloss)
    stems_extra: list[str] = []
    stem_seen = set(stems_gloss)
    for src in extra_senses:
        for st in gloss_stems(src):
            if st not in stem_seen:
                stem_seen.add(st)
                stems_extra.append(st)

    def apply_stems(stems: list[str]) -> None:
        for st in stems:
            before = len(candidates)
            for norm in gloss_map.get(st, []):
                add_norm(norm)
                if len(candidates) > before:
                    break  # one distinctive Urdu hit per English stem

    apply_stems(stems_gloss)
    # Word-sense stems only fill gaps (sparse WBW gloss), avoid stacking extras
    if not candidates and stems_extra:
        apply_stems(stems_extra)

    # Arabic loanword fallback (قرآن etc.) — exact normalized equality only
    loan = normalize_arabic_form(word_form)
    if loan and len(loan) >= 4 and loan not in UR_STOP:
        add_norm(loan)

    return candidates[:3]
