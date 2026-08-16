/** Display helpers — keep padded slugs as navigation IDs; strip zeros for UI. */

/** `002 Al-Baqarah` → `2 Al-Baqarah`; leave word/root slugs unchanged. */
export function formatSurahLabel(slug: string): string {
  const m = slug.match(/^0*(\d{1,3})\s+(.+)$/)
  if (!m) return slug
  return `${Number(m[1])} ${m[2]}`
}

/** `006:002` or `6:2` → `6:2`. */
export function formatVerseRef(ref: string): string {
  const m = ref.match(/^0*(\d{1,3})\s*:\s*0*(\d{1,3})$/)
  if (!m) return ref
  return `${Number(m[1])}:${Number(m[2])}`
}

/** Prefer English gloss from `bw - meaning` slugs; unpad surah filenames. */
export function displaySlug(slug: string): string {
  const surah = formatSurahLabel(slug)
  if (surah !== slug) return surah
  const i = slug.indexOf(' - ')
  if (i < 0) return slug
  const meaning = slug.slice(i + 3).trim()
  return meaning || slug
}

/** Short trail label for history chrome. */
export function trailLabel(slugOrTitle: string, meaning?: string): string {
  if (meaning && meaning.trim()) return meaning.trim()
  return displaySlug(slugOrTitle)
}
