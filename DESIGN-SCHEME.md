# Ishara Design Scheme

Ishara is a meaning-first Qur'an graph. The interface should feel like a focused study instrument: dark, calm, readable, and evidence-led. The graph is the main surface, so color must separate node meaning clearly without becoming decorative.

## Current Visual Direction

| Role | Hex | Usage |
|---|---:|---|
| Background | `#191919` | Main app canvas |
| Panel | `#242424` | Right evidence panel and header |
| Raised panel | `#2a2a2a` | Verse cards, search input, controls |
| Primary text | `#faf2d6` | Main text on dark surfaces |
| Muted text | `#bdae93` | Secondary copy and labels |
| Hairline | `#3d3d3d` | Dividers and quiet borders |
| Accent gold | `#f8cd37` | Primary action state and root-like emphasis |
| Accent soft | `#e8d49a` | Softer headings and metadata |
| Focus blue | `#5b76ff` | Keyboard focus ring |
| Danger | `#c45c5c` | Rare warning/error state |

## Current Graph Colors

These are currently too close together, especially when zoomed or viewed on lower quality displays.

| Node Type | Hex | Current Role |
|---|---:|---|
| Word | `#c95e27` | Burnt orange |
| Root | `#f8cd37` | Gold |
| Surah | `#ffbf00` | Amber |

## Proposed Distinct Graph Colors

Use three clearly separated hues while preserving the dark Ishara identity.

| Node Type | Hex | Visual Meaning |
|---|---:|---|
| Word | `#e15a2b` | Living word/form, warm and active |
| Root | `#f6c945` | Root/source, gold and central |
| Surah | `#3fa7d6` | Chapter/location, cool and distinct |

## Proposed Supporting Graph Colors

| Role | Hex | Usage |
|---|---:|---|
| Word soft | `rgba(225, 90, 43, 0.18)` | Word highlights and subtle fills |
| Root soft | `rgba(246, 201, 69, 0.20)` | Root glow and link particles |
| Surah soft | `rgba(63, 167, 214, 0.18)` | Surah hover/selection support |
| Link default | `rgba(248, 205, 55, 0.24)` | Graph edges |
| Link active | `rgba(244, 244, 240, 0.52)` | Focused/hovered edges if added later |
| Label | `rgba(250, 242, 214, 0.92)` | Graph node labels |
| Label muted | `rgba(250, 242, 214, 0.58)` | Lower priority graph text |

## Interaction States

| State | Treatment |
|---|---|
| Default node | Solid fill by node type |
| Hovered node | Slight radius increase, ivory stroke, label always visible |
| Focused node | Ivory stroke, label always visible, optional soft aura |
| Keyboard focus | `3px` solid `#5b76ff`, `2px` offset |
| Selected evidence rail | Word orange `#e15a2b` unless selected type changes |

## Typography

| Role | Font Stack | Usage |
|---|---|---|
| UI/body | `"DM Sans", "Avenir Next", system-ui, sans-serif` | App controls, translations, panel copy |
| Display | `"Source Serif 4", "Iowan Old Style", Palatino, Georgia, serif` | Ishara brand, section headings |
| Arabic | `"Amiri", "Noto Naskh Arabic", "Traditional Arabic", serif` | Qur'anic Arabic |
| Mono utility | `"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace` | Metadata labels, evidence fields |

## Layout

| Area | Rule |
|---|---|
| Header | Compact, persistent, dark panel with gold hairline |
| Graph | Full available canvas, no decorative card frame |
| Search | Top-left overlay, max `420px`, full width on mobile |
| Evidence panel | Right side on desktop, bottom stack on mobile |
| Resize gutter | Thick enough for touch, visually quiet |
| Mobile breakpoint | Stack at `860px` and below |

## Evidence Panel

| Element | Treatment |
|---|---|
| Type badge | Uses node color; dark text for readability |
| Summary card | Raised dark panel, 6px radius, thin border |
| Verse card | Raised dark card with selected-type border |
| Arabic ayah | Larger Arabic font, RTL, contained dark field |
| Highlighted word | Bold + underline + subtle selected-type background |
| Translation label | Small uppercase mono, accent color |

## Accessibility Notes

- Do not rely on color alone; badges must include text labels: `WORD`, `ROOT`, `SURAH`.
- Keep primary text contrast high on all dark panels.
- Keep touch targets at least `44px` where practical.
- Node color contrast should remain distinct for color-blind users: warm orange, gold, and blue are more separable than orange/gold/amber.
- Avoid large glowing areas and oversized nodes while zooming.

## CSS Token Draft

```css
:root {
  --bg: #191919;
  --bg-panel: #242424;
  --bg-elevated: #2a2a2a;
  --ink: #faf2d6;
  --muted: #bdae93;
  --line: #3d3d3d;
  --accent: #f8cd37;
  --accent-soft: #e8d49a;
  --focus: #5b76ff;

  --word: #e15a2b;
  --root: #f6c945;
  --surah: #3fa7d6;

  --word-soft: rgba(225, 90, 43, 0.18);
  --root-soft: rgba(246, 201, 69, 0.2);
  --surah-soft: rgba(63, 167, 214, 0.18);
}
```

