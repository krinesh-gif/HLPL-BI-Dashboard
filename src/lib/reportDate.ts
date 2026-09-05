/**
 * Parsing the dates marketplaces print in their reports.
 *
 * `new Date('6/1/2026')` is not a specification — it is whatever the browser
 * decides. V8 happens to read it the American way and returns 1 June, which is
 * right for Amazon's US reports and would be wrong for a file written the
 * Indian way, where the same string means 6 January. The spec leaves any
 * non-ISO string implementation-defined, so a report that reads correctly in
 * Chrome today can move a whole month somewhere else. Nothing about which
 * convention a file uses should be left to the engine to guess: the app knows
 * which marketplace wrote the file, so it states the convention and parses it.
 *
 * Everything here builds a local Date. A report date is a calendar date with
 * no time and no zone; putting it through UTC is what filed every Amazon USA
 * month under the previous one.
 */

function localDate(year: number, month1to12: number, day: number): Date | null {
  if (month1to12 < 1 || month1to12 > 12 || day < 1 || day > 31) return null
  const d = new Date(year, month1to12 - 1, day)
  // Rejects 31 February and friends, which JS would roll forward silently.
  if (d.getFullYear() !== year || d.getMonth() !== month1to12 - 1 || d.getDate() !== day) return null
  return d
}

/** MM/DD/YYYY, the convention every Amazon US report uses. Accepts M/D/YYYY —
 * Amazon does not zero-pad, so "6/1/2026" is 1 June, not 6 January. */
export function parseUsSlashDate(raw: string): Date | null {
  const m = /^\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*$/.exec(raw)
  if (!m) return null
  return localDate(Number(m[3]), Number(m[1]), Number(m[2]))
}

/** yyyy-mm-dd, optionally followed by a time, which is what the Indian
 * marketplaces export. Built as a local date rather than through
 * `new Date('2026-03-12')`, which the spec defines as UTC midnight. */
export function parseIsoLocalDate(raw: string): Date | null {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/.exec(raw)
  if (!m) return null
  return localDate(Number(m[1]), Number(m[2]), Number(m[3]))
}

/**
 * A report date, read with the convention its marketplace writes in.
 *
 * `convention` says which form to try first, never which forms are allowed: a
 * US report that starts arriving in ISO still parses, and vice versa. The
 * engine is the last resort, for a format neither branch recognises, and a
 * string nothing can read comes back null rather than as an invalid Date that
 * spreads NaN through the import.
 */
export function parseReportDate(raw: string | undefined | null, convention: 'us' | 'iso'): Date | null {
  if (!raw) return null
  const text = String(raw)
  const first = convention === 'us' ? parseUsSlashDate(text) : parseIsoLocalDate(text)
  if (first) return first
  const second = convention === 'us' ? parseIsoLocalDate(text) : parseUsSlashDate(text)
  if (second) return second
  const fallback = new Date(text)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}
