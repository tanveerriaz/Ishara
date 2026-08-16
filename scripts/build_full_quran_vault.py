#!/usr/bin/env python3
"""
Ishara — FAST Obsidian vault (meaning graph only).

Design for load speed:
- No per-ayah files
- No full mushaf text inside Obsidian (reading via Quran.com links)
- Word notes only for lemmas that appear in 3+ surahs (cross-surah graph)
- Tight wikilink caps so Obsidian is not resolving 100k+ links on startup
"""

from __future__ import annotations

import html
import json
import re
import shutil
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gloss_urdu import build_gloss_urdu_map, slug_sense, urdu_hits_for_verse  # noqa: E402
DATA = ROOT / "data"
VAULT = ROOT / "vault"
ROOT_DIR = VAULT / "Roots"
WORD_DIR = VAULT / "Words"
META_DIR = VAULT / "Meta"

MIN_SURAHS_FOR_WORD = 3
MIN_AYAHS_FOR_SPLIT_WORD = 2
MAX_WORDS_PER_SURAH = 25
MAX_SURAHS_LISTED = 25
MAX_WORDS_PER_ROOT = 25
MAX_OCC_LINES = 10  # full verses per word note (Arabic + SI + Yusuf Ali + Urdu)

AR_TO_BW = {
    "ء": "'", "آ": "A", "أ": ">", "ؤ": "&", "إ": "<", "ئ": "}",
    "ا": "A", "ب": "b", "ة": "p", "ت": "t", "ث": "v", "ج": "j",
    "ح": "H", "خ": "x", "د": "d", "ذ": "*", "ر": "r", "ز": "z",
    "س": "s", "ش": "$", "ص": "S", "ض": "D", "ط": "T", "ظ": "Z",
    "ع": "E", "غ": "g", "ف": "f", "ق": "q", "ك": "k", "ل": "l",
    "م": "m", "ن": "n", "ه": "h", "و": "w", "ى": "Y", "ي": "y",
    "ٱ": "{",
}
STOP = {
    "the", "a", "an", "of", "to", "for", "and", "or", "in", "on", "be", "is", "are",
    "this", "that", "those", "who", "whom", "which", "most", "their", "his", "her",
    "your", "our", "with", "from", "into", "upon", "over", "under", "not", "no",
}
CURATED_ROOT_LABELS = {
    # Core Fatihah / high-frequency senses
    "رحم": "mercy", "حمد": "praise", "صرط": "path", "عبد": "worship", "ربب": "Lord",
    "اله": "god", "أله": "god", "علم": "knowledge", "ملك": "sovereignty", "دين": "judgment",
    "يوم": "day", "هدي": "guide", "قوم": "upright", "نعم": "favor", "غضب": "wrath",
    "ضلل": "astray", "عون": "help", "سمو": "name", "امن": "believe", "كتب": "book",
    "صلو": "prayer", "زكو": "purify", "كفر": "disbelieve", "سبح": "glory", "خلق": "create",
    "شكر": "gratitude", "أرض": "earth", "دبر": "turn back",
    # Qur'anic-dominant overrides (Lane first-sense or romanization often misleads)
    "قول": "say",  # not "qawala"
    "أمر": "command",  # not "amara"
    "فرد": "alone",  # not "fard"
    "ولج": "enter",  # not "walaja"
    "عذب": "punishment",  # Qur'anic عذاب; Lane often "motes"
    "ذنب": "sin",  # Qur'anic ذنب; Lane etymology "tail"
    "صحب": "companion",  # not "lord" from صاحب bleed
    "لهو": "diversion",  # not Lane "uvula"
    "جرم": "crime",  # not "doubt" from لا جرم phrase gloss
    "نسل": "offspring",  # not "nasala"
    "عمر": "inhabit build maintain flourish",  # root family; not every form means "life"
}

CURATED_WORD_LABELS = {
    ("عمر", "عَمَرُ"): "maintain",
    ("عمر", "عُمُر"): "life",
    ("عمر", "عَمْر"): "life",
    ("عمر", "يُعَمَّرُ"): "granted life",
    ("عمر", "مُعَمَّر"): "long-lived",
    ("عمر", "عُمْرَة"): "umrah",
    ("عمر", "عِمارَة"): "maintenance",
    ("عمر", "اسْتَعْمَرَ"): "settled",
    ("عمر", "مَعْمُور"): "frequented",
}

CURATED_ROOT_EXTENSIONS = {
    "عمر": "life / longevity",
}


def strip_diacritics(text: str) -> str:
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


def arabic_to_bw(text: str) -> str:
    return "".join(AR_TO_BW.get(ch, ch) for ch in strip_diacritics(text) if ch.strip())


def fs_bw(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9$>&<{}\*'Y]+", "", text) or "x"


def clean_trans(text: str) -> str:
    # Drop Quran.com footnote markers before generic HTML strip (avoids leftover "2")
    text = re.sub(r"<sup\b[^>]*>.*?</sup>", "", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"(?<=[A-Za-zāīūĀĪŪ\.\,’'\"\)\]\!\?؛،])\d+\b", "", text)
    return re.sub(r"\s+", " ", text).strip()


def sanitize_gloss(gloss: str) -> str:
    g = re.sub(r"[()\[\]]", "", gloss.strip())
    # Prefer the clause before a comma (Lane often piles synonyms after).
    g = g.split(",")[0].strip()
    words = [w for w in re.split(r"\s+", g) if w and w.lower() not in STOP]
    if not words:
        words = g.split()[:3]
    label = re.sub(r"[^a-z0-9\s\-']", "", " ".join(words[:3]).lower()).strip()
    return re.sub(r"\s+", " ", label) or "word"


def _norm_rom(s: str) -> str:
    """Normalize Buckwalter / common romanization for stub comparison."""
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
    """True when a 'gloss' is really a transliteration code (shkr, dbr, ard…)."""
    t = (text or "").strip().lower()
    if not t:
        return True
    if re.fullmatch(r"[a-z](?:-[a-z]){1,6}", t):  # f-r-r style
        return True
    if " " in t:
        return False
    cleaned = re.sub(r"[^a-z0-9$'>]", "", t)
    if root_bw:
        rb = re.sub(r"[^a-z0-9$'>]", "", root_bw.lower())
        if cleaned == rb or _norm_rom(cleaned) == _norm_rom(rb):
            return True
    # Consonant-only short tokens are almost always BW romanization stubs
    if re.fullmatch(r"[a-z$'>]{2,8}", cleaned) and not any(c in "aeiou" for c in cleaned):
        return True
    return False


def looks_like_romanization(text: str, root_bw: str | None = None) -> bool:
    """True for vocalized romanizations like qawala / walaja / fard posing as English."""
    if looks_like_bw_stub(text, root_bw):
        return True
    t = (text or "").strip().lower()
    if not t or " " in t:
        return False
    if root_bw:
        rb = re.sub(r"[^a-z]", "", root_bw.lower())
        stripped = re.sub(r"[aeiou]", "", re.sub(r"[^a-z]", "", t))
        rb_stripped = re.sub(r"[aeiou]", "", rb)
        if rb_stripped and stripped == rb_stripped and t != rb:
            return True
    # Form-I style: consonant skeleton with inserted vowels ending in a
    if re.fullmatch(r"[a-z]{3,10}", t):
        consonants = re.sub(r"[aeiou]", "", t)
        if 2 <= len(consonants) <= 4 and t.count("a") >= 2 and t.endswith("a"):
            return True
    return False


def short_label_from_lane(
    summary: str | None, definition: str | None, root_bw: str | None = None
) -> str | None:
    text = (summary or "").strip()
    low = text.lower()

    def ok(s: str) -> bool:
        s = s.strip()
        if not s or s in STOP:
            return False
        if looks_like_romanization(s, root_bw):
            return False
        if re.fullmatch(r"[A-Za-z$]{1,5}", s) and any(c.isupper() for c in s):
            return False
        return True

    # Prefer English gloss clauses; never return parenthetical romanization.
    if low:
        m = re.search(
            r'(?:primarily\s+)?(?:means|refers to|denotes|relates to)\s+'
            r'(?:to\s+|the\s+|a\s+|an\s+)?'
            r'["\']?([a-z][a-z\s\-\']{1,50})',
            low,
        )
        if m and ok(m.group(1)):
            return sanitize_gloss(m.group(1))
        # Parentheticals only if they look like real English (not BW / romanization)
        for pm in re.finditer(r"\(([a-z][a-z\s\-]{1,40})\)", low):
            candidate = pm.group(1)
            if ok(candidate) and " " in candidate:
                return sanitize_gloss(candidate)
    defn = (definition or "")[:600]
    for candidate in (
        "mercy", "praise", "worship", "name", "path", "guide", "glory", "believe",
        "earth", "thank", "grateful", "gratitude", "turn", "retreat", "back",
        "say", "speak", "speech", "command", "punish", "sin", "companion",
        "play", "divert", "crime", "enter", "alone",
    ):
        if re.search(rf"\b{candidate}\b", defn.lower()):
            return candidate
    return None


def load_lane_labels() -> dict[str, str]:
    path = DATA / "quran-arabic-roots-lane-lexicon" / "quran_arabic_roots_lane_lexicon_2026-02-12.json"
    if not path.exists():
        return {}
    out = {}
    for e in json.load(open(path))["roots"]:
        root = e.get("root")
        if not root:
            continue
        bw = e.get("root_buckwalter")
        label = short_label_from_lane(e.get("summary_en"), e.get("definition_en"), bw)
        if label and looks_like_bw_stub(label, bw):
            label = None
        if label:
            out[root] = label
            if bw:
                out[f"bw:{bw}"] = label
    return out


def is_allah_lemma(lemma: str) -> bool:
    base = strip_diacritics(lemma or "").replace("ٱ", "ا")
    return "الله" in base or base in {"الله", "لله"}


def parse_morphology(path: Path):
    word_map = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "\t" not in line:
            continue
        loc, _f, _t, features = line.split("\t", 3)
        parts = loc.split(":")
        if len(parts) != 4:
            continue
        s, a, w, _ = map(int, parts)
        root_m = re.search(r"ROOT:([^|]+)", features)
        lem_m = re.search(r"LEM:([^|]+)", features)
        if not root_m:
            continue
        root_ar = root_m.group(1)
        lemma = lem_m.group(1) if lem_m else ""
        if is_allah_lemma(lemma):
            word_map[(s, a, w)] = ("ALLAH", "الله", lemma or "الله")
            continue
        prev = word_map.get((s, a, w))
        if prev and prev[0] == "ALLAH":
            continue
        if (s, a, w) not in word_map:
            word_map[(s, a, w)] = (root_ar, root_ar, lemma)
    return word_map


def load_bulk():
    si = [clean_trans(t["text"]) for t in json.load(open(DATA / "si.json"))["translations"]]
    ya = [clean_trans(t["text"]) for t in json.load(open(DATA / "ya.json"))["translations"]]
    ur_path = DATA / "urdu_jalandhari.json"
    if not ur_path.exists():
        raise SystemExit(f"Missing {ur_path} — download Quran.com translation 234 first")
    ur = [clean_trans(t["text"]) for t in json.load(open(ur_path))["translations"]]
    uth = json.load(open(DATA / "uthmani.json"))["verses"]
    chapters = json.load(open(DATA / "chapters.json"))["chapters"]
    assert len(si) == len(ya) == len(ur) == len(uth) == 6236
    return si, ya, ur, uth, chapters


def load_wbw():
    by_key = {}
    for ch in range(1, 115):
        d = json.load(open(DATA / "chapters_wbw" / f"{ch}.json"))
        for v in d["verses"]:
            by_key[v["verse_key"]] = v
    return by_key


def safe_surah_name(name: str) -> str:
    return name.replace("'", "").replace("'", "").replace("'", "")


def surah_filename(num: int, name: str) -> str:
    return f"{num:03d} {safe_surah_name(name)}"


def lemma_key(root_key: str, lemma: str) -> str:
    if root_key == "ALLAH":
        return "ALLAH"
    # Keep Corpus lemma vowels in the identity. Stripping them merges distinct
    # Qur'anic lemmas such as عَمَرُ (maintain/inhabit) and عُمُر (life/age).
    norm = unicodedata.normalize("NFC", (lemma or "").strip())
    return f"{root_key}::{norm or root_key}"


def lemma_family_key(root_key: str, lemma: str) -> str:
    if root_key == "ALLAH":
        return "ALLAH"
    return f"{root_key}::{strip_diacritics(lemma or '').strip() or root_key}"


def unique_slug(base: str, used: set[str]) -> str:
    slug, i = base, 2
    while slug.lower() in used:
        slug = f"{base} {i}"
        i += 1
    used.add(slug.lower())
    return slug


def write_obsidian_config():
    ob = VAULT / ".obsidian"
    ob.mkdir(parents=True, exist_ok=True)
    filt = "path:Words OR path:Roots OR tag:#surah"
    (ob / "graph.json").write_text(
        json.dumps(
            {
                "collapse-filter": False,
                "search": filt,
                "showTags": False,
                "showAttachments": False,
                "hideUnresolved": True,
                "showOrphans": False,
                "collapse-color-groups": False,
                "colorGroups": [
                    {"query": "path:Words", "color": {"a": 1, "rgb": 4287076}},
                    {"query": "path:Roots", "color": {"a": 1, "rgb": 14725458}},
                    {"query": "tag:#surah", "color": {"a": 1, "rgb": 16760576}},
                ],
                "showArrow": True,
                "nodeSizeMultiplier": 1.1,
                "lineSizeMultiplier": 1,
                "centerStrength": 0.4,
                "repelStrength": 12,
                "linkStrength": 1,
                "linkDistance": 150,
                "scale": 0.5,
                "close": False,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    # Keep Properties UI from fighting large notes; disable unused heavy features if present
    (ob / "app.json").write_text(
        json.dumps(
            {
                "alwaysUpdateLinks": False,
                "newLinkFormat": "shortest",
                "useMarkdownLinks": False,
                "showUnsupportedFiles": False,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    META_DIR.mkdir(parents=True, exist_ok=True)
    (META_DIR / "Graph filter.txt").write_text(
        f"Graph Filters search box:\n\n{filt}\n",
        encoding="utf-8",
    )


def main():
    print("Loading data…")
    word_map = parse_morphology(DATA / "quran-morphology" / "quran-morphology.txt")
    lane = load_lane_labels()
    si, ya, ur, uth, chapters = load_bulk()
    wbw = load_wbw()
    chapter_by_id = {c["id"]: c for c in chapters}
    # Absolute ayah index 0..6235 for translation lookup
    verse_by_key = {v["verse_key"]: i for i, v in enumerate(uth)}

    # Clean vault markdown (keep .obsidian)
    for p in list(VAULT.glob("*.md")):
        p.unlink()
    for d in (WORD_DIR, ROOT_DIR, META_DIR, VAULT / "Ayahs"):
        if d.exists():
            shutil.rmtree(d)
    WORD_DIR.mkdir(parents=True, exist_ok=True)
    ROOT_DIR.mkdir(parents=True, exist_ok=True)
    write_obsidian_config()

    root_meta: dict = {}
    lemma_meta: dict = {}
    surah_lemma_keys: dict[int, set] = defaultdict(set)
    surah_root_keys: dict[int, set] = defaultdict(set)
    # Keep one sample ayah per surah for the hub note (tiny)
    surah_sample: dict[int, dict] = {}

    print("Indexing…")
    for idx, verse in enumerate(uth):
        key = verse["verse_key"]
        s, a = map(int, key.split(":"))
        if s not in surah_sample and a == 1:
            surah_sample[s] = {
                "key": key,
                "arabic": verse["text_uthmani"],
                "si": si[idx],
                "ya": ya[idx],
            }
        v = wbw[key]
        for w in v["words"]:
            if w.get("char_type_name") != "word":
                continue
            info = word_map.get((s, a, w["position"]))
            if not info:
                continue
            root_key, root_ar, lemma = info
            lk = lemma_key(root_key, lemma)
            gloss = (w.get("translation") or {}).get("text") or ""
            ar_w = w.get("text_uthmani") or w.get("text") or ""

            rm = root_meta.setdefault(
                root_key,
                {"root_ar": root_ar, "glosses": Counter(), "lemmas": set(), "surahs": set(), "occs": []},
            )
            if gloss:
                rm["glosses"][sanitize_gloss(gloss)] += 1
            rm["lemmas"].add(lk)
            rm["surahs"].add(s)
            if len(rm["occs"]) < 8:
                rm["occs"].append((s, a, ar_w, gloss))

            lm = lemma_meta.setdefault(
                lk,
                {
                    "root_key": root_key,
                    "root_ar": root_ar,
                    "lemma": lemma or root_ar,
                    "glosses": Counter(),
                    "surahs": set(),
                    "ayahs": set(),
                    "occs": [],
                    "all_occs": [],
                    "occ_keys": set(),
                    "forms": Counter(),
                },
            )
            if gloss:
                lm["glosses"][sanitize_gloss(gloss)] += 1
            lm["surahs"].add(s)
            lm["ayahs"].add(f"{s}:{a}")
            lm["forms"][ar_w] += 1
            # Store every unique ayah once; markdown samples only use occs[:MAX_OCC_LINES]
            vk = f"{s}:{a}"
            if vk not in lm["occ_keys"]:
                lm["occ_keys"].add(vk)
                lm["all_occs"].append((s, a, ar_w, gloss))
                if len(lm["occs"]) < MAX_OCC_LINES:
                    lm["occs"].append((s, a, ar_w, gloss))

            surah_lemma_keys[s].add(lk)
            surah_root_keys[s].add(root_key)

    def pick_root_gloss(root_key, meta):
        """Qur'anic-dominant: curated → kept-lemma WBW majority → Lane → root WBW."""
        if root_key == "ALLAH":
            return "God"
        if meta["root_ar"] in CURATED_ROOT_LABELS:
            return CURATED_ROOT_LABELS[meta["root_ar"]]
        bw = arabic_to_bw(meta["root_ar"])
        lemma_glosses: Counter[str] = Counter()
        for lk, lm in lemma_meta.items():
            if lk not in keep_lemmas or lm["root_key"] != root_key:
                continue
            ranked_lem = sorted(
                lm["glosses"].items(),
                key=lambda kv: (0 if len(kv[0].split()) <= 2 else 1, -kv[1]),
            )
            for g, c in ranked_lem:
                if g and g not in {"root", "word", "of", "to"} and not looks_like_romanization(g, bw):
                    lemma_glosses[g] += c
                    break
        if lemma_glosses:
            return sorted(lemma_glosses.items(), key=lambda kv: (-kv[1], len(kv[0])))[0][0]
        for k in (meta["root_ar"], f"bw:{bw}"):
            if k in lane and not looks_like_romanization(lane[k], bw):
                return lane[k]
        ranked = sorted(meta["glosses"].items(), key=lambda kv: (-kv[1], len(kv[0])))
        for g, _ in ranked:
            if g and g not in {"root", "word", "of", "to"} and not looks_like_romanization(g, bw):
                return g
        return "root"

    def pick_word_gloss(meta):
        if meta["root_key"] == "ALLAH":
            return "God"
        curated = CURATED_WORD_LABELS.get((meta["root_ar"], meta["lemma"]))
        if curated:
            return curated
        bw = arabic_to_bw(meta["root_ar"])
        ranked = sorted(meta["glosses"].items(), key=lambda kv: (0 if len(kv[0].split()) <= 2 else 1, -kv[1]))
        for g, _ in ranked:
            if g not in {"root", "word", "of", "to"} and not looks_like_romanization(g, bw):
                return g
        root_g = pick_root_gloss(meta["root_key"], root_meta[meta["root_key"]])
        if not looks_like_romanization(root_g, bw):
            return root_g
        return "word"

    lemma_family_surahs: dict[str, set[int]] = defaultdict(set)
    for meta in lemma_meta.values():
        lemma_family_surahs[lemma_family_key(meta["root_key"], meta["lemma"])].update(meta["surahs"])

    # Keep cross-surah words (+ Allah). Also keep a small split-word exception
    # when preserving lemma vowels separates a previously visible cross-surah
    # family into an important repeated sense with fewer than 3 surahs.
    keep_lemmas = {
        lk
        for lk, meta in lemma_meta.items()
        if (
            lk == "ALLAH"
            or len(meta["surahs"]) >= MIN_SURAHS_FOR_WORD
            or (
                len(lemma_family_surahs[lemma_family_key(meta["root_key"], meta["lemma"])]) >= MIN_SURAHS_FOR_WORD
                and len(meta["ayahs"]) >= MIN_AYAHS_FOR_SPLIT_WORD
            )
        )
    }
    keep_roots = {
        lemma_meta[lk]["root_key"]
        for lk in keep_lemmas
    }
    # also roots that span many surahs even if words filtered oddly
    for rk, meta in root_meta.items():
        if len(meta["surahs"]) >= MIN_SURAHS_FOR_WORD:
            keep_roots.add(rk)

    print(f"Keeping {len(keep_lemmas)} words (of {len(lemma_meta)}), {len(keep_roots)} roots (of {len(root_meta)})")

    used_root, used_word = set(), set()
    root_slug, word_slug = {}, {}

    for rk in sorted(keep_roots, key=lambda k: (-len(root_meta[k]["surahs"]), k)):
        meta = root_meta[rk]
        if rk == "ALLAH":
            root_slug[rk] = unique_slug("allah - God", used_root)
        else:
            root_slug[rk] = unique_slug(
                f"{fs_bw(arabic_to_bw(meta['root_ar']))} - {pick_root_gloss(rk, meta)}",
                used_root,
            )

    for lk in sorted(keep_lemmas, key=lambda k: (-len(lemma_meta[k]["surahs"]), k)):
        if lk == "ALLAH":
            word_slug[lk] = root_slug["ALLAH"]
            continue
        meta = lemma_meta[lk]
        lem_bw = fs_bw("".join(AR_TO_BW.get(ch, "") for ch in strip_diacritics(meta["lemma"]))) or fs_bw(
            arabic_to_bw(meta["root_ar"])
        )
        word_slug[lk] = unique_slug(f"{lem_bw} - {pick_word_gloss(meta)}", used_word)

    # Roots
    print("Writing roots…")
    for rk, slug in root_slug.items():
        meta = root_meta[rk]
        words = [
            f"- [[{word_slug[lk]}]]"
            for lk in sorted(meta["lemmas"], key=lambda x: word_slug.get(x, ""))
            if lk in word_slug and lk != "ALLAH"
        ][:MAX_WORDS_PER_ROOT]
        # Plain-text surah list (no wikilinks) — avoids tens of thousands of root↔surah edges
        surahs_plain = ", ".join(
            f"{sid:03d}" for sid in sorted(meta["surahs"])[:MAX_SURAHS_LISTED]
        )
        extra = f" …+{len(meta['surahs']) - MAX_SURAHS_LISTED}" if len(meta["surahs"]) > MAX_SURAHS_LISTED else ""
        extension = CURATED_ROOT_EXTENSIONS.get(meta["root_ar"])
        extension_line = f"\n**Extended semantic connection:** {extension}\n" if extension else ""
        (ROOT_DIR / f"{slug}.md").write_text(
            f"""---
type: root
arabic_root: "{meta['root_ar']}"
slug: "{slug}"
tags: [root, meaning]
---

# {slug}

## Graph connections

**Sense:** {pick_root_gloss(rk, meta)} · **Root:** {meta['root_ar']}
{extension_line}

### Words (wikilinks — these create the graph)
{chr(10).join(words) if words else "- (hub)"}

### Surahs where this root appears
`{surahs_plain}{extra}` · open those surah notes from [[Surah Index]]
""",
            encoding="utf-8",
        )

    # Words — full verse context (Arabic + Sahih International + Yusuf Ali)
    print("Writing words…")
    web_full_verses: dict[str, list] = {}
    for lk, slug in word_slug.items():
        if lk == "ALLAH":
            continue
        meta = lemma_meta[lk]
        rslug = root_slug[meta["root_key"]]
        surahs = [
            f"- [[{surah_filename(sid, chapter_by_id[sid]['name_simple'])}]]"
            for sid in sorted(meta["surahs"])[:MAX_SURAHS_LISTED]
        ]

        verse_blocks = []
        for s, a, ar_w, g in meta["occs"]:
            vk = f"{s}:{a}"
            abs_i = verse_by_key[vk]
            arabic = uth[abs_i]["text_uthmani"]
            en = si[abs_i]
            ya_t = ya[abs_i]
            urdu = ur[abs_i]
            sname = surah_filename(s, chapter_by_id[s]["name_simple"])
            verse_blocks.append(
                f"""#### {vk} · [[{sname}]]

<div dir="rtl" style="font-size: 1.35rem; line-height: 1.9; text-align: right;">

{arabic}

</div>

**Word in this verse:** `{ar_w}` — {g}

**English (Sahih International):** {en}

**English (Yusuf Ali):** {ya_t}

**Urdu (Fatah Muhammad Jalandhari):** {urdu}

[Open on Quran.com](https://quran.com/{s}/{a})
"""
            )
        more = len(meta["ayahs"]) - len(meta["occs"])
        more_line = (
            f"\n_…and **{more}** more verses with this word. Use Local graph / Surahs list, or search on Quran.com._\n"
            if more > 0
            else ""
        )

        (WORD_DIR / f"{slug}.md").write_text(
            f"""---
type: word
lemma: "{meta['lemma']}"
slug: "{slug}"
surah_count: {len(meta['surahs'])}
ayah_count: {len(meta['ayahs'])}
tags: [word, meaning]
---

# {slug}

## Graph connections

Open **Local graph** — lines to the **root** and **surahs** below.

### Root
- [[{rslug}]]

### Meaning
**{pick_word_gloss(meta)}** · Lemma **{meta['lemma']}**

### Surahs ({len(meta['surahs'])})
{chr(10).join(surahs)}

## Verses (full text)

Arabic + English (Sahih International) + English (Yusuf Ali) + Urdu. Showing up to {MAX_OCC_LINES} verses in Obsidian (web app shows all).

{chr(10).join(verse_blocks)}{more_line}
""",
            encoding="utf-8",
        )

        # Full verse list for the web app (Obsidian stays capped above)
        full_list = []
        for s, a, ar_w, g in meta.get("all_occs") or meta["occs"]:
            vk = f"{s}:{a}"
            abs_i = verse_by_key[vk]
            sname = surah_filename(s, chapter_by_id[s]["name_simple"])
            full_list.append(
                {
                    "ref": vk,
                    "surah": sname,
                    "arabic": uth[abs_i]["text_uthmani"],
                    "wordForm": ar_w,
                    "gloss": g,
                    "sahihInternational": si[abs_i],
                    "yusufAli": ya[abs_i],
                    "urdu": ur[abs_i],
                    "url": f"https://quran.com/{s}/{a}",
                }
            )
        web_full_verses[slug] = full_list

    # Gloss → Urdu highlight map (PMI), then attach urduHits per verse
    print("Building gloss→Urdu highlight map…")
    gloss_map = build_gloss_urdu_map(web_full_verses)
    gloss_map_path = DATA / "gloss_urdu_map.json"
    gloss_map_path.write_text(json.dumps(gloss_map, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  {len(gloss_map)} gloss stems → {gloss_map_path}")
    for slug, verses in web_full_verses.items():
        sense = slug_sense(slug)
        for v in verses:
            hits = urdu_hits_for_verse(
                str(v.get("gloss") or ""),
                str(v.get("urdu") or ""),
                str(v.get("wordForm") or ""),
                gloss_map,
                sense,
            )
            if hits:
                v["urduHits"] = hits

    # Cache every ayah for the static web viewer (gitignored under data/)
    web_verses_path = DATA / "word_verses_full.json"
    web_verses_path.write_text(json.dumps(web_full_verses, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote full web verses for {len(web_full_verses)} words → {web_verses_path}")

    # Surah hubs — LIGHT (no full mushaf text)
    print("Writing surah hubs…")
    for ch in chapters:
        s = ch["id"]
        fname = surah_filename(s, ch["name_simple"])
        freq = Counter()
        for lk in surah_lemma_keys[s]:
            if lk not in keep_lemmas:
                continue
            freq[lk] = sum(1 for ss, _a, _ar, _g in lemma_meta[lk]["occs"] if ss == s) + len(
                [1 for ss in lemma_meta[lk]["surahs"] if ss == s]
            )
        # better freq: count from surah's lemmas by how often they appear in this surah via occs
        freq = Counter()
        for lk in surah_lemma_keys[s]:
            if lk not in word_slug and lk != "ALLAH":
                continue
            if lk not in keep_lemmas:
                continue
            freq[lk] = sum(1 for ss, _a, _ar, _g in lemma_meta[lk]["occs"] if ss == s) or 1

        word_lines = []
        for lk, _ in freq.most_common(MAX_WORDS_PER_SURAH):
            slug = word_slug[lk]
            gloss = "God" if lk == "ALLAH" else pick_word_gloss(lemma_meta[lk])
            lem = "الله" if lk == "ALLAH" else lemma_meta[lk]["lemma"]
            word_lines.append(f"- [[{slug}]] — `{lem}` · {gloss}")

        root_lines = [
            f"- [[{root_slug[rk]}]]"
            for rk in sorted(surah_root_keys[s], key=lambda k: root_slug.get(k, ""))
            if rk in root_slug
        ][:50]

        sample = surah_sample.get(s, {})
        sample_block = ""
        if sample:
            sample_block = f"""## Sample (ayah 1)

<div dir="rtl" style="font-size: 1.4rem; text-align: right;">

{sample['arabic']}

</div>

**Sahih International:** {sample['si']}

**Yusuf Ali:** {sample['ya']}
"""

        (VAULT / f"{fname}.md").write_text(
            f"""---
type: surah
surah: {s}
tags: [surah]
---

# {fname} ({ch.get('name_arabic','')})

{ch.get('translated_name',{}).get('name','')} · {ch['verses_count']} ayahs

**Read full surah:** [quran.com/{s}](https://quran.com/{s}) (Arabic + Sahih International + more)

> [[Welcome]] · [[Word Index]] · [[Surah Index]]

## Words in this surah (graph)

{chr(10).join(word_lines) if word_lines else "_None kept (rare single-surah lemmas omitted for speed)._"}

## Roots

{chr(10).join(root_lines)}

{sample_block}
""",
            encoding="utf-8",
        )

    # Indexes + welcome
    top = sorted(
        ((lk, lemma_meta[lk]) for lk in keep_lemmas),
        key=lambda x: -len(x[1]["surahs"]),
    )[:100]
    idx = [
        "---",
        "tags: [index, word]",
        "---",
        "",
        "# Word Index",
        "",
        "Cross-surah word hubs only (fast vault). Open a word → **Local graph**.",
        "",
    ]
    for lk, meta in top:
        slug = word_slug[lk]
        gloss = "God" if lk == "ALLAH" else pick_word_gloss(meta)
        lem = "الله" if lk == "ALLAH" else meta["lemma"]
        idx.append(f"- [[{slug}]] — `{lem}` · {gloss} · {len(meta['surahs'])} surahs")
    (VAULT / "Word Index.md").write_text("\n".join(idx) + "\n", encoding="utf-8")

    sidx = ["---", "tags: [index, surah]", "---", "", "# Surah Index", "", "> [[Welcome]] · [[Word Index]]", ""]
    for ch in chapters:
        sidx.append(
            f"- [[{surah_filename(ch['id'], ch['name_simple'])}]] — {ch.get('name_arabic','')} · {ch['verses_count']} ayahs"
        )
    (VAULT / "Surah Index.md").write_text("\n".join(sidx) + "\n", encoding="utf-8")

    (VAULT / "Welcome.md").write_text(
        f"""---
tags: [home]
---

# Ishara

Meaning-graph vault: **words** linked across **surahs** (and their **roots**).

*Ishara* (إشارة) — signpost through the Qur’an’s connected meanings.

## Start

1. [[Word Index]] → open a word (e.g. glory / mercy / lord)
2. Scroll to **Verses (full text)** — Arabic + English + Urdu for each listed ayah
3. **Local graph** — links to root + surahs
4. Surah note → [quran.com](https://quran.com) for the whole chapter

Graph filter: `path:Words OR path:Roots OR tag:#surah`

- [[{surah_filename(1, chapters[0]['name_simple'])}]]
- [[Surah Index]]
- [[Meta/Sources]]
""",
        encoding="utf-8",
    )

    (META_DIR / "Sources.md").write_text(
        """---
tags: [meta, sources]
---

# Sources

- Arabic: Quran.com / Tanzil Uthmani
- English on word-verse blocks: Sahih International (API id 20) + Yusuf Ali (API id 22)
- Urdu on word-verse blocks: Fatah Muhammad Jalandhari (API id 234)
- Full-chapter reading: quran.com links from surah hubs
- Morphology: Quranic Arabic Corpus (mustafa0x/quran-morphology)
- Root labels: Lane lexicon dataset + curated senses
""",
        encoding="utf-8",
    )

    # Stats
    n_md = sum(1 for _ in VAULT.rglob("*.md") if ".obsidian" not in str(_))
    n_links = 0
    for p in VAULT.rglob("*.md"):
        if ".obsidian" in p.parts:
            continue
        n_links += p.read_text(encoding="utf-8").count("[[")
    print("DONE")
    print(f"  words: {len(list(WORD_DIR.glob('*.md')))}")
    print(f"  roots: {len(list(ROOT_DIR.glob('*.md')))}")
    print(f"  md files: {n_md}")
    print(f"  wikilinks: {n_links}")


if __name__ == "__main__":
    main()
